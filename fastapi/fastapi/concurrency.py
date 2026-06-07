from collections.abc import AsyncGenerator, Coroutine, Sequence
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Any, TypeVar

import anyio.to_thread
import asyncio
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
    """Raised when one or more coroutines in ``run_concurrently`` fail.

    Attributes:
        results: Results from coroutines that completed successfully.
        exceptions: List of ``(index, exception)`` tuples for failed coroutines.
    """

    def __init__(
        self,
        message: str,
        *,
        results: list[Any],
        exceptions: list[tuple[int, BaseException]],
    ) -> None:
        self.results = results
        self.exceptions = exceptions
        super().__init__(message)


async def run_concurrently(
    coros: Sequence[Coroutine[Any, Any, _T]],
    max_concurrency: int = 5,
    timeout: float | None = None,
) -> list[_T]:
    """Run multiple coroutines concurrently with a concurrency limit.

    Uses an ``asyncio.Semaphore`` to cap the number of concurrently executing
    coroutines.  Results are returned in the same order as the input coroutines.

    Args:
        coros: Sequence of coroutines to execute.
        max_concurrency: Maximum number of coroutines to run at once.
        timeout: Optional per-coroutine timeout in seconds.  If a coroutine
            does not complete within this time it is cancelled.

    Returns:
        List of results in the same order as the input coroutines.

    Raises:
        ConcurrencyError: If **any** coroutine raised an exception.  The
            exception contains both partial results and the list of failures.
    """
    sem = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coros)
    failures: list[tuple[int, BaseException]] = []

    async def _run_one(idx: int, coro: Coroutine[Any, Any, _T]) -> None:
        async with sem:
            try:
                if timeout is not None:
                    results[idx] = await asyncio.wait_for(coro, timeout=timeout)
                else:
                    results[idx] = await coro
            except BaseException as exc:
                failures.append((idx, exc))

    tasks = [asyncio.create_task(_run_one(i, c)) for i, c in enumerate(coros)]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    if failures:
        msg = f"{len(failures)} of {len(coros)} coroutines failed"
        raise ConcurrencyError(msg, results=results, exceptions=failures)
    return results
