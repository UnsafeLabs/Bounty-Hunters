from collections.abc import AsyncGenerator, Coroutine, Sequence
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


class ConcurrencyError(Exception):
    """Raised when one or more tasks fail during concurrent execution."""

    def __init__(self, errors: list[Exception], partial_results: list[Any]) -> None:
        self.errors = errors
        self.partial_results = partial_results
        super().__init__(
            f"{len(errors)} task(s) failed: {[str(e) for e in errors]}"
        )


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


async def run_concurrently(
    coroutines: Sequence[Coroutine[Any, Any, _T]],
    max_concurrency: int = 10,
    timeout: float | None = None,
) -> list[_T]:
    """Run multiple coroutines concurrently with a concurrency limit.

    Args:
        coroutines: Sequence of coroutines to execute.
        max_concurrency: Maximum number of tasks running at once.
            Use 1 for sequential execution. Values greater than the
            number of coroutines run all tasks at once.
        timeout: Optional total timeout in seconds. If exceeded,
            remaining tasks are cancelled and a ConcurrencyError is
            raised with partial results.

    Returns:
        List of results in the same order as the input coroutines.

    Raises:
        ConcurrencyError: If one or more tasks fail or timeout occurs.
    """
    import asyncio

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coroutines)
    errors: list[Exception | None] = [None] * len(coroutines)

    async def _run_task(index: int, coro: Coroutine[Any, Any, _T]) -> None:
        async with semaphore:
            try:
                results[index] = await coro
            except Exception as exc:
                errors[index] = exc

    tasks = [asyncio.create_task(_run_task(i, c)) for i, c in enumerate(coroutines)]

    try:
        if timeout is not None:
            done, pending = await asyncio.wait(tasks, timeout=timeout)
            for t in pending:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
            # Mark pending tasks as timeout errors
            timed_out = [t for t in pending]
            for t in timed_out:
                idx = tasks.index(t)
                if errors[idx] is None:
                    errors[idx] = TimeoutError(
                        f"Task {idx} timed out after {timeout}s"
                    )
        else:
            await asyncio.gather(*tasks, return_exceptions=True)
    except Exception:
        # Ensure all tasks are cleaned up
        for t in tasks:
            if not t.done():
                t.cancel()
        raise

    failed = [(i, e) for i, e in enumerate(errors) if e is not None]
    if failed:
        raise ConcurrencyError(
            errors=[e for _, e in failed],
            partial_results=results,
        )

    return results
