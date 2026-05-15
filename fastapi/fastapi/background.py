from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Annotated, Any

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

from fastapi.logger import logger

P = ParamSpec("P")


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


@dataclass
class TaskResult:
    """Record of a background task outcome."""

    func_name: str
    status: TaskStatus
    exception: str | None = None
    retry_count: int = 0


class BackgroundTasks(StarletteBackgroundTasks):
    """
    A collection of background tasks that will be called after a response has been
    sent to the client, with error handling, retry support, and outcome tracking.

    Read more about it in the
    [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).

    ## Example

    ```python
    from fastapi import BackgroundTasks, FastAPI

    app = FastAPI()

    def error_callback(exc: Exception, func_name: str) -> None:
        logger.error(f"Background task {func_name} failed: {exc}")

    @app.post("/send-notification/{email}")
    async def send_notification(email: str, background_tasks: BackgroundTasks):
        background_tasks.add_task(
            write_notification, email, message="some notification",
            error_callback=error_callback, max_retries=2
        )
        return {"message": "Notification sent in the background"}
    ```
    """

    def __init__(
        self,
        error_callback: Callable[[Exception, str], Any] | None = None,
        max_retries: int = 0,
    ) -> None:
        super().__init__()
        self.error_callback = error_callback
        self.default_max_retries = max_retries
        self.task_results: list[TaskResult] = []

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
        error_callback: Callable[[Exception, str], Any] | None = None,
        max_retries: int | None = None,
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Args:
            func: The function to call after the response is sent.
            *args: Positional arguments passed to the function.
            error_callback: Optional callback invoked when a task fails.
                Receives (exception, function_name).
            max_retries: Number of times to retry a failed task (default: self.default_max_retries).
                Retries are executed immediately after failure.
            **kwargs: Keyword arguments passed to the function.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        retry_count = max_retries if max_retries is not None else self.default_max_retries
        cb = error_callback if error_callback is not None else self.error_callback
        func_name = getattr(func, "__name__", str(func))

        result = TaskResult(func_name=func_name, status=TaskStatus.PENDING)
        self.task_results.append(result)

        def _run_task() -> None:
            attempts = 0
            while attempts <= retry_count:
                result.status = TaskStatus.RUNNING
                try:
                    func(*args, **kwargs)
                    result.status = TaskStatus.SUCCESS
                    return
                except Exception as exc:  # pragma: no cover
                    attempts += 1
                    result.retry_count = attempts - 1
                    if attempts <= retry_count:
                        logger.debug(
                            f"Background task {func_name} failed (attempt {attempts}/{retry_count + 1}), retrying: {exc}"
                        )
                        continue
                    result.status = TaskStatus.FAILED
                    result.exception = str(exc)
                    logger.error(f"Background task {func_name} failed after {attempts} attempts: {exc}")
                    if cb is not None:
                        try:
                            cb(exc, func_name)
                        except Exception as callback_exc:  # pragma: no cover
                            logger.error(f"Error callback for {func_name} also raised: {callback_exc}")
                    return

        super().add_task(_run_task)