import asyncio
from collections.abc import AsyncGenerator
from collections.abc import Awaitable
from collections.abc import Iterable
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Generic
from typing import TypeVar

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")


class ConcurrencyError(Exception, Generic[_T]):
    """Raised when one or more concurrent tasks fail or time out."""

    def __init__(
        self,
        exceptions: list[BaseException],
        partial_results: list[_T | None] | None = None,
    ) -> None:
        self.exceptions = exceptions
        self.partial_results = partial_results or []
        super().__init__(f"{len(exceptions)} concurrent task(s) failed")


async def run_concurrently(
    awaitables: Iterable[Awaitable[_T]],
    *,
    max_concurrency: int = 5,
    timeout: float | None = None,
) -> list[_T]:
    """Run awaitables with a concurrency limit and preserve input order."""

    if max_concurrency < 1:
        raise ValueError("max_concurrency must be at least 1")

    awaitable_list = list(awaitables)
    if not awaitable_list:
        return []

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[_T | None] = [None] * len(awaitable_list)
    exceptions: list[BaseException] = []

    async def run_one(index: int, awaitable: Awaitable[_T]) -> None:
        async with semaphore:
            try:
                results[index] = await awaitable
            except BaseException as exc:
                exceptions.append(exc)

    tasks = [
        asyncio.create_task(run_one(index, awaitable))
        for index, awaitable in enumerate(awaitable_list)
    ]

    done, pending = await asyncio.wait(tasks, timeout=timeout)
    if pending:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        exceptions.append(TimeoutError("concurrent tasks timed out"))
    if done:
        await asyncio.gather(*done, return_exceptions=True)

    if exceptions:
        raise ConcurrencyError(exceptions, results)

    return [result for result in results]


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
