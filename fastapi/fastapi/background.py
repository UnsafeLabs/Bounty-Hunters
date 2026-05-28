from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any, Optional

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

from fastapi.logger import logger

P = ParamSpec("P")


@dataclass
class TaskResult:
    """Stores the outcome of a background task execution."""

    func_name: str
    success: bool
    exception: Optional[Exception] = None
    exception_message: Optional[str] = None
    retry_count: int = 0


class BackgroundTasks(StarletteBackgroundTasks):
    """
    A collection of background tasks that will be called after a response has been
    sent to the client.

    Extends the base BackgroundTasks with error handling, configurable retries,
    logging, and task result tracking.

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
        tasks: Any = None,
        *,
        error_callback: Annotated[
            Optional[Callable[[Exception, str], Any]],
            Doc(
                """
                An optional callback invoked when a background task raises an exception.

                The callback receives the exception object and the task function name.
                It can be a regular `def` or `async def` function.
                """
            ),
        ] = None,
    ) -> None:
        super().__init__(tasks)
        self.error_callback = error_callback
        self.task_results: Annotated[
            list[TaskResult],
            Doc(
                """
                A list storing the outcome of each background task execution.

                Each entry contains the function name, success status, exception info
                (if any), and the number of retries that were attempted.
                """
            ),
        ] = []
        self._task_meta: dict[int, dict[str, Any]] = {}

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
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        task = self._make_wrapped_task(func, args, kwargs, max_retries=0)
        self.tasks.append(task)
        return None

    def add_task_with_retries(
        self,
        func: Annotated[
            Callable[..., Any],
            Doc("The function to call in the background."),
        ],
        *args: Any,
        max_retries: Annotated[
            int,
            Doc(
                """
                Maximum number of retry attempts if the task fails.

                Defaults to 1. When set to a positive integer, the task will be
                re-executed up to this many times on failure.
                """
            ),
        ] = 1,
        **kwargs: Any,
    ) -> None:
        """
        Add a background task with automatic retry on failure.

        Works like `add_task` but supports a `max_retries` parameter. If the task
        raises an exception, it will be retried up to `max_retries` times before
        the failure is recorded and the error callback (if any) is invoked.
        """
        task = self._make_wrapped_task(func, args, kwargs, max_retries=max_retries)
        self.tasks.append(task)
        return None

    def _make_wrapped_task(
        self,
        func: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        max_retries: int,
    ) -> Any:
        """Create a coroutine wrapper around a task with retry and error handling."""

        async def _task_wrapper() -> None:
            await self._execute_with_retry(func, args, kwargs, max_retries)

        return _task_wrapper

    async def _execute_with_retry(
        self,
        func: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        max_retries: int,
    ) -> None:
        """Execute a task with retry logic and error handling."""
        import asyncio

        func_name = getattr(func, "__name__", str(func))
        is_async = asyncio.iscoroutinefunction(func)

        last_exception: Optional[Exception] = None
        retry_count = 0

        for attempt in range(max_retries + 1):
            try:
                if is_async:
                    await func(*args, **kwargs)
                else:
                    func(*args, **kwargs)

                # Success - record and return
                self.task_results.append(
                    TaskResult(
                        func_name=func_name,
                        success=True,
                        retry_count=retry_count,
                    )
                )
                return
            except Exception as exc:
                last_exception = exc
                retry_count = attempt

                if attempt < max_retries:
                    logger.warning(
                        "Background task '%s' failed (attempt %d/%d): %s. Retrying...",
                        func_name,
                        attempt + 1,
                        max_retries + 1,
                        str(exc),
                    )
                else:
                    logger.error(
                        "Background task '%s' failed after %d attempt(s): %s",
                        func_name,
                        max_retries + 1,
                        str(exc),
                    )

        # All retries exhausted - record failure
        assert last_exception is not None  # guaranteed after at least one attempt
        self.task_results.append(
            TaskResult(
                func_name=func_name,
                success=False,
                exception=last_exception,
                exception_message=str(last_exception),
                retry_count=retry_count,
            )
        )

        # Invoke error callback if provided
        if self.error_callback is not None:
            try:
                import asyncio as _asyncio

                if _asyncio.iscoroutinefunction(self.error_callback):
                    await self.error_callback(last_exception, func_name)
                else:
                    self.error_callback(last_exception, func_name)
            except Exception as callback_exc:
                logger.error(
                    "Error callback itself failed for task '%s': %s",
                    func_name,
                    str(callback_exc),
                )

    async def __call__(self) -> None:
        """Execute all background tasks."""
        for task in self.tasks:
            await task()
