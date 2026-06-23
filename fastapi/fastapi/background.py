from collections.abc import Callable
from typing import Annotated, Any, Optional

from annotated_doc import Doc
from fastapi.logger import logger
from starlette.background import BackgroundTask as StarletteBackgroundTask
from starlette.background import BackgroundTasks as StarletteBackgroundTasks

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
        tasks: Annotated[
            Optional[list[StarletteBackgroundTask]],
            Doc(
                """
                The initial list of background tasks. Usually left empty, tasks are
                added with `add_task()`.
                """
            ),
        ] = None,
        error_callback: Annotated[
            Optional[ErrorCallback],
            Doc(
                """
                An optional callback invoked when a background task raises an
                exception. It receives the exception object and the name of the
                original task function. It can also be set later as an attribute:
                `background_tasks.error_callback = my_handler`.
                """
            ),
        ] = None,
    ) -> None:
        super().__init__(tasks)
        self.error_callback = error_callback
        self.task_results: list[dict[str, Any]] = []
        # Per-task retry counts, indexed in parallel with ``self.tasks``.
        self._max_retries: list[int] = [0] * len(self.tasks)

    def add_task(
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
                How many times to automatically re-execute the task if it raises an
                exception. Defaults to `0` (no retry), preserving the original
                behavior.
                """
            ),
        ] = 0,
        **kwargs: Any,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Pass `max_retries` to automatically re-execute the task if it raises an
        exception (defaults to `0`, i.e. no retry, preserving the original
        behavior).

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        if max_retries < 0:
            raise ValueError("max_retries must be a non-negative integer")
        super().add_task(func, *args, **kwargs)
        self._max_retries.append(max_retries)

    async def __call__(self) -> None:
        self.task_results = []
        for index, task in enumerate(self.tasks):
            func_name = getattr(task.func, "__name__", repr(task.func))
            max_retries = (
                self._max_retries[index] if index < len(self._max_retries) else 0
            )
            retries = 0
            while True:
                try:
                    await task()
                except Exception as exc:
                    logger.error(
                        "Background task %r failed on attempt %d/%d: %s",
                        func_name,
                        retries + 1,
                        max_retries + 1,
                        exc,
                    )
                    if self.error_callback is not None:
                        try:
                            self.error_callback(exc, func_name)
                        except Exception:
                            logger.exception(
                                "Background task error_callback raised while handling %r",
                                func_name,
                            )
                    if retries < max_retries:
                        retries += 1
                        continue
                    self.task_results.append(
                        {
                            "task": func_name,
                            "status": "failed",
                            "exception": str(exc),
                            "retries": retries,
                        }
                    )
                    break
                else:
                    self.task_results.append(
                        {
                            "task": func_name,
                            "status": "success",
                            "exception": None,
                            "retries": retries,
                        }
                    )
                    break
