from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Coroutine
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Any, TypeVar

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
    """Raised when one or more tasks fail during concurrent execution.

    Attributes:
        exceptions: List of ``(index, exception)`` tuples for each failed task.
    """

    def __init__(self, exceptions: list[tuple[int, BaseException]]) -> None:
        self.exceptions = exceptions
        messages = [f"Task {idx}: {exc!r}" for idx, exc in exceptions]
        super().__init__(
            f"{len(exceptions)} task(s) failed: {'; '.join(messages)}"
        )


async def run_concurrently(
    *coroutines: Coroutine[Any, Any, Any],
    max_concurrency: int = 10,
    timeout: float | None = None,
) -> list[Any]:
    """Run multiple coroutines concurrently with a concurrency limit.

    Executes *coroutines* using an ``asyncio.Semaphore`` to limit the number
    of tasks running at the same time.  Results are returned in the same order
    as the input, regardless of completion order.

    Parameters
    ----------
    *coroutines:
        The coroutines to execute.
    max_concurrency:
        Maximum number of tasks that may execute simultaneously.
        ``1`` runs them sequentially; a value larger than the number of
        coroutines runs them all at once.
    timeout:
        Optional timeout in seconds.  If the total execution time exceeds
        this value, remaining tasks are cancelled and a ``TimeoutError`` is
        raised (or partial results plus timeout error are collected).

    Returns
    -------
    list[Any]
        Results in the same order as the input coroutines.

    Raises
    ------
    ConcurrencyError
        If any coroutine raises an exception.  The ``exceptions`` attribute
        contains ``(index, exception)`` tuples for each failure.
    TimeoutError
        If *timeout* is exceeded and there are still pending tasks.
    """
    if not coroutines:
        return []

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coroutines)
    failures: list[tuple[int, BaseException]] = []

    async def _run_one(index: int, coro: Coroutine[Any, Any, Any]) -> None:
        async with semaphore:
            try:
                results[index] = await coro
            except BaseException as exc:
                failures.append((index, exc))

    tasks = [
        asyncio.create_task(_run_one(i, coro))
        for i, coro in enumerate(coroutines)
    ]

    try:
        if timeout is not None:
            done, pending = await asyncio.wait(tasks, timeout=timeout)
            # Cancel any tasks that are still pending.
            for t in pending:
                t.cancel()
            # Wait for cancelled tasks to finish cancellation.
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            # Check if any pending tasks timed out.
            for i, t in enumerate(tasks):
                if t in pending:
                    failures.append((i, asyncio.TimeoutError("Task timed out")))
        else:
            await asyncio.gather(*tasks)
    except Exception:
        # Cancel all tasks on unexpected error.
        for t in tasks:
            t.cancel()
        raise

    if failures:
        raise ConcurrencyError(failures)

    return results
