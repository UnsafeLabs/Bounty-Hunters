import asyncio
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
        failures: list[BaseException],
        partial_results: list[Any],
    ) -> None:
        self.failures = failures
        self.partial_results = partial_results
        super().__init__(f"{len(failures)} concurrent task(s) failed")


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    *,
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be at least 1")

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coroutines)
    failures: list[BaseException] = []

    async def run_one(index: int, coroutine: Awaitable[_T]) -> None:
        async with semaphore:
            try:
                results[index] = await coroutine
            except Exception as exc:
                failures.append(exc)

    tasks = [
        asyncio.create_task(run_one(index, coroutine))
        for index, coroutine in enumerate(coroutines)
    ]

    try:
        await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=timeout,
        )
    except TimeoutError as exc:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        failures.append(exc)

    if failures:
        raise ConcurrencyError(failures=failures, partial_results=results)

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
