"""BackgroundTasks with exponential backoff and TaskResult tracking"""
import asyncio, logging
from typing import Callable, Any, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class TaskResult:
    task_name: str; success: bool; result: Any = None; error: Optional[str] = None; attempts: int = 1

class BackgroundTasks:
    """Background task manager with retry and exponential backoff.
    max_retries: max retry attempts (default 3)
    base_delay: initial delay seconds (default 1.0)
    max_delay: delay cap seconds (default 60.0)
    error_callback: optional callback(TaskResult) on failure
    Retry: min(base_delay * 2^attempt, max_delay)"""
    def __init__(self, max_retries=3, base_delay=1.0, max_delay=60.0, error_callback=None):
        self.max_retries = max(0, max_retries); self.base_delay = base_delay
        self.max_delay = max_delay; self.error_callback = error_callback
        self.tasks = []; self.task_results = []

    def add_task(self, func, *args, **kwargs):
        name = kwargs.pop("task_name", getattr(func, "__name__", "unknown"))
        self.tasks.append((func, args, kwargs, name))

    async def run_all(self):
        results = []
        for func, args, kwargs, name in self.tasks:
            result = await self._run_with_retry(func, args, kwargs, name)
            results.append(result); self.task_results.append(result)
        return results

    async def _run_with_retry(self, func, args, kwargs, name):
        last_error = None
        for attempt in range(self.max_retries + 1):
            try: result = await func(*args, **kwargs)
            except Exception as e:
                last_error = str(e)
                if attempt < self.max_retries:
                    delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                    await asyncio.sleep(delay)
                continue
            return TaskResult(task_name=name, success=True, result=result, attempts=attempt + 1)
        tr = TaskResult(task_name=name, success=False, error=last_error, attempts=self.max_retries + 1)
        if self.error_callback:
            try: self.error_callback(tr)
            except Exception: pass
        return tr
