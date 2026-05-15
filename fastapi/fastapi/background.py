import inspect
from collections.abc import Callable, Sequence
from typing import Annotated, Any

from annotated_doc import Doc
from fastapi.logger import logger
from starlette.background import BackgroundTask
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

P = ParamSpec("P")

ErrorCallback = Callable[[Exception, str], Any]
TaskResult = dict[str, Any]


class _BackgroundTaskWithRetries(BackgroundTask):
    def __init__(
        self,
        func: Callable[P, Any],
        *args: P.args,
        max_retries: int = 0,
        **kwargs: P.kwargs,
    ) -> None:
        if max_retries < 0:
            raise ValueError("max_retries must be greater than or equal to 0")
        super().__init__(func, *args, **kwargs)
        self.max_retries = max_retries


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
        tasks: Annotated[
            Sequence[BackgroundTask] | None,
            Doc(
                """
                A sequence of background tasks to execute after the response is sent.
                """
            ),
        ] = None,
        error_callback: Annotated[
            ErrorCallback | None,
            Doc(
                """
                A callback called with the exception and original task function name
                when a background task raises an exception.
                """
            ),
        ] = None,
    ) -> None:
        super().__init__(tasks=tasks)
        self.error_callback = error_callback
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
        max_retries: Annotated[
            int,
            Doc(
                """
                The maximum number of times to retry this task if it raises an
                exception.
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
        task = _BackgroundTaskWithRetries(
            func, *args, max_retries=max_retries, **kwargs
        )
        self.tasks.append(task)

    async def __call__(self) -> None:
        for task in self.tasks:
            await self._run_task(task)

    async def _run_task(self, task: BackgroundTask) -> None:
        task_name = self._get_task_name(task)
        max_retries = getattr(task, "max_retries", 0)
        retry_count = 0

        while True:
            try:
                await task()
            except Exception as exc:
                logger.exception(
                    "Background task %s failed on attempt %s",
                    task_name,
                    retry_count + 1,
                )
                await self._call_error_callback(exc, task_name)
                if retry_count >= max_retries:
                    self.task_results.append(
                        {
                            "task": task_name,
                            "status": "failed",
                            "exception_message": str(exc),
                            "retry_count": retry_count,
                        }
                    )
                    return
                retry_count += 1
            else:
                self.task_results.append(
                    {
                        "task": task_name,
                        "status": "success",
                        "exception_message": None,
                        "retry_count": retry_count,
                    }
                )
                return

    async def _call_error_callback(self, exc: Exception, task_name: str) -> None:
        if self.error_callback is None:
            return
        try:
            result = self.error_callback(exc, task_name)
            if inspect.isawaitable(result):
                await result
        except Exception:
            logger.exception("Background task error callback failed")

    def _get_task_name(self, task: BackgroundTask) -> str:
        func = getattr(task, "func", None)
        return getattr(func, "__name__", repr(func))
