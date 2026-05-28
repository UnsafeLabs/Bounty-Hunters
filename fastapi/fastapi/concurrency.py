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


class ConcurrencyError(Exception):
    """Raised when one or more concurrent tasks fail."""
    def __init__(self, errors):
        self.errors = errors
        super().__init__(f"{len(errors)} task(s) failed")


async def run_concurrently(coroutines, max_concurrency=10, timeout=None):
    """Run multiple coroutines concurrently with semaphore limiting and timeout.

    Args:
        coroutines: List of coroutines to execute
        max_concurrency: Maximum number of concurrent tasks
        timeout: Optional timeout in seconds for all tasks

    Returns:
        List of results in the same order as input coroutines

    Raises:
        ConcurrencyError: If any tasks fail
        asyncio.TimeoutError: If timeout is exceeded
    """
    import asyncio

    semaphore = asyncio.Semaphore(max_concurrency)
    results = [None] * len(coroutines)
    errors = []

    async def run_one(index, coro):
        async with semaphore:
            try:
                results[index] = await coro
            except Exception as e:
                errors.append((index, e))

    tasks = [asyncio.create_task(run_one(i, coro)) for i, coro in enumerate(coroutines)]

    try:
        if timeout:
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
        else:
            await asyncio.gather(*tasks)
    except asyncio.TimeoutError:
        for t in tasks:
            if not t.done():
                t.cancel()
        for i, t in enumerate(tasks):
            if t.done() and not t.cancelled():
                try:
                    results[i] = t.result()
                except Exception:
                    pass
        errors.append((-1, asyncio.TimeoutError(f"Execution exceeded {timeout}s timeout")))

    if errors:
        raise ConcurrencyError([e for _, e in errors])

    return results
