"""BackgroundTasks with exception handling and retry"""
import asyncio, logging
from typing import Callable, List, Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger("fastapi.background")

@dataclass
class TaskResult:
    status: str = "pending"
    error: Optional[str] = None
    retries: int = 0

class BackgroundTasks:
    def __init__(self, max_retries: int = 3, error_callback: Optional[Callable] = None):
        self.tasks: List[Callable] = []
        self.max_retries = max_retries
        self.error_callback = error_callback
        self.task_results: List[TaskResult] = []

    def add_task(self, func: Callable, *args: Any, **kwargs: Any) -> None:
        self.tasks.append((func, args, kwargs))

    async def __call__(self) -> None:
        for func, args, kwargs in self.tasks:
            result = TaskResult()
            for attempt in range(self.max_retries + 1):
                try:
                    if asyncio.iscoroutinefunction(func):
                        await func(*args, **kwargs)
                    else:
                        func(*args, **kwargs)
                    result.status = "success"
                    result.retries = attempt
                    break
                except Exception as e:
                    logger.error(f"Background task {func.__name__} failed (attempt {attempt+1}): {e}")
                    result.error = str(e)
                    result.retries = attempt + 1
                    if attempt >= self.max_retries:
                        result.status = "failed"
                        if self.error_callback:
                            self.error_callback(e, func.__name__)
                    else:
                        base_delay = 1.0
                        await asyncio.sleep(base_delay * (2 ** attempt))
            self.task_results.append(result)
