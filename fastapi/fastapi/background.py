from collections.abc import Callable
from typing import Annotated, Any

from annotated_doc import Doc
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from typing_extensions import ParamSpec

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
        return super().add_task(func, *args, **kwargs)

    def add_task_with_retry(
        self,
        func: Callable[P, Any],
        *args: P.args,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        **kwargs: P.kwargs,
    ) -> None:
        """
        Add a function with automatic retry on failure.

        Args:
            func: The function to call.
            max_retries: Maximum number of retry attempts.
            retry_delay: Delay between retries in seconds (doubles each retry).
        """
        async def _wrapped() -> None:
            import asyncio
            import logging

            logger = logging.getLogger("fastapi.background")
            last_exc: Exception | None = None

            for attempt in range(1, max_retries + 2):
                try:
                    result = func(*args, **kwargs)
                    if hasattr(result, "__await__"):
                        await result  # type: ignore
                    return
                except Exception as e:
                    last_exc = e
                    if attempt <= max_retries:
                        logger.warning(
                            "Background task failed (attempt %d/%d): %s",
                            attempt,
                            max_retries + 1,
                            str(e),
                        )
                        await asyncio.sleep(retry_delay * (2 ** (attempt - 1)))
                    else:
                        logger.error(
                            "Background task failed after %d attempts: %s",
                            max_retries + 1,
                            str(e),
                        )

            if last_exc:
                raise last_exc

        self.tasks.append(_wrapped())
