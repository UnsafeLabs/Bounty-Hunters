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


from __future__ import annotations

import asyncio
from typing import Any, Coroutine, Sequence


class ConcurrencyError(Exception):
    def __init__(self, errors: list[BaseException]) -> None:
        self.errors = errors
        super().__init__(f"{len(errors)} task(s) failed: {', '.join(str(e) for e in errors)}")


async def run_concurrently(
    coros: Sequence[Coroutine[Any, Any, Any]],
    max_concurrency: int = 5,
    timeout: float | None = None,
) -> list[Any]:
    semaphore = asyncio.Semaphore(max_concurrency)
    results: dict[int, Any] = {}
    errors: dict[int, BaseException] = {}

    async def run_with_semaphore(index: int, coro: Coroutine[Any, Any, Any]) -> None:
        async with semaphore:
            try:
                result = await coro
                results[index] = result
            except BaseException as e:
                errors[index] = e

    tasks = [run_with_semaphore(i, coro) for i, coro in enumerate(coros)]
    done, pending = await asyncio.wait(tasks, timeout=timeout, return_when=asyncio.ALL_COMPLETED)

    if pending:
        for task in pending:
            task.cancel()
        if not errors:
            raise TimeoutError(f"Task timed out after {timeout}s")

    if errors:
        raise ConcurrencyError(list(errors.values()))

    return [results[i] for i in range(len(coros))]
