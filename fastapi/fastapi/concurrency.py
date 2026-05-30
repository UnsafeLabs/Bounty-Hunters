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
    """
    Error raised when one or more concurrent tasks fail.
    """

    def __init__(
        self,
        failures: Sequence[BaseException],
        partial_results: Sequence[Any],
    ) -> None:
        self.failures = list(failures)
        self.partial_results = list(partial_results)
        super().__init__(f"{len(self.failures)} concurrent task(s) failed")


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    """
    Run awaitables concurrently with a concurrency limit.
    """
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be greater than 0")

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[_T | None] = [None] * len(coroutines)
    completed = [False] * len(coroutines)
    failures: list[BaseException] = []

    async def run_one(index: int, coroutine: Awaitable[_T]) -> None:
        started = False
        try:
            async with semaphore:
                started = True
                results[index] = await coroutine
                completed[index] = True
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            failures.append(exc)
        finally:
            if not started and inspect.iscoroutine(coroutine):
                coroutine.close()

    tasks = [
        asyncio.create_task(run_one(index, coroutine))
        for index, coroutine in enumerate(coroutines)
    ]
    try:
        runner = asyncio.gather(*tasks)
        if timeout is None:
            await runner
        else:
            await asyncio.wait_for(runner, timeout)
    except TimeoutError as exc:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        failures.append(exc)

    partial_results = [
        result if is_complete else None
        for result, is_complete in zip(results, completed, strict=True)
    ]
    if failures:
        raise ConcurrencyError(failures, partial_results)
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
