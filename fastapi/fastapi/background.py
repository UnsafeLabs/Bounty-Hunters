from collections.abc import Callable
from inspect import isawaitable
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
        task_results: list[dict[str, Any]],
        max_retries: int = 0,
        on_error: Callable[[Exception, str], Any] | None = None,
        **kwargs: P.kwargs,
    ) -> None:
        super().__init__(func, *args, **kwargs)
        if max_retries < 0:
            raise ValueError("max_retries must be greater than or equal to 0")
        self.task_results = task_results
        self.max_retries = max_retries
        self.on_error = on_error

    @property
    def task_name(self) -> str:
        return getattr(self.func, "__name__", self.func.__class__.__name__)

    async def __call__(self) -> None:
        retry_count = 0
        while True:
            try:
                await super().__call__()
                self.task_results.append(
                    {
                        "status": "success",
                        "task_name": self.task_name,
                        "exception": None,
                        "retry_count": retry_count,
                    }
                )
                return
            except Exception as exc:
                logger.exception(
                    "Background task %s failed on attempt %s",
                    self.task_name,
                    retry_count + 1,
                )
                if self.on_error is not None:
                    callback_result = self.on_error(exc, self.task_name)
                    if isawaitable(callback_result):
                        await callback_result
                if retry_count >= self.max_retries:
                    self.task_results.append(
                        {
                            "status": "failed",
                            "task_name": self.task_name,
                            "exception": str(exc),
                            "retry_count": retry_count,
                        }
                    )
                    return
                retry_count += 1


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

    def __init__(self, tasks: list[BackgroundTask] | None = None):
        self.task_results: list[dict[str, Any]] = []
        super().__init__(tasks=tasks)

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
        max_retries: Annotated[
            int,
            Doc(
                """
                Number of times to retry the task after the initial attempt fails.
                """
            ),
        ] = 0,
        on_error: Annotated[
            Callable[[Exception, str], Any] | None,
            Doc(
                """
                Optional callback called with the exception and task function name
                whenever an attempt fails.
                """
            ),
        ] = None,
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
            task_results=self.task_results,
            max_retries=max_retries,
            on_error=on_error,
            **kwargs,
        )
        self.tasks.append(task)
