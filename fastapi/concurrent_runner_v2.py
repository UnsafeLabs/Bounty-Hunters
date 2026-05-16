"""Concurrent task runner with semaphore limit and timeout"""
import asyncio
from typing import List, Callable, Awaitable, Any

class ConcurrentRunner:
    def __init__(self, max_concurrent=5, default_timeout=30):
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.default_timeout = default_timeout

    async def run(self, tasks: List[Callable[[], Awaitable[Any]]], timeout=None) -> List[Any]:
        t = timeout or self.default_timeout
        async def _with_semaphore(task):
            async with self.semaphore:
                return await asyncio.wait_for(task(), timeout=t)
        return await asyncio.gather(*[_with_semaphore(t) for t in tasks], return_exceptions=True)

    async def run_sequential(self, tasks, timeout=None):
        results = []
        for task in tasks:
            results.append(await asyncio.wait_for(task(), timeout=timeout or self.default_timeout))
        return results

    @property
    def max_concurrency(self):
        return self.semaphore._value
