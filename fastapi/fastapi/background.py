from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated, Any

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

from .logger import logger

P = ParamSpec("P")


@dataclass
class TaskResult:
    """Stores the outcome of a background task execution."""

    func_name: str
    status: str  # "success" | "failed"
    exception_message: str | None = None
    retry_count: int = 0


class BackgroundTasks(StarletteBackgroundTasks):
    """
    A collection of background tasks that will be called after a response has been
    sent to the client.

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

    def __init__(self) -> None:
        super().__init__()
        self.task_results: list[TaskResult] = []
        self._error_callback: Callable[[Exception, str], Any] | None = None

    def set_error_callback(
        self,
        callback: Annotated[
            Callable[[Exception, str], Any],
            Doc(
                """
                A callback function that receives the exception and the task function name
                when a background task fails.
                """
            ),
        ],
    ) -> None:
        """Set a callback to be invoked when a background task raises an exception."""
        self._error_callback = callback

    def add_task(
        self,
        func: Annotated[
            Callable[P, Any],
            Doc(
                """
                The function to be called in the background after the response is sent.

                It can be a regular `def` function or an `async def` function.
                """
            ),
        ],
        *args: P.args,
        max_retries: Annotated[
            int,
            Doc(
                """
                Maximum number of retry attempts for a failed task. Defaults to 0 (no retries).
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
        func_name = getattr(func, "__name__", str(func))

        async def _wrapped() -> None:
            retries = 0
            while True:
                try:
                    result = func(*args, **kwargs)
                    if hasattr(result, "__await__"):
                        await result
                    self.task_results.append(
                        TaskResult(func_name=func_name, status="success", retry_count=retries)
                    )
                    return
                except Exception as exc:
                    retries += 1
                    if retries <= max_retries:
                        logger.warning(
                            "Background task %s failed (attempt %d/%d): %s — retrying",
                            func_name,
                            retries,
                            max_retries + 1,
                            exc,
                        )
                        continue

                    logger.error(
                        "Background task %s failed after %d attempts: %s",
                        func_name,
                        retries,
                        exc,
                    )
                    self.task_results.append(
                        TaskResult(
                            func_name=func_name,
                            status="failed",
                            exception_message=str(exc),
                            retry_count=retries - 1,
                        )
                    )
                    if self._error_callback is not None:
                        try:
                            cb_result = self._error_callback(exc, func_name)
                            if hasattr(cb_result, "__await__"):
                                await cb_result
                        except Exception as cb_exc:
                            logger.error("Error callback for %s raised: %s", func_name, cb_exc)
                    return

        super().add_task(_wrapped)
