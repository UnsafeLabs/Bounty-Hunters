from collections.abc import Callable, Sequence
from typing import Annotated, Any

from annotated_doc import Doc
from fastapi.logger import logger
from starlette._utils import is_async_callable
from starlette.background import BackgroundTask as StarletteBackgroundTask
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from starlette.concurrency import run_in_threadpool

ErrorCallback = Callable[[Exception, str, int], Any]


class BackgroundTask(StarletteBackgroundTask):
    def __init__(
        self,
        func: Callable[..., Any],
        *args: Any,
        max_retries: int = 0,
        on_error: ErrorCallback | None = None,
        task_results: list[dict[str, Any]] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(func, *args, **kwargs)
        self.max_retries = max(0, max_retries)
        self.on_error = on_error
        self.task_results = task_results
        self.task_name = getattr(func, "__name__", func.__class__.__name__)

    async def __call__(self) -> None:
        retry_count = 0
        while True:
            try:
                await super().__call__()
            except Exception as exc:
                logger.exception(
                    "Background task %s failed (retry %s/%s)",
                    self.task_name,
                    retry_count,
                    self.max_retries,
                )
                await self._call_error_handler(exc, retry_count)
                if retry_count >= self.max_retries:
                    self._record_result("failed", exc, retry_count)
                    return
                retry_count += 1
            else:
                self._record_result("success", None, retry_count)
                return

    async def _call_error_handler(self, exc: Exception, retry_count: int) -> None:
        if self.on_error is None:
            return
        try:
            if is_async_callable(self.on_error):
                await self.on_error(exc, self.task_name, retry_count)
            else:
                await run_in_threadpool(self.on_error, exc, self.task_name, retry_count)
        except Exception:
            logger.exception("Background task %s error callback failed", self.task_name)

    def _record_result(
        self, status: str, exc: Exception | None, retry_count: int
    ) -> None:
        if self.task_results is None:
            return
        self.task_results.append(
            {
                "status": status,
                "task_name": self.task_name,
                "exception": str(exc) if exc else None,
                "retry_count": retry_count,
            }
        )


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

    def __init__(self, tasks: Sequence[StarletteBackgroundTask] | None = None) -> None:
        super().__init__(tasks)
        self.task_results: list[dict[str, Any]] = []

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
                The number of times to retry the task after a failure.
                """
            ),
        ] = 0,
        on_error: Annotated[
            ErrorCallback | None,
            Doc(
                """
                Optional callback called with the exception, task name, and retry
                count when the task fails.
                """
            ),
        ] = None,
        **kwargs: Any,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        task = BackgroundTask(
            func,
            *args,
            max_retries=max_retries,
            on_error=on_error,
            task_results=self.task_results,
            **kwargs,
        )
        self.tasks.append(task)
