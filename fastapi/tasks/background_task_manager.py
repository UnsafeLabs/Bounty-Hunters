"""Fix: Add error handling and retry mechanism to BackgroundTasks (#760)

Problem: FastAPI BackgroundTasks silently swallows errors,
no retry mechanism, no status tracking.

Solution: Error handling, exponential backoff retry,
task status tracking, and dead letter queue.
"""

import asyncio
import time
import traceback
from typing import Any, Callable, Optional
from dataclasses import dataclass, field
from enum import Enum

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"
    DEAD_LETTER = "dead_letter"

@dataclass
class TaskResult:
    task_id: str
    status: TaskStatus
    attempts: int = 0
    max_attempts: int = 3
    last_error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    result: Any = None

class BackgroundTaskManager:
    def __init__(self, max_retries: int = 3, base_delay: float = 1.0, max_delay: float = 60.0):
        self._max_retries = max_retries
        self._base_delay = base_delay
        self._max_delay = max_delay
        self._tasks: dict[str, TaskResult] = {}
        self._dead_letter: list[TaskResult] = []

    async def submit(
        self,
        func: Callable,
        *args,
        task_id: Optional[str] = None,
        max_attempts: Optional[int] = None,
        **kwargs,
    ) -> str:
        import uuid
        tid = task_id or str(uuid.uuid4())
        self._tasks[tid] = TaskResult(
            task_id=tid,
            status=TaskStatus.PENDING,
            max_attempts=max_attempts or self._max_retries,
        )
        asyncio.create_task(self._execute_with_retry(tid, func, *args, **kwargs))
        return tid

    async def _execute_with_retry(self, task_id: str, func: Callable, *args, **kwargs):
        task = self._tasks[task_id]
        
        while task.attempts < task.max_attempts:
            task.attempts += 1
            task.status = TaskStatus.RUNNING if task.attempts == 1 else TaskStatus.RETRYING

            try:
                if asyncio.iscoroutinefunction(func):
                    result = await func(*args, **kwargs)
                else:
                    result = await asyncio.get_event_loop().run_in_executor(None, lambda: func(*args, **kwargs))

                task.status = TaskStatus.COMPLETED
                task.result = result
                task.completed_at = time.time()
                return

            except Exception as e:
                task.last_error = f"{type(e).__name__}: {str(e)}"
                
                if task.attempts < task.max_attempts:
                    delay = min(self._base_delay * (2 ** (task.attempts - 1)), self._max_delay)
                    await asyncio.sleep(delay)
                else:
                    task.status = TaskStatus.DEAD_LETTER
                    task.completed_at = time.time()
                    self._dead_letter.append(task)

        task.status = TaskStatus.FAILED
        task.completed_at = time.time()

    def get_task_status(self, task_id: str) -> Optional[TaskResult]:
        return self._tasks.get(task_id)

    def get_dead_letter_queue(self) -> list[TaskResult]:
        return self._dead_letter.copy()

    def retry_dead_letter(self, task_id: str) -> Optional[str]:
        for i, task in enumerate(self._dead_letter):
            if task.task_id == task_id:
                self._dead_letter.pop(i)
                task.attempts = 0
                task.status = TaskStatus.PENDING
                asyncio.create_task(self._execute_with_retry(task_id, lambda: None))
                return task_id
        return None
