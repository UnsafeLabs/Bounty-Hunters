"""Concurrent task runner with semaphore limiting and timeout."""

import asyncio
from collections.abc import Coroutine
from typing import Any, TypeVar

_T = TypeVar("_T")


class ConcurrencyError(Exception):
    def __init__(
        self,
        message: str,
        errors: list[tuple[int, Exception]],
        partial_results: list[Any] | None = None,
    ):
        super().__init__(message)
        self.errors = errors
        self.partial_results = partial_results or []


async def run_concurrently(
    coroutines: list[Coroutine[Any, Any, _T]],
    max_concurrency: int = 10,
    timeout: float | None = None,
) -> list[_T]:
    if not coroutines:
        return []

    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")

    semaphore = asyncio.Semaphore(max_concurrency)
    results: list[Any] = [None] * len(coroutines)

    async def run_one(index: int, coro: Coroutine[Any, Any, _T]) -> None:
        async with semaphore:
            results[index] = await coro

    tasks = [asyncio.ensure_future(run_one(i, c)) for i, c in enumerate(coroutines)]

    done, pending = await asyncio.wait(tasks, timeout=timeout)

    for task in pending:
        task.cancel()

    errors: list[tuple[int, Exception]] = []

    for i, task in enumerate(tasks):
        if task.cancelled():
            timeout_err = asyncio.TimeoutError(
                f"Task {i} cancelled: total timeout {timeout}s exceeded"
            )
            errors.append((i, timeout_err))
        elif task.done():
            exc = task.exception()
            if exc is not None:
                errors.append((i, exc))

    if errors:
        partial = [
            results[i] if (i, None) not in {(e[0], None) for e in errors} else None
            for i in range(len(coroutines))
        ]
        raise ConcurrencyError(
            f"{len(errors)} of {len(coroutines)} task(s) failed",
            errors=errors,
            partial_results=partial,
        )

    return results