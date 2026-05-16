"""BackgroundTasks with error handling, retry, and exponential backoff"""
import asyncio
import logging
from typing import Callable, Any, Optional, List, Coroutine
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

@dataclass
class TaskResult:
    task_name: str
    success: bool
    result: Any = None
    error: Optional[str] = None
    attempts: int = 1

class BackgroundTasks:
    """Background task manager with retry and exponential backoff.

    Args:
        max_retries: Maximum number of retry attempts (default: 3).
        base_delay: Initial delay in seconds before first retry (default: 1.0).
        max_delay: Maximum delay cap in seconds (default: 60.0).
        error_callback: Optional callback invoked with TaskResult on failure.

    Retry behavior:
        Delay between attempts: min(base_delay * 2^attempt, max_delay)
        Example with defaults: 1s -> 2s -> 4s
    """
    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        error_callback: Optional[Callable[[TaskResult], Any]] = None,
    ):
        self.max_retries = max(0, max_retries)
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.error_callback = error_callback
        self.tasks: List[Coroutine] = []
        self.task_results: List[TaskResult] = []

    def add_task(self, func: Callable[..., Coroutine], *args, **kwargs):
        task_name = kwargs.pop("task_name", getattr(func, "__name__", "unknown"))
        self.tasks.append((func, args, kwargs, task_name))

    async def run_all(self):
        results = []
        for func, args, kwargs, name in self.tasks:
            result = await self._run_with_retry(func, args, kwargs, name)
            results.append(result)
            self.task_results.append(result)
        return results

    async def _run_with_retry(self, func, args, kwargs, name) -> TaskResult:
        last_error = None
        for attempt in range(self.max_retries + 1):
            try:
                result = await func(*args, **kwargs)
                return TaskResult(task_name=name, success=True, result=result, attempts=attempt + 1)
            except Exception as e:
                last_error = str(e)
                logger.warning(f"Task '{name}' attempt {attempt + 1}/{self.max_retries + 1} failed: {e}")
                if attempt < self.max_retries:
                    delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                    await asyncio.sleep(delay)
        task_result = TaskResult(task_name=name, success=False, error=last_error, attempts=self.max_retries + 1)
        if self.error_callback:
            try:
                self.error_callback(task_result)
            except Exception:
                pass
        return task_result
