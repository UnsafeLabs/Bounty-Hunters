import asyncio
from collections.abc import AsyncGenerator, Awaitable, Iterable
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from inspect import iscoroutine
from typing import Any, TypeVar, cast

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")
_MISSING = object()


class ConcurrencyError(Exception):
    """Raised when run_concurrently collects one or more failures."""

    def __init__(
        self,
        errors: Iterable[BaseException],
        results: list[Any] | None = None,
    ) -> None:
        self.errors = list(errors)
        self.failures = self.errors
        self.exceptions = self.errors
        self.results = [] if results is None else results
        self.partial_results = self.results
        super().__init__(f"{len(self.errors)} task(s) failed during concurrent execution")


def _normalize_awaitables(
    awaitables: Iterable[Awaitable[_T]] | Awaitable[_T] | None,
    additional_awaitables: tuple[Awaitable[_T], ...],
) -> list[Awaitable[_T]]:
    if awaitables is None:
        return list(additional_awaitables)
    if additional_awaitables:
        return [cast(Awaitable[_T], awaitables), *additional_awaitables]
    if isinstance(awaitables, Awaitable):
        return [awaitables]
    return list(awaitables)


def _close_unstarted_awaitables(
    awaitables: list[Awaitable[_T]], started: list[bool]
) -> None:
    for awaitable, did_start in zip(awaitables, started, strict=True):
        if not did_start and iscoroutine(awaitable):
            awaitable.close()


async def run_concurrently(
    awaitables: Iterable[Awaitable[_T]] | Awaitable[_T] | None = None,
    *additional_awaitables: Awaitable[_T],
    max_concurrency: int = 5,
    timeout: float | None = None,
) -> list[_T]:
    """Run awaitables concurrently with a bounded concurrency limit.

    Results are returned in the same order as the input awaitables. When any
    awaitable fails, all awaitables are allowed to finish and the collected
    exceptions are raised together as ``ConcurrencyError``.
    """
    pending_awaitables = _normalize_awaitables(awaitables, additional_awaitables)
    if max_concurrency < 1:
        _close_unstarted_awaitables(
            pending_awaitables,
            [False] * len(pending_awaitables),
        )
        raise ValueError("max_concurrency must be greater than 0")

    if not pending_awaitables:
        return []

    semaphore = asyncio.Semaphore(max_concurrency)
    started = [False] * len(pending_awaitables)
    results: list[Any] = [_MISSING] * len(pending_awaitables)
    errors: list[tuple[int, BaseException]] = []

    async def run_one(index: int) -> None:
        try:
            async with semaphore:
                awaitable = pending_awaitables[index]
                started[index] = True
                results[index] = await awaitable
        except Exception as exc:
            errors.append((index, exc))

    tasks = [
        asyncio.create_task(run_one(index)) for index in range(len(pending_awaitables))
    ]

    try:
        await asyncio.wait_for(asyncio.gather(*tasks), timeout=timeout)
    except TimeoutError as exc:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        _close_unstarted_awaitables(pending_awaitables, started)
        errors.append((len(pending_awaitables), exc))
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        _close_unstarted_awaitables(pending_awaitables, started)
        raise

    if errors:
        errors.sort(key=lambda error: error[0])
        partial_results = [
            None if result is _MISSING else result for result in results
        ]
        raise ConcurrencyError(
            (error for _, error in errors),
            results=partial_results,
        )

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
