"""
Concurrent task runner with semaphore limiting and timeout.
Provides utilities for running multiple async tasks with concurrency control.
"""
import asyncio
from typing import List, Callable, Any, Optional, TypeVar, Coroutine
from dataclasses import dataclass
from enum import Enum

T = TypeVar("T")


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


@dataclass
class TaskResult:
    """Result of a concurrent task execution."""
    task_id: int
    status: TaskStatus
    result: Any = None
    error: Optional[str] = None
    duration_ms: float = 0


async def run_concurrent(
    tasks: List[Callable[[], Coroutine[Any, Any, T]]],
    max_concurrent: int = 10,
    timeout: Optional[float] = None,
) -> List[TaskResult]:
    """
    Run multiple async tasks with concurrency limiting.

    Args:
        tasks: List of async callables to execute
        max_concurrent: Maximum concurrent tasks (default: 10)
        timeout: Timeout in seconds for each task (default: None = no timeout)

    Returns:
        List of TaskResult with status, result, and error info

    Usage:
        async def fetch(url):
            async with aiohttp.ClientSession() as s:
                return await s.get(url)

        results = await run_concurrent(
            [lambda: fetch(url1), lambda: fetch(url2)],
            max_concurrent=5,
            timeout=30,
        )
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    results: List[TaskResult] = [None] * len(tasks)  # type: ignore

    async def _run_task(index: int, task_fn: Callable) -> None:
        async with semaphore:
            start = asyncio.get_event_loop().time()
            try:
                if timeout:
                    result = await asyncio.wait_for(task_fn(), timeout=timeout)
                else:
                    result = await task_fn()

                duration = (asyncio.get_event_loop().time() - start) * 1000
                results[index] = TaskResult(
                    task_id=index,
                    status=TaskStatus.COMPLETED,
                    result=result,
                    duration_ms=duration,
                )
            except asyncio.TimeoutError:
                duration = (asyncio.get_event_loop().time() - start) * 1000
                results[index] = TaskResult(
                    task_id=index,
                    status=TaskStatus.TIMEOUT,
                    error=f"Task timed out after {timeout}s",
                    duration_ms=duration,
                )
            except Exception as e:
                duration = (asyncio.get_event_loop().time() - start) * 1000
                results[index] = TaskResult(
                    task_id=index,
                    status=TaskStatus.FAILED,
                    error=str(e),
                    duration_ms=duration,
                )

    # Run all tasks concurrently with semaphore
    await asyncio.gather(*[_run_task(i, task) for i, task in enumerate(tasks)])

    return results


async def run_batched(
    tasks: List[Callable[[], Coroutine[Any, Any, T]]],
    batch_size: int = 10,
    delay_between_batches: float = 0,
) -> List[TaskResult]:
    """
    Run tasks in batches with optional delay between batches.

    Args:
        tasks: List of async callables
        batch_size: Tasks per batch
        delay_between_batches: Seconds to wait between batches

    Returns:
        List of TaskResult
    """
    all_results = []

    for i in range(0, len(tasks), batch_size):
        batch = tasks[i:i + batch_size]
        batch_results = await run_concurrent(batch, max_concurrent=batch_size)
        all_results.extend(batch_results)

        if delay_between_batches and i + batch_size < len(tasks):
            await asyncio.sleep(delay_between_batches)

    return all_results
