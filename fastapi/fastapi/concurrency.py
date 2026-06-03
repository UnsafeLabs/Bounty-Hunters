from collections.abc import AsyncGenerator
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


import asyncio
from typing import Any, Coroutine


class ConcurrencyError(Exception):
    def __init__(self, failures: list[Exception]):
        super().__init__(f"Concurrency execution failed with {len(failures)} error(s)")
        self.failures = failures


async def run_concurrently(
    coroutines: list[Coroutine[Any, Any, _T]],
    max_concurrency: int,
    timeout: float | None = None,
) -> list[Any]:
    if not coroutines:
        return []

    sem = asyncio.Semaphore(max_concurrency)

    async def worker(coro: Coroutine[Any, Any, _T]) -> _T:
        async with sem:
            return await coro

    tasks = [asyncio.create_task(worker(c)) for c in coroutines]

    timed_out = False
    if timeout is not None:
        try:
            done, pending = await asyncio.wait(tasks, timeout=timeout)
            if pending:
                timed_out = True
                for t in pending:
                    t.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
        except Exception:
            pass
    else:
        await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    failures = []

    for t in tasks:
        if t.done():
            if t.cancelled():
                results.append(asyncio.TimeoutError("Task timed out"))
            else:
                exc = t.exception()
                if exc is not None:
                    failures.append(exc)
                    results.append(exc)
                else:
                    results.append(t.result())
        else:
            results.append(asyncio.TimeoutError("Task timed out"))

    if failures:
        raise ConcurrencyError(failures)

    if timed_out:
        partial_results = [r for r in results if not isinstance(r, Exception)]
        return partial_results + [asyncio.TimeoutError("Execution timed out")]

    return results

