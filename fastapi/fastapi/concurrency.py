import asyncio
from collections.abc import AsyncGenerator, Coroutine
from contextlib import AbstractContextManager
from contextlib import asynccontextmanager as asynccontextmanager
from typing import Any, List, Optional, TypeVar

import anyio.to_thread
from anyio import CapacityLimiter

# ... (rest of imports)

_T = TypeVar("_T")


class ConcurrencyError(Exception):
    """Raised when one or more concurrent tasks fail."""
    def __init__(self, exceptions: List[Exception]):
        self.exceptions = exceptions
        super().__init__(f"{len(exceptions)} tasks failed")


async def run_concurrently(
    coroutines: List[Coroutine[Any, Any, _T]],
    max_concurrency: int,
    timeout: Optional[float] = None,
) -> List[Optional[_T]]:
    """
    Executes a list of coroutines concurrently with a semaphore limit.
    Returns results in the same order as input coroutines.
    """
    semaphore = asyncio.Semaphore(max_concurrency)

    async def sem_coro(coro: Coroutine[Any, Any, _T]) -> _T:
        async with semaphore:
            return await coro

    tasks = [asyncio.create_task(sem_coro(c)) for coro in coroutines]
    
    try:
        if timeout:
            done, pending = await asyncio.wait(
                tasks, timeout=timeout, return_when=asyncio.ALL_COMPLETED
            )
            for p in pending:
                p.cancel()
        else:
            await asyncio.gather(*tasks, return_exceptions=True)

        results = []
        exceptions = []
        for task in tasks:
            if task.cancelled():
                results.append(None)
            elif task.exception():
                exceptions.append(task.exception())
                results.append(None)
            else:
                results.append(task.result())

        if exceptions:
            raise ConcurrencyError(exceptions)

        return results
    except Exception as e:
        if isinstance(e, ConcurrencyError):
            raise e
        # Handle unexpected errors
        for task in tasks:
            if not task.done():
                task.cancel()
        raise e


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
