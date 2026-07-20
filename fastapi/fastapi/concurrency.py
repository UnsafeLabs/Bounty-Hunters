import asyncio
from collections.abc import AsyncGenerator, Awaitable, Coroutine, Sequence
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Any, List, Optional, TypeVar, Union

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")


class ConcurrencyError(Exception):
    """Raised when one or more concurrent tasks fail.

    `exceptions` is a list aligned with the input tasks: `None` for successes,
    or the exception instance for failures.
    """

    def __init__(
        self,
        message: str,
        exceptions: List[Optional[BaseException]],
        results: Optional[List[Any]] = None,
    ) -> None:
        super().__init__(message)
        self.exceptions = exceptions
        self.results = results

    @property
    def failures(self) -> List[BaseException]:
        return [e for e in self.exceptions if e is not None]


async def run_concurrently(
    coroutines: Sequence[Union[Coroutine[Any, Any, _T], Awaitable[_T]]],
    max_concurrency: int = 10,
    timeout: Optional[float] = None,
) -> List[_T]:
    """
    Run awaitables concurrently with a semaphore limit.

    - Results are returned in the same order as `coroutines`.
    - If any task fails, a `ConcurrencyError` is raised after all tasks finish
      (or are cancelled on timeout), carrying every failure.
    - If `timeout` is exceeded, remaining tasks are cancelled and a
      `ConcurrencyError` is raised with partial `results` (successes filled,
      failures/timeouts as exceptions).
    """
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")

    n = len(coroutines)
    if n == 0:
        return []

    sem = asyncio.Semaphore(max_concurrency)
    results: List[Any] = [None] * n
    errors: List[Optional[BaseException]] = [None] * n

    async def _run(index: int, coro: Union[Coroutine[Any, Any, _T], Awaitable[_T]]) -> None:
        async with sem:
            try:
                results[index] = await coro
            except asyncio.CancelledError:
                # Treat cancel as timeout/cancellation error for that slot
                errors[index] = asyncio.TimeoutError("task cancelled due to timeout")
                raise
            except BaseException as exc:  # noqa: BLE001 — collect all failures
                errors[index] = exc

    tasks = [
        asyncio.create_task(_run(i, c), name=f"run_concurrently[{i}]")
        for i, c in enumerate(coroutines)
    ]

    try:
        if timeout is None:
            await asyncio.gather(*tasks, return_exceptions=True)
        else:
            done, pending = await asyncio.wait(
                tasks, timeout=timeout, return_when=asyncio.ALL_COMPLETED
            )
            if pending:
                for t in pending:
                    t.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                # Mark slots still empty without error as timeout
                for i in range(n):
                    if errors[i] is None and results[i] is None and not tasks[i].done():
                        errors[i] = asyncio.TimeoutError("timeout")
                    elif errors[i] is None and results[i] is None:
                        # cancelled path may have set TimeoutError already
                        if tasks[i].cancelled() and errors[i] is None:
                            errors[i] = asyncio.TimeoutError("timeout")
                # Fill any cancelled tasks that raised CancelledError into errors
                for i, t in enumerate(tasks):
                    if errors[i] is None and results[i] is None:
                        errors[i] = asyncio.TimeoutError("timeout")
    finally:
        # Ensure no dangling tasks
        for t in tasks:
            if not t.done():
                t.cancel()

    if any(e is not None for e in errors):
        raise ConcurrencyError(
            "One or more concurrent tasks failed",
            exceptions=errors,
            results=list(results),
        )

    return list(results)  # type: ignore[return-value]


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
