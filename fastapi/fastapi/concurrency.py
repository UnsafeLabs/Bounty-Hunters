import asyncio
from collections.abc import AsyncGenerator, Awaitable, Sequence
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import TypeVar, cast

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")
_UNSET: object = object()


class ConcurrencyError(Exception):
    """Raised when one or more concurrent tasks fail."""

    def __init__(
        self,
        failures: list[BaseException],
        *,
        partial_results: list[_T] | None = None,
    ) -> None:
        super().__init__(self._message(failures))
        self.failures = failures
        self.partial_results = partial_results

    @staticmethod
    def _message(failures: list[BaseException]) -> str:
        messages = [f"  - {exc}" for exc in failures]
        return "Concurrent run failed:\n" + "\n".join(messages)


async def _run_in_slot(
    index: int,
    coroutine: Awaitable[_T],
    limiter: asyncio.Semaphore,
) -> tuple[int, _T]:
    async with limiter:
        return index, await coroutine


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    *,
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")

    if not coroutines:
        return []

    limiter = asyncio.Semaphore(max_concurrency)
    tasks: list[asyncio.Task[tuple[int, _T]]] = [
        asyncio.create_task(_run_in_slot(index, coroutine, limiter))
        for index, coroutine in enumerate(coroutines)
    ]
    completed: list[_T | object] = [_UNSET] * len(coroutines)
    failures: list[BaseException] = []

    try:
        if timeout is None:
            raw_results = await asyncio.gather(*tasks, return_exceptions=True)
        else:
            raw_results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=timeout,
            )
    except asyncio.TimeoutError as exc:
        failures.append(exc)
        for task in tasks:
            if not task.done():
                task.cancel()
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    for result in raw_results:
        if isinstance(result, asyncio.CancelledError):
            continue
        if isinstance(result, BaseException):
            failures.append(result)
            continue
        index, value = result
        completed[index] = value

    if failures:
        partial_results = [cast(_T, value) for value in completed if value is not _UNSET]
        raise ConcurrencyError(failures=failures, partial_results=partial_results)

    return cast(list[_T], completed)


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
