from collections.abc import AsyncGenerator
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import TypeVar

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")

import asyncio
from collections.abc import Coroutine, Sequence
from typing import Any


class ConcurrencyError(Exception):
    """Raised when one or more tasks fail during run_concurrently."""

    def __init__(self, errors: list[BaseException]):
        self.errors = errors
        super().__init__(f"{len(errors)} task(s) failed: {errors}")


async def run_concurrently(
    coros: Sequence[Coroutine[Any, Any, _T]],
    max_concurrency: int = 1,
    timeout: float | None = None,
) -> list[_T]:
    """Run multiple coroutines concurrently with a concurrency limit and timeout.

    Args:
        coros: List of coroutines to execute.
        max_concurrency: Maximum number of concurrent coroutines.
        timeout: Maximum total execution time in seconds.

    Returns:
        Results in the same order as input coroutines.

    Raises:
        ConcurrencyError: If any coroutine raises an exception, containing all failures.
        TimeoutError: If the total execution exceeds the timeout.
    """
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be at least 1")

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coros)
    errors: list[BaseException] = []

    async def run_one(index: int, coro: Coroutine[Any, Any, _T]) -> None:
        async with semaphore:
            try:
                results[index] = await coro
            except BaseException as e:
                errors.append(e)
                results[index] = e

    tasks = [asyncio.create_task(run_one(i, c)) for i, c in enumerate(coros)]

    try:
        if timeout is not None:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=False),
                timeout=timeout,
            )
        else:
            await asyncio.gather(*tasks, return_exceptions=False)
    except asyncio.TimeoutError:
        for t in tasks:
            if not t.done():
                t.cancel()
        raise TimeoutError(
            f"run_concurrently timed out after {timeout}s"
        )

    if errors:
        raise ConcurrencyError(errors)

    return results  # type: ignore[return-value]


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