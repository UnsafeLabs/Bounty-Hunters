import asyncio
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
    def __init__(self, exceptions: list[Exception]) -> None:
        self.exceptions = exceptions
        super().__init__(f"{len(exceptions)} task(s) failed: {exceptions}")


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
    coros: Sequence[Coroutine[Any, Any, _T]],
    max_concurrency: int = 0,
    timeout: float | None = None,
) -> list[_T]:
    semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency > 0 else None
    exceptions: list[Exception] = []
    results: list[_T | None] = [None] * len(coros)
    completed = [False] * len(coros)

    async def _run(idx: int, coro: Coroutine[Any, Any, _T]) -> None:
        try:
            if semaphore:
                async with semaphore:
                    results[idx] = await coro
            else:
                results[idx] = await coro
            completed[idx] = True
        except Exception as e:
            exceptions.append(e)
            completed[idx] = True

    tasks = [_run(i, c) for i, c in enumerate(coros)]
    if timeout is not None:
        try:
            await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=timeout)
        except asyncio.TimeoutError:
            timeout_error = TimeoutError(f"Task execution timed out after {timeout}s")
            for i, done in enumerate(completed):
                if not done:
                    exceptions.append(timeout_error)
                    completed[i] = True
    else:
        await asyncio.gather(*tasks)

    if exceptions:
        raise ConcurrencyError(exceptions)
    return list(results)  # type: ignore[return-value]
