import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated, Any

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

from .logger import logger as fastapi_logger

P = ParamSpec("P")


@dataclass
class TaskResult:
    """Stores the outcome of a background task execution."""

    func_name: str
    success: bool
    exception: Exception | None = None
    retry_count: int = 0
    message: str = ""


class BackgroundTasks(StarletteBackgroundTasks):
    """
    A collection of background tasks that will be called after a response has been
    sent to the client.

    Enhanced with error handling, retry mechanism, and result tracking.

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
        # Basic usage (backward compatible)
        background_tasks.add_task(write_notification, email, message="some notification")

        # With retry and error callback
        def on_error(exc, func_name):
            logger.error(f"Task {func_name} failed: {exc}")

        background_tasks.add_task(
            write_notification,
            email,
            message="retryable notification",
            _max_retries=3,
            _on_error=on_error,
        )
        return {"message": "Notification sent in the background"}
    ```
    """

    def __init__(self) -> None:
        super().__init__()
        self._task_results: list[TaskResult] = []
        self._error_callback: Callable[[Exception, str], Any] | None = None

    @property
    def task_results(self) -> list[TaskResult]:
        """List of task execution results for inspection."""
        return self._task_results

    def set_error_callback(
        self, callback: Callable[[Exception, str], Any]
    ) -> None:
        """Set a global error callback for all tasks added without an explicit callback."""
        self._error_callback = callback

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
        _max_retries: Annotated[
            int,
            Doc(
                """
                Maximum number of retries for this task. Defaults to 0 (no retries).
                """
            ),
        ] = 0,
        _on_error: Annotated[
            Callable[[Exception, str], Any] | None,
            Doc(
                """
                Error callback for this specific task. Receives (exception, func_name).
                If not provided, falls back to the global error callback or logs to fastapi logger.
                """
            ),
        ] = None,
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Args:
            func: The function to call in the background.
            *args: Positional arguments for the function.
            _max_retries: Maximum retry attempts (default: 0).
            _on_error: Per-task error callback (optional).
            **kwargs: Keyword arguments for the function.
        """
        # Wrap the function with error handling and retry logic
        wrapped_func = self._wrap_with_error_handling(
            func, _max_retries, _on_error, *args, **kwargs
        )
        return super().add_task(wrapped_func)

    def _wrap_with_error_handling(
        self,
        func: Callable[P, Any],
        max_retries: int,
        on_error: Callable[[Exception, str], Any] | None,
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> Callable[[], Any]:
        """Wrap a task function with error handling, retry logic, and result tracking."""

        async def wrapped() -> None:
            func_name = getattr(func, "__name__", str(func))
            last_exception: Exception | None = None
            retry_count = 0

            while retry_count <= max_retries:
                try:
                    result = func(*args, **kwargs)
                    if asyncio.iscoroutine(result):
                        await result
                    # Success - record result
                    self._task_results.append(
                        TaskResult(
                            func_name=func_name,
                            success=True,
                            retry_count=retry_count,
                            message="Task completed successfully",
                        )
                    )
                    return
                except Exception as exc:
                    last_exception = exc
                    retry_count += 1
                    if retry_count <= max_retries:
                        fastapi_logger.warning(
                            f"Task {func_name} failed (attempt {retry_count}/{max_retries}): {exc}"
                        )
                        # Small delay before retry
                        await asyncio.sleep(0.1 * retry_count)

            # All retries exhausted
            self._task_results.append(
                TaskResult(
                    func_name=func_name,
                    success=False,
                    exception=last_exception,
                    retry_count=retry_count - 1,
                    message=f"Task failed after {retry_count - 1} retries: {last_exception}",
                )
            )
            fastapi_logger.error(
                f"Task {func_name} failed permanently after {retry_count - 1} retries: {last_exception}"
            )

            # Invoke error callback
            callback = on_error or self._error_callback
            if callback:
                try:
                    cb_result = callback(last_exception, func_name)
                    if asyncio.iscoroutine(cb_result):
                        await cb_result
                except Exception as cb_exc:
                    fastapi_logger.error(
                        f"Error callback for {func_name} also failed: {cb_exc}"
                    )

        return wrapped
