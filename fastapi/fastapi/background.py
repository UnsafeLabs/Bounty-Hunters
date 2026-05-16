import asyncio
import time
from collections.abc import Callable
from typing import Annotated, Any

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

P = ParamSpec("P")


class BackgroundTaskError(Exception):
    """Wraps the original exception from a failed background task.

    Attributes:
        func_name: The name of the task function that failed.
        original_exception: The original exception raised by the task.
    """

    def __init__(
        self,
        func_name: str,
        original_exception: Exception,
        *args: Any,
    ) -> None:
        self.func_name = func_name
        self.original_exception = original_exception
        super().__init__(
            f"Task '{func_name}' failed after all retries: {original_exception}",
            *args,
        )


class BackgroundTasks(StarletteBackgroundTasks):
    """
    A collection of background tasks that will be called after a response has been
    sent to the client.

    Extends Starlette's ``BackgroundTasks`` with optional retry logic, error
    callbacks, and re-raise support.

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
        background_tasks.add_task(
            write_notification,
            email,
            message="some notification",
            max_retries=2,
            retry_delay=0.5,
        )
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
                """,
            ),
        ],
        *args: P.args,
        on_error: Annotated[
            Callable[[BackgroundTaskError], Any] | None,
            Doc(
                """
                An optional callback invoked when a task fails after all retries
                are exhausted.  Receives a ``BackgroundTaskError`` instance.
                """,
            ),
        ] = None,
        raise_on_error: Annotated[
            bool,
            Doc(
                """
                When ``True``, re-raises the ``BackgroundTaskError`` after all
                retries are exhausted.
                """,
            ),
        ] = False,
        max_retries: Annotated[
            int,
            Doc(
                """
                Maximum number of retry attempts before giving up.
                Defaults to 0 (no retries).
                """,
            ),
        ] = 0,
        retry_delay: Annotated[
            float,
            Doc(
                """
                Base delay in seconds between retries.  The actual delay
                follows exponential backoff: ``retry_delay * (2 ** attempt)``.
                Defaults to 1.0 second.
                """,
            ),
        ] = 1.0,
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        needs_wrapper = max_retries > 0 or on_error is not None or raise_on_error

        if not needs_wrapper:
            super().add_task(func, *args, **kwargs)
            return

        func_name = getattr(func, "__name__", str(func))

        async def _run_with_retries() -> Any:
            last_exc: Exception | None = None

            for attempt in range(max_retries + 1):
                try:
                    if asyncio.iscoroutinefunction(func):
                        return await func(*args, **kwargs)
                    return func(*args, **kwargs)
                except Exception as exc:
                    last_exc = exc
                    if attempt < max_retries:
                        delay = retry_delay * (2**attempt)
                        await asyncio.sleep(delay)

            # All retries exhausted
            error = BackgroundTaskError(func_name, last_exc)  # type: ignore[arg-type]
            if on_error is not None:
                on_error(error)
            if raise_on_error:
                raise error

        super().add_task(_run_with_retries)
