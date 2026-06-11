import asyncio
import inspect
from collections.abc import AsyncGenerator, Awaitable, Sequence
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Any, TypeVar, cast

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")


class ConcurrencyError(Exception):
    def __init__(
        self,
        failures: Sequence[BaseException],
        *,
        partial_results: Sequence[Any] | None = None,
        completed_indexes: set[int] | None = None,
    ) -> None:
        self.failures = list(failures)
        self.exceptions = self.failures
        self.errors = self.failures
        self.partial_results = list(partial_results or [])
        self.completed_indexes = set(completed_indexes or set())
        message = f"{len(self.failures)} concurrent task(s) failed"
        super().__init__(message)


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    *,
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    if max_concurrency < 1:
        for coroutine in coroutines:
            _close_unstarted_coroutine(coroutine)
        raise ValueError("max_concurrency must be at least 1")
    if not coroutines:
        return []

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coroutines)
    completed_indexes: set[int] = set()

    async def run_one(coroutine: Awaitable[_T]) -> _T:
        started = False
        try:
            async with semaphore:
                started = True
                return await coroutine
        finally:
            if not started:
                _close_unstarted_coroutine(coroutine)

    tasks = [
        asyncio.create_task(run_one(coroutine))
        for coroutine in coroutines
    ]
    task_indexes = {task: index for index, task in enumerate(tasks)}

    try:
        done, pending = await asyncio.wait(tasks, timeout=timeout)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise

    failures: list[BaseException] = []
    if pending:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    for task in sorted(done, key=lambda done_task: task_indexes[done_task]):
        index = task_indexes[task]
        try:
            results[index] = task.result()
            completed_indexes.add(index)
        except BaseException as exc:
            failures.append(exc)

    if pending:
        failures.append(
            asyncio.TimeoutError(
                f"run_concurrently timed out after {timeout} second(s)"
            )
        )

    if failures:
        raise ConcurrencyError(
            failures,
            partial_results=results,
            completed_indexes=completed_indexes,
        )

    return cast(list[_T], results)


def _close_unstarted_coroutine(coroutine: Awaitable[Any]) -> None:
    if inspect.iscoroutine(coroutine):
        coroutine.close()


@asynccontextmanager
async def contextmanager_in_threadpool(
    cm: AbstractContextManager[_T],
) -> AsyncGenerator[_T, None]:
    # blocking __exit__ from running waiting on a free thread
    # can create race conditions/deadlocks if the context manager itself
    # has its own internal pool (e.g. a database connection pool)
    # to avoid this we let __exit__ run without a capacity limit
    # since we're creating a new limiter for each call, any non-zero limit
    # works (1 is arbitrary)
    exit_limiter = CapacityLimiter(1)
    try:
        yield await run_in_threadpool(cm.__enter__)
    except Exception as e:
        ok = bool(
            await anyio.to_thread.run_sync(
                cm.__exit__, type(e), e, e.__traceback__, limiter=exit_limiter
            )
        )
        if not ok:
            raise e
    else:
        await anyio.to_thread.run_sync(
            cm.__exit__, None, None, None, limiter=exit_limiter
        )
