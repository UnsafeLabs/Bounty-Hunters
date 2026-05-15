from collections.abc import Callable
from typing import Annotated, Any, Optional

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

P = ParamSpec("P")


class BackgroundTaskError(Exception):
    """
    Exception raised when a background task fails.

    Wraps the original exception with metadata about the task function.
    """

    def __init__(self, func_name: str, original_exception: Exception):
        self.func_name = func_name
        self.original_exception = original_exception
        super().__init__(f"Background task '{func_name}' failed: {original_exception}")


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
        on_error: Annotated[
            Optional[Callable[[BackgroundTaskError], Any]],
            Doc(
                """
                Optional callback invoked when the background task fails.

                The callback receives a `BackgroundTaskError` instance containing
                the original exception and the task function name.
                """
            ),
        ] = None,
        raise_on_error: Annotated[
            bool,
            Doc(
                """
                If `True`, re-raises the exception when a background task fails.

                Use with caution — this will cause the background task runner to
                raise the exception, which may affect the server's behavior.
                Defaults to `False`.
                """
            ),
        ] = False,
        max_retries: Annotated[
            int,
            Doc(
                """
                Maximum number of retry attempts on failure.

                The task will be retried up to this many times before the
                error is propagated or the `on_error` callback is invoked.
                Defaults to `0` (no retries).
                """
            ),
        ] = 0,
        retry_delay: Annotated[
            float,
            Doc(
                """
                Base delay in seconds between retries.

                Uses exponential backoff: actual delay = `retry_delay * (2 ** attempt)`.
                Defaults to `1.0` second.
                """
            ),
        ] = 1.0,
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        import time as time_module

        func_name = getattr(func, "__name__", str(func))

        def _run_with_retries(*run_args: Any, **run_kwargs: Any) -> Any:
            last_exception: Optional[Exception] = None
            attempts = max_retries + 1  # initial try + retries

            for attempt in range(attempts):
                try:
                    return func(*run_args, **run_kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries:
                        delay = retry_delay * (2 ** attempt)
                        time_module.sleep(delay)

            # All attempts exhausted
            error = BackgroundTaskError(func_name=func_name, original_exception=last_exception)

            if on_error is not None:
                on_error(error)

            if raise_on_error:
                raise error

        return super().add_task(_run_with_retries, *args, **kwargs)
