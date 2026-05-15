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


class ConcurrencyError(Exception):
    """Raised when one or more coroutines fail during concurrent execution."""

    def __init__(self, errors, results=None):
        self.errors = errors
        self.results = results or []
        message = f'{len(errors)} coroutine(s) failed during concurrent execution'
        super().__init__(message)


async def run_concurrently(*coroutines, max_concurrency=5, timeout=None):
    """Run multiple coroutines concurrently with a semaphore-limited concurrency.

    Args:
        *coroutines: Awaitables to execute concurrently.
        max_concurrency: Maximum number of coroutines to run at once (default 5).
        timeout: Optional timeout in seconds.

    Returns:
        List of results in the same order as the input coroutines.

    Raises:
        ConcurrencyError: If any coroutine raises an exception.
    """
    if not coroutines:
        return []

    semaphore = asyncio.Semaphore(max_concurrency)
    results = [None] * len(coroutines)
    errors = []

    async def _run_one(index, coro):
        async with semaphore:
            try:
                results[index] = await coro
            except Exception as exc:
                errors.append((index, exc))

    tasks = [asyncio.create_task(_run_one(i, c)) for i, c in enumerate(coroutines)]

    try:
        if timeout is not None:
            done, pending = await asyncio.wait(tasks, timeout=timeout)
            if pending:
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                errors.append((-1, TimeoutError(f'run_concurrently timed out after {timeout}s')))
        else:
            await asyncio.gather(*tasks)
    except Exception:
        for task in tasks:
            if not task.done():
                task.cancel()
        raise

    if errors:
        errors.sort(key=lambda x: x[0])
        raise ConcurrencyError(errors=[e for _, e in errors], results=results)

    return results





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
