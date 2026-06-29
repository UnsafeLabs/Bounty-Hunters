import asyncio
from collections.abc import AsyncGenerator, Awaitable, Sequence
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Any, TypeVar, cast

import anyio.to_thread
from anyio import CapacityLimiter
from starlette.concurrency import iterate_in_threadpool as iterate_in_threadpool  # noqa
from starlette.concurrency import run_in_threadpool as run_in_threadpool  # noqa
from starlette.concurrency import (  # noqa
    run_until_first_complete as run_until_first_complete,
)

_T = TypeVar("_T")


class ConcurrencyError(Exception):
    def __init__(
        self,
        failures: Sequence[BaseException],
        partial_results: Sequence[Any | None],
    ) -> None:
        self.failures = list(failures)
        self.partial_results = list(partial_results)
        super().__init__(f"{len(self.failures)} concurrent task(s) failed")


async def run_concurrently(
    coroutines: Sequence[Awaitable[_T]],
    max_concurrency: int,
    timeout: float | None = None,
) -> list[_T]:
    if max_concurrency < 1:
        for coroutine in coroutines:
            if hasattr(coroutine, "close"):
                coroutine.close()
        raise ValueError("max_concurrency must be greater than 0")

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any | None] = [None] * len(coroutines)
    failures: list[BaseException] = []
    started = [False] * len(coroutines)

    async def run_one(index: int, coroutine: Awaitable[_T]) -> None:
        try:
            async with semaphore:
                started[index] = True
                results[index] = await coroutine
        except asyncio.CancelledError:
            if not started[index] and hasattr(coroutine, "close"):
                coroutine.close()
            raise
        except Exception as exc:
            failures.append(exc)

    tasks = [
        asyncio.create_task(run_one(index, coroutine))
        for index, coroutine in enumerate(coroutines)
    ]
    done, pending = await asyncio.wait(tasks, timeout=timeout)

    if pending:
        failures.append(
            TimeoutError(f"Concurrent task execution exceeded {timeout} seconds")
        )

        for task in pending:
            task.cancel()

        await asyncio.gather(*pending, return_exceptions=True)

    await asyncio.gather(*done, return_exceptions=True)

    if failures:
        raise ConcurrencyError(failures, results)

    return cast(list[_T], results)


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
