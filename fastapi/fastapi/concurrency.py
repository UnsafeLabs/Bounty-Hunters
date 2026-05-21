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


def _close_unstarted_awaitables(
    awaitables: Sequence[Awaitable[Any]],
    started_indexes: set[int],
) -> None:
    for index, awaitable in enumerate(awaitables):
        if index in started_indexes:
            continue
        close = getattr(awaitable, "close", None)
        if callable(close):
            close()


class ConcurrencyError(Exception):
    """Raised when one or more tasks fail during concurrent execution."""

    def __init__(
        self,
        failures: Sequence[BaseException],
        partial_results: Sequence[Any | None],
    ) -> None:
        self.failures = list(failures)
        self.partial_results = list(partial_results)
        super().__init__(
            f"{len(self.failures)} task(s) failed during concurrent execution"
        )


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be greater than 0")

    results: list[_T | None] = [None] * len(coroutines)
    failures: list[tuple[int, BaseException]] = []
    started_indexes: set[int] = set()
    semaphore = asyncio.Semaphore(max_concurrency)

    async def run_one(index: int, coroutine: Awaitable[_T]) -> None:
        async with semaphore:
            started_indexes.add(index)
            try:
                results[index] = await coroutine
            except Exception as exc:
                failures.append((index, exc))

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
        _close_unstarted_awaitables(coroutines, started_indexes)
        failures.append((len(coroutines), exc))

    if failures:
        ordered_failures = [
            failure for _, failure in sorted(failures, key=lambda item: item[0])
        ]
        raise ConcurrencyError(ordered_failures, results)

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
