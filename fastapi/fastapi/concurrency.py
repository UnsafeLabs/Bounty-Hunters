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


import asyncio


class ConcurrencyError(Exception):
    def __init__(self, errors: list[Exception]):
        self.errors = errors
        super().__init__(f"{len(errors)} task(s) failed")


async def run_concurrently(
    coros: list,
    max_concurrency: int = 5,
    timeout: float | None = None,
) -> list:
    semaphore = asyncio.Semaphore(max_concurrency)
    results: list = [None] * len(coros)
    errors: list[Exception] = []
    lock = asyncio.Lock()

    async def run(idx: int, coro) -> None:
        async with semaphore:
            try:
                result = await asyncio.wait_for(asyncio.ensure_future(coro), timeout=timeout) if timeout else await asyncio.ensure_future(coro)
                async with lock:
                    results[idx] = result
            except Exception as e:
                async with lock:
                    errors.append(e)

    tasks = [asyncio.create_task(run(i, c)) for i, c in enumerate(coros)]
    await asyncio.gather(*tasks, return_exceptions=True)
    if errors:
        raise ConcurrencyError(errors)
    return results
