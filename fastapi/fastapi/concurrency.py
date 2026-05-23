import asyncio
from collections.abc import AsyncGenerator, Coroutine
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


class ConcurrencyError(Exception):
    def __init__(self, errors: list[Exception]):
        self.errors = errors
        super().__init__(f"{len(errors)} task(s) failed")


async def run_concurrently(
    coros: list[Coroutine[Any, Any, _T]],
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[_T | None] = [None] * len(coros)
    errors: dict[int, Exception] = {}

    async def _run_task(idx: int, coro: Coroutine[Any, Any, _T]) -> None:
        async with semaphore:
            try:
                if timeout is not None:
                    results[idx] = await asyncio.wait_for(coro, timeout=timeout)
                else:
                    results[idx] = await coro
            except Exception as e:
                errors[idx] = e

    tasks = [asyncio.create_task(_run_task(i, c)) for i, c in enumerate(coros)]
    await asyncio.gather(*tasks, return_exceptions=True)

    if errors:
        raise ConcurrencyError(list(errors.values()))
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
