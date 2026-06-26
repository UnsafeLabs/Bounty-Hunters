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
        exceptions: Sequence[BaseException],
        partial_results: Sequence[Any] | None = None,
    ) -> None:
        self.exceptions = list(exceptions)
        self.failures = self.exceptions
        self.partial_results = (
            list(partial_results) if partial_results is not None else []
        )
        super().__init__(
            f"{len(self.exceptions)} concurrent task(s) failed"
            if self.exceptions
            else "Concurrent execution failed"
        )


def _close_unstarted_awaitable(awaitable: Awaitable[Any]) -> None:
    if inspect.iscoroutine(awaitable):
        awaitable.close()


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    *,
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    if max_concurrency < 1:
        for coroutine in coroutines:
            _close_unstarted_awaitable(coroutine)
        raise ValueError("max_concurrency must be at least 1")

    if not coroutines:
        return []

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coroutines)
    exceptions: list[BaseException] = []

    async def run_one(index: int, coroutine: Awaitable[_T]) -> None:
        acquired = False
        try:
            async with semaphore:
                acquired = True
                results[index] = await coroutine
        except Exception as exc:
            exceptions.append(exc)
        except asyncio.CancelledError:
            if not acquired:
                _close_unstarted_awaitable(coroutine)
            raise

    tasks = [
        asyncio.create_task(run_one(index, coroutine))
        for index, coroutine in enumerate(coroutines)
    ]

    try:
        await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
    except TimeoutError as exc:
        exceptions.append(exc)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    if exceptions:
        raise ConcurrencyError(exceptions, results)

    return cast(list[_T], results)


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
