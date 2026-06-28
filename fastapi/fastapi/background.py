import inspect
from collections.abc import Callable, Sequence
from typing import Annotated, Any

from annotated_doc import Doc
from fastapi.logger import logger
from starlette.background import BackgroundTask as StarletteBackgroundTask
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

P = ParamSpec("P")


class BackgroundTask(StarletteBackgroundTask):
    def __init__(
        self,
        func: Callable[P, Any],
        *args: P.args,
        max_retries: int = 0,
        on_error: Callable[[Exception, str], Any] | None = None,
        task_results: list[dict[str, Any]] | None = None,
        **kwargs: P.kwargs,
    ) -> None:
        if max_retries < 0:
            raise ValueError("max_retries must be greater than or equal to 0")
        super().__init__(func, *args, **kwargs)
        self.max_retries = max_retries
        self.on_error = on_error
        self.task_results = task_results

    @property
    def task_name(self) -> str:
        return getattr(self.func, "__name__", self.func.__class__.__name__)

    async def _handle_error(self, exc: Exception) -> None:
        if self.on_error is None:
            return
        result = self.on_error(exc, self.task_name)
        if inspect.isawaitable(result):
            await result

    def _append_result(
        self,
        *,
        status: str,
        exception: Exception | None,
        retry_count: int,
    ) -> None:
        if self.task_results is None:
            return
        self.task_results.append(
            {
                "task_name": self.task_name,
                "status": status,
                "exception": str(exception) if exception else None,
                "retry_count": retry_count,
            }
        )

    async def __call__(self) -> None:
        retry_count = 0
        while True:
            try:
                await super().__call__()
            except Exception as exc:
                if retry_count < self.max_retries:
                    retry_count += 1
                    continue
                logger.exception(
                    "Background task %s failed after %s retries",
                    self.task_name,
                    retry_count,
                )
                await self._handle_error(exc)
                self._append_result(
                    status="failed",
                    exception=exc,
                    retry_count=retry_count,
                )
                return
            self._append_result(
                status="success",
                exception=None,
                retry_count=retry_count,
            )
            return


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

    def __init__(
        self,
        tasks: Sequence[StarletteBackgroundTask] | None = None,
    ):
        super().__init__(tasks=tasks)
        self.task_results: list[dict[str, Any]] = []

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
        max_retries: int = 0,
        on_error: Callable[[Exception, str], Any] | None = None,
        **kwargs: P.kwargs,
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
