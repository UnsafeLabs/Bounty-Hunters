from collections.abc import AsyncGenerator, Awaitable, Sequence
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import TypeVar, cast

import anyio
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
        errors: Sequence[BaseException],
        partial_results: Sequence[object | None],
    ) -> None:
        super().__init__(f"{len(errors)} concurrent task(s) failed")
        self.errors = list(errors)
        self.partial_results = list(partial_results)


async def run_concurrently(
    awaitables: Sequence[Awaitable[_T]],
    *,
    max_concurrency: int = 5,
    timeout: float | None = None,
) -> list[_T]:
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be greater than 0")

    semaphore = anyio.Semaphore(max_concurrency)
    results: list[_T | None] = [None] * len(awaitables)
    errors: list[BaseException] = []

    async def run_one(index: int, awaitable: Awaitable[_T]) -> None:
        async with semaphore:
            try:
                results[index] = await awaitable
            except Exception as exc:
                errors.append(exc)

    async def run_all() -> None:
        async with anyio.create_task_group() as task_group:
            for index, awaitable in enumerate(awaitables):
                task_group.start_soon(run_one, index, awaitable)

    if timeout is None:
        await run_all()
    else:
        with anyio.move_on_after(timeout) as cancel_scope:
            await run_all()
        if cancel_scope.cancel_called:
            raise ConcurrencyError(
                [*errors, TimeoutError("concurrent tasks timed out")], results
            )

    if errors:
        raise ConcurrencyError(errors, results)

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
