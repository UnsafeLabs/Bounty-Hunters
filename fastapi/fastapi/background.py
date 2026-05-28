from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Annotated, Any, Optional

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks

logger = logging.getLogger("fastapi.background")


class TaskStatus(str, Enum):
    """Status of a background task execution."""

    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class TaskResult:
    """Stores the outcome of a background task execution."""

    func_name: str
    status: TaskStatus
    error: Optional[str] = None
    retries: int = 0
    args: tuple = field(default_factory=tuple)
    kwargs: dict = field(default_factory=dict)


ErrorCallback = Callable[[str, Exception, int], Any]


class BackgroundTasks(StarletteBackgroundTasks):
    """
    A collection of background tasks that will be called after a response has been
    sent to the client.

    Supports error handling, configurable retries, and task result tracking.

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


    def on_error(func_name: str, exc: Exception, retries: int):
        print(f"Task {func_name} failed after {retries} retries: {exc}")


    @app.post("/send-notification/{email}")
    async def send_notification(email: str, background_tasks: BackgroundTasks):
        background_tasks.add_task(
            write_notification,
            email,
            message="some notification",
            max_retries=3,
            on_error=on_error,
        )
        return {"message": "Notification sent in the background"}
    ```
    """

    def __init__(self) -> None:
        super().__init__()
        self.task_results: list[TaskResult] = []
        self._error_callback: Optional[ErrorCallback] = None

    def set_error_callback(
        self,
        callback: Annotated[
            ErrorCallback,
            Doc(
                """
                A callable that receives (func_name, exception, retry_count)
                when a background task fails.
                """
            ),
        ],
    ) -> None:
        """
        Set a global error callback for all background tasks.

        The callback receives the function name, the exception, and the
        current retry count.
        """
        self._error_callback = callback

    def add_task(  # type: ignore[override]
        self,
        func: Annotated[
            Callable[..., Any],
            Doc(
                """
                The function to call after the response is sent.

                It can be a regular `def` function or an `async def` function.
                """
            ),
        ],
        *args: Any,
        max_retries: Annotated[
            int,
            Doc(
                """
                Maximum number of retry attempts on failure. Defaults to 0 (no retries).
                """
            ),
        ] = 0,
        on_error: Annotated[
            Optional[ErrorCallback],
            Doc(
                """
                Per-task error callback. Overrides the global error callback if set.
                Receives (func_name, exception, retry_count).
                """
            ),
        ] = None,
        **kwargs: Any,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Supports configurable retries and per-task error callbacks.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        # Strip custom kwargs before passing to starlette
        retries = kwargs.pop("max_retries", max_retries)
        error_cb = kwargs.pop("on_error", on_error)

        wrapped = self._wrap_task(func, args, kwargs, retries, error_cb)
        return super().add_task(wrapped)

    def _wrap_task(
        self,
        func: Callable[..., Any],
        args: tuple,
        kwargs: dict,
        max_retries: int,
        on_error: Optional[ErrorCallback],
    ) -> Callable[[], Any]:
        """Wrap a task function with error handling and retry logic."""
        func_name = getattr(func, "__name__", str(func))

        async def _execute() -> None:
            attempt = 0
            while True:
                try:
                    if asyncio.iscoroutinefunction(func):
                        await func(*args, **kwargs)
                    else:
                        func(*args, **kwargs)
                    self.task_results.append(
                        TaskResult(
                            func_name=func_name,
                            status=TaskStatus.SUCCESS,
                            retries=attempt,
                            args=args,
                            kwargs=dict(kwargs),
                        )
                    )
                    return
                except Exception as exc:
                    attempt += 1
                    logger.error(
                        "Background task '%s' failed (attempt %d/%d): %s",
                        func_name,
                        attempt,
                        max_retries + 1,
                        exc,
                    )
                    if attempt > max_retries:
                        self.task_results.append(
                            TaskResult(
                                func_name=func_name,
                                status=TaskStatus.FAILED,
                                error=str(exc),
                                retries=attempt - 1,
                                args=args,
                                kwargs=dict(kwargs),
                            )
                        )
                        # Invoke error callback
                        error_handler = on_error or self._error_callback
                        if error_handler:
                            try:
                                error_handler(func_name, exc, attempt - 1)
                            except Exception:
                                logger.error(
                                    "Error callback itself failed for task '%s'",
                                    func_name,
                                )
                        return
                    else:
                        self.task_results.append(
                            TaskResult(
                                func_name=func_name,
                                status=TaskStatus.RETRYING,
                                error=str(exc),
                                retries=attempt,
                                args=args,
                                kwargs=dict(kwargs),
                            )
                        )
                        # Exponential backoff between retries
                        await asyncio.sleep(0.1 * (2 ** (attempt - 1)))

        return _execute