from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, TypeVar

_T = TypeVar("_T")


@dataclass
class TaskResult:
    result: Any = None
    exception: BaseException | None = field(default=None)
    timed_out: bool = False


class TaskRunner:
    def __init__(
        self,
        max_concurrent: int = 10,
        timeout: float | None = None,
    ) -> None:
        if max_concurrent < 1:
            raise ValueError("max_concurrent must be >= 1")
        if timeout is not None and timeout <= 0:
            raise ValueError("timeout must be > 0")
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._timeout = timeout

    async def _run_one(
        self,
        coro: Coroutine[Any, Any, _T],
        timeout: float | None,
    ) -> TaskResult:
        effective_timeout = timeout if timeout is not None else self._timeout
        async with self._semaphore:
            try:
                if effective_timeout is not None:
                    result = await asyncio.wait_for(coro, timeout=effective_timeout)
                else:
                    result = await coro
                return TaskResult(result=result)
            except asyncio.TimeoutError:
                return TaskResult(timed_out=True)
            except Exception as exc:
                return TaskResult(exception=exc)

    async def run(
        self,
        coro: Coroutine[Any, Any, _T],
        timeout: float | None = None,
    ) -> TaskResult:
        return await self._run_one(coro, timeout=timeout)

    async def run_many(
        self,
        coros: list[Coroutine[Any, Any, Any]],
        timeout: float | None = None,
    ) -> list[TaskResult]:
        tasks = [self._run_one(c, timeout=timeout) for c in coros]
        return list(await asyncio.gather(*tasks))
