from collections.abc import Callable, Sequence
from typing import Annotated, Any

from annotated_doc import Doc
from starlette.background import BackgroundTask
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

from fastapi.logger import logger

P = ParamSpec("P")

ErrorCallback = Callable[[Exception, str], Any]


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
        tasks: Sequence[BackgroundTask] | None = None,
        *,
        error_callback: ErrorCallback | None = None,
    ) -> None:
        super().__init__(tasks)
        self.error_callback = error_callback
        self.task_results: list[dict[str, Any]] = []
        self._max_retries: list[int] = [0] * len(self.tasks)

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
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        task = BackgroundTask(func, *args, **kwargs)
        self.tasks.append(task)
        self._max_retries.append(max_retries)

    async def __call__(self) -> None:
        while len(self._max_retries) < len(self.tasks):
            self._max_retries.append(0)

        for task, max_retries in zip(self.tasks, self._max_retries):
            func_name = getattr(task.func, "__name__", repr(task.func))
            retry_count = 0
            while True:
                try:
                    await task()
                    self.task_results.append(
                        {
                            "status": "success",
                            "exception": None,
                            "retry_count": retry_count,
                        }
                    )
                    break
                except Exception as exc:
                    if retry_count < max_retries:
                        retry_count += 1
                        logger.warning(
                            "Background task %s failed (attempt %s/%s), retrying: %s",
                            func_name,
                            retry_count,
                            max_retries,
                            exc,
                        )
                        continue

                    logger.exception(
                        "Background task %s failed after %s retries: %s",
                        func_name,
                        retry_count,
                        exc,
                    )
                    if self.error_callback is not None:
                        self.error_callback(exc, func_name)
                    self.task_results.append(
                        {
                            "status": "failed",
                            "exception": str(exc),
                            "retry_count": retry_count,
                        }
                    )
                    break
