from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Annotated, Any

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from starlette.background import BackgroundTask as StarletteBackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from typing_extensions import ParamSpec

from fastapi.logger import logger

P = ParamSpec("P")


class TaskResult:
    """Stores the outcome of a background task execution."""

    def __init__(self, func_name: str) -> None:
        self.func_name: str = func_name
        self.status: str = "pending"
        self.exception: str | None = None
        self.retry_count: int = 0

    def succeeded(self) -> None:
        self.status = "success"

    def failed(self, exception: str, retry_count: int = 0) -> None:
        self.status = "failed"
        self.exception = exception
        self.retry_count = retry_count


class BackgroundTask(StarletteBackgroundTask):
    """A single background task with error handling, retry support, and result tracking."""

    def __init__(
        self,
        func: Callable[P, Any],
        *args: P.args,
        error_callback: Callable[[Exception, str], None] | None = None,
        max_retries: int = 0,
        task_result: TaskResult | None = None,
        **kwargs: P.kwargs,
    ) -> None:
        super().__init__(func, *args, **kwargs)
        self.error_callback = error_callback
        self.max_retries = max_retries
        self.task_result = task_result

    async def __call__(self) -> None:
        last_exception: Exception | None = None
        attempts = 0
        max_attempts = self.max_retries + 1

        while attempts < max_attempts:
            attempts += 1
            try:
                if self.is_async:
                    await self.func(*self.args, **self.kwargs)
                else:
                    await run_in_threadpool(self.func, *self.args, **self.kwargs)

                if self.task_result is not None:
                    self.task_result.succeeded()
                return
            except Exception as e:
                last_exception = e
                func_name = getattr(self.func, "__name__", str(self.func))
                logger.exception(
                    "Background task '%s' failed (attempt %d/%d): %s",
                    func_name,
                    attempts,
                    max_attempts,
                    e,
                )

                if self.error_callback is not None:
                    self.error_callback(e, func_name)

                if attempts >= max_attempts:
                    if self.task_result is not None:
                        self.task_result.failed(str(e), retry_count=attempts - 1)
                    return


class BackgroundTasks(StarletteBackgroundTasks):
    """
    A collection of background tasks that will be called after a response has been
    sent to the client.

    Supports error handling, retry logic, and result inspection.

    Read more about it in the
    [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).

    ## Example

    ```python
    from fastapi import BackgroundTasks, FastAPI

    app = FastAPI()

    def write_notification(email: str, message=""):
        with open("log.txt", mode="w") as email_file:
            content = f"notification for {email}: {message}"
            email_file.write(content)

    @app.post("/send-notification/{email}")
    async def send_notification(email: str, background_tasks: BackgroundTasks):
        background_tasks.add_task(write_notification, email, message="some notification")
        return {"message": "Notification sent in the background"}
    ```
    """

    def __init__(
        self,
        tasks: list[BackgroundTask] | None = None,
        error_callback: Callable[[Exception, str], None] | None = None,
    ) -> None:
        super().__init__(tasks)
        self._error_callback = error_callback
        self.task_results: list[TaskResult] = []
        self.tasks: list[BackgroundTask] = []

    def add_task(
        self,
        func: Annotated[
            Callable[P, Any],
            Doc(
                """
                The function to call after the response is sent.

                It can be a regular `def` function or an `async def` function.
                """
            ),
        ],
        *args: P.args,
        error_callback: Annotated[
            Callable[[Exception, str], None] | None,
            Doc(
                """
                Optional callback invoked when the background task fails.
                Receives the exception and the function name.
                """
            ),
        ] = None,
        max_retries: Annotated[
            int,
            Doc(
                """
                Maximum number of automatic retries on failure.
                Defaults to 0 (no retries).
                """
            ),
        ] = 0,
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        task_result = TaskResult(func_name=getattr(func, "__name__", str(func)))
        self.task_results.append(task_result)

        task = BackgroundTask(
            func,
            *args,
            error_callback=error_callback or self._error_callback,
            max_retries=max_retries,
            task_result=task_result,
            **kwargs,
        )
        self.tasks.append(task)

    async def __call__(self) -> None:
        """Execute all background tasks with error tolerance."""
        for task in self.tasks:
            await task()