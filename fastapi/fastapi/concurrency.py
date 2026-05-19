from collections.abc import AsyncGenerator, Awaitable, Sequence
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
    """Raised when one or more coroutines fail during concurrent execution.

    Attributes:
        errors: A list of (index, exception) tuples for each failed coroutine.
        results: Partial results for coroutines that completed successfully.
    """

    def __init__(
        self,
        errors: list[tuple[int, Exception]],
        results: list[_T],
    ) -> None:
        self.errors = errors
        self.results = results
        messages = [f"Task {idx}: {e!r}" for idx, e in errors]
        super().__init__("\n".join(messages))


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    *,
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    """Run multiple coroutines concurrently with a concurrency limit.

    Args:
        coroutines: A sequence of coroutines to execute.
        max_concurrency: Maximum number of coroutines to run simultaneously.
        timeout: Optional total timeout in seconds. Raises TimeoutError
            if exceeded.

    Returns:
        Results in the same order as the input coroutines.

    Raises:
        ConcurrencyError: If any coroutine raises an exception. Contains
            partial results and all collected errors.
        TimeoutError: If the timeout is exceeded.
    """
    import asyncio

    count = len(coroutines)
    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[_T] = [None] * count  # type: ignore[assignment]
    errors: list[tuple[int, Exception]] = []

    async def _run_one(idx: int, coro: Awaitable[_T]) -> None:
        async with semaphore:
            try:
                results[idx] = await coro
            except Exception as exc:
                errors.append((idx, exc))

    tasks = [asyncio.create_task(_run_one(i, c)) for i, c in enumerate(coroutines)]

    try:
        if timeout is not None:
            await asyncio.wait_for(
                asyncio.gather(*tasks),
                timeout=timeout,
            )
        else:
            await asyncio.gather(*tasks)
    except asyncio.TimeoutError:
        for t in tasks:
            t.cancel()
        raise

    if errors:
        raise ConcurrencyError(
            errors=errors,
            results=results,  # type: ignore[arg-type]
        )

    return results  # type: ignore[return-value]
