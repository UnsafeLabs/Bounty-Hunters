from collections.abc import AsyncGenerator, Coroutine, Sequence
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

import asyncio


_T = TypeVar("_T")


class ConcurrencyError(Exception):
    """Raised when one or more coroutines fail during concurrent execution."""

    def __init__(self, errors: list[BaseException]) -> None:
        self.errors = errors
        super().__init__(f"{len(errors)} coroutine(s) failed")


async def run_concurrently(
    *coros: Coroutine[None, None, _T],
    max_concurrency: int = 0,
    timeout: float | None = None,
) -> list[_T]:
    """Run multiple coroutines concurrently with a concurrency limit.

    Args:
        *coros: Coroutines to execute concurrently.
        max_concurrency: Maximum number of coroutines to run at once.
            If 0 or negative, all coroutines run concurrently (no limit).
        timeout: Optional total timeout in seconds. If exceeded, remaining
            tasks are cancelled and a TimeoutError is raised.

    Returns:
        Results in the same order as the input coroutines.

    Raises:
        ConcurrencyError: If any coroutine raises an exception. Contains
            all collected errors in the ``errors`` attribute.
        TimeoutError: If the total execution exceeds the timeout.
    """
    if not coros:
        return []

    semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency > 0 else None
    results: list[_T | None] = [None] * len(coros)
    errors: list[tuple[int, BaseException]] = []

    async def _run_one(index: int, coro: Coroutine[None, None, _T]) -> None:
        try:
            if semaphore is not None:
                async with semaphore:
                    results[index] = await coro
            else:
                results[index] = await coro
        except BaseException as e:
            errors.append((index, e))

    tasks = [_run_one(i, c) for i, c in enumerate(coros)]
    try:
        if timeout is not None:
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
        else:
            await asyncio.gather(*tasks)
    except TimeoutError:
        # Cancel remaining tasks
        for task in asyncio.all_tasks():
            if task is not asyncio.current_task() and not task.done():
                task.cancel()
        raise

    if errors:
        raise ConcurrencyError([e for _, e in errors])

    return [r for r in results if r is not None]  # type: ignore[return-value]


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
