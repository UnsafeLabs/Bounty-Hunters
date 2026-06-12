from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Any, Awaitable, Sequence, TypeVar
import asyncio

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")


class ConcurrencyError(Exception):
    """Raised when one or more concurrent tasks fail."""

    def __init__(self, exceptions: list[BaseException]):
        self.exceptions = exceptions
        message = (
            f"{len(exceptions)} task(s) failed: "
            + "; ".join(f"{type(e).__name__}: {e}" for e in exceptions)
        )
        super().__init__(message)


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    max_concurrency: int = 5,
    timeout: float | None = None,
) -> list[_T]:
    """
    Run multiple coroutines concurrently with a concurrency limit.

    Args:
        coroutines: Sequence of coroutines to run.
        max_concurrency: Maximum number of coroutines to run simultaneously.
            If 1, runs sequentially. If greater than the number of coroutines,
            runs all at once.
        timeout: Optional timeout in seconds for the entire operation.
            If exceeded, cancels remaining tasks and returns partial results.
    Returns:
        List of results in the same order as the input coroutines.
        If timeout occurs, raises TimeoutError with partial results in `partial_results`.
    Raises:
        ConcurrencyError: If any coroutine raises an exception, contains all failures.
        TimeoutError: If timeout is exceeded, contains partial results in `partial_results`.
    """
    if not coroutines:
        return []

    # Handle edge case: max_concurrency of 1 runs sequentially
    if max_concurrency <= 1:
        results = []
        exceptions = []
        for coro in coroutines:
            try:
                results.append(await coro)
            except BaseException as e:
                exceptions.append(e)
        if exceptions:
            raise ConcurrencyError(exceptions)
        return results

    # Semaphore to limit concurrent execution
    semaphore = asyncio.Semaphore(max_concurrency)

    async def run_with_semaphore(index: int, coro: Awaitable[_T]) -> tuple[int, _T | BaseException, bool]:
        """Run a single coroutine with semaphore, returning (index, result_or_exception, success)."""
        async with semaphore:
            try:
                result = await coro
                return index, result, True
            except BaseException as e:
                return index, e, False

    # Create tasks for all coroutines
    tasks = [
        asyncio.create_task(run_with_semaphore(i, coro))
        for i, coro in enumerate(coroutines)
    ]

    completed: list[tuple[int, _T | BaseException, bool]] = []
    exceptions: list[BaseException] = []

    if timeout is not None:
        # Use asyncio.wait_for with a custom approach to handle timeout properly
        pending = set(tasks)
        start_time = asyncio.get_event_loop().time()
        remaining_time = timeout

        while pending:
            # Check if timeout would be exceeded
            if remaining_time <= 0:
                # Cancel all pending tasks
                for task in pending:
                    task.cancel()
                # Wait for cancelled tasks to finish
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)
                # Collect partial results
                partial_results = []
                for idx, result, success in sorted(completed, key=lambda x: x[0]):
                    if success:
                        partial_results.append(result)
                timeout_error = TimeoutError(f"Operation timed out after {timeout} seconds")
                timeout_error.partial_results = partial_results  # type: ignore[attr-defined]
                raise timeout_error

            try:
                done, pending = await asyncio.wait(
                    pending, timeout=remaining_time, return_when=asyncio.FIRST_COMPLETED
                )
            except asyncio.CancelledError:
                # Re-cancel pending tasks
                for task in pending:
                    task.cancel()
                raise

            for task in done:
                try:
                    idx, result, success = task.result()
                    completed.append((idx, result, success))
                    if not success:
                        exceptions.append(result)  # result is the exception
                except BaseException as e:
                    # Task itself failed (e.g., cancelled)
                    exceptions.append(e)

            elapsed = asyncio.get_event_loop().time() - start_time
            remaining_time = timeout - elapsed
    else:
        # No timeout - wait for all
        completed = await asyncio.gather(*tasks, return_exceptions=False)

    # Sort completed results by original index
    completed.sort(key=lambda x: x[0])

    # Build results in order
    results: list[_T] = []
    for idx, result, success in completed:
        if success:
            results.append(result)
        else:
            # result is the exception
            exceptions.append(result)

    if exceptions:
        raise ConcurrencyError(exceptions)

    return results


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