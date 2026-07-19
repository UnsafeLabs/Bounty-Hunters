import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any


class ConcurrentTaskRunner:
    """Run async tasks concurrently with semaphore limiting and timeout."""

    def __init__(
        self,
        max_concurrency: int = 10,
        default_timeout: float = 30.0,
    ) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._default_timeout = default_timeout

    async def run(
        self,
        coro: Awaitable[Any],
        timeout: float | None = None,
    ) -> Any:
        timeout = timeout or self._default_timeout
        async with self._semaphore:
            return await asyncio.wait_for(coro, timeout=timeout)

    async def run_many(
        self,
        coros: list[Awaitable[Any]],
        timeout: float | None = None,
    ) -> list[Any]:
        tasks = [self.run(coro, timeout=timeout) for coro in coros]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return list(results)

    async def run_with_retry(
        self,
        func: Callable[..., Awaitable[Any]],
        *args: Any,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        timeout: float | None = None,
        **kwargs: Any,
    ) -> Any:
        last_exc: Exception | None = None
        for attempt in range(1, max_retries + 2):
            try:
                return await self.run(func(*args, **kwargs), timeout=timeout)
            except Exception as e:
                last_exc = e
                if attempt <= max_retries:
                    await asyncio.sleep(retry_delay * (2 ** (attempt - 1)))
        if last_exc:
            raise last_exc
