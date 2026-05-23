import asyncio
from collections.abc import AsyncGenerator
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import TypeVar, Any, Coroutine, List, Sequence

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
    def __init__(self, exceptions: List[Exception]):
        self.exceptions = exceptions
        super().__init__(f"Multiple exceptions occurred: {exceptions}")

async def run_concurrently(coroutines: Sequence[Coroutine[Any, Any, Any]], max_concurrency: int, timeout: float = None) -> Any:
    semaphore = asyncio.Semaphore(max_concurrency)
    results = [None] * len(coroutines)
    exceptions = []

    async def worker(index: int, coro: Coroutine[Any, Any, Any]):
        async with semaphore:
            try:
                results[index] = await coro
            except Exception as e:
                exceptions.append(e)

    tasks = [asyncio.create_task(worker(i, coro)) for i, coro in enumerate(coroutines)]

    if timeout is not None:
        try:
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
        except asyncio.TimeoutError as e:
            for task in tasks:
                task.cancel()
            return results, e
    else:
        await asyncio.gather(*tasks)

    if exceptions:
        raise ConcurrencyError(exceptions)

    return results
