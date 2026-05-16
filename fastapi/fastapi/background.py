from collections.abc import Callable
from typing import Annotated, Any, Optional

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

from .logger import logger

P = ParamSpec("P")


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
        tasks: Optional[list[tuple[Callable[..., Any], tuple[Any, ...], dict[str, Any]]]] = None,
        error_callback: Optional[Callable[[Exception, str], Any]] = None,
    ) -> None:
        super().__init__(tasks)
        self.error_callback: Optional[Callable[[Exception, str], Any]] = error_callback
        self.task_results: list[dict[str, Any]] = []

    def _execute_with_retry(
        self,
        func: Callable[P, Any],
        func_name: str,
        max_retries: int,
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> Any:
        last_exception: Optional[Exception] = None
        for attempt in range(max_retries + 1):
            try:
                result = func(*args, **kwargs)
                self.task_results.append({
                    "status": "success",
                    "function": func_name,
                    "retries": attempt,
                })
                return result
            except Exception as e:
                last_exception = e
                logger.error(
                    f"Background task '{func_name}' failed "
                    f"(attempt {attempt + 1}/{max_retries + 1}): {e}"
                )
                if self.error_callback:
                    self.error_callback(e, func_name)
                if attempt >= max_retries:
                    self.task_results.append({
                        "status": "failed",
                        "function": func_name,
                        "exception": str(e),
                        "retries": attempt,
                    })
                    raise

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
                Maximum number of retry attempts if the task fails.
                Defaults to 0 (no retries).
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
        if max_retries > 0:
            func_name = getattr(func, "__name__", str(func))
            wrapped = lambda *a, **kw: self._execute_with_retry(
                func, func_name, max_retries, *a, **kw
            )
            return super().add_task(wrapped, *args, **kwargs)
        return super().add_task(func, *args, **kwargs)
