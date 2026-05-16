from collections.abc import Callable
import asyncio
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



class ConcurrentTaskRunner:
    """Run multiple background tasks concurrently with a semaphore limit.

    Args:
        max_concurrent: Maximum number of tasks running simultaneously.
        timeout: Optional timeout in seconds per task.
    """

    def __init__(self, max_concurrent: int = 5, timeout: float | None = None) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._timeout = timeout

    async def run(self, tasks: list[Callable[[], Any]]) -> list[Any]:
        """Run all tasks concurrently, respecting the semaphore limit."""
        async def _wrapped(task: Callable[[], Any]) -> Any:
            async with self._semaphore:
                if asyncio.iscoroutinefunction(task):
                    if self._timeout:
                        return await asyncio.wait_for(task(), timeout=self._timeout)
                    return await task()
                else:
                    if self._timeout:
                        return await asyncio.wait_for(
                            asyncio.get_event_loop().run_in_executor(None, task),
                            timeout=self._timeout,
                        )
                    return await asyncio.get_event_loop().run_in_executor(None, task)

        return await asyncio.gather(*[_wrapped(t) for t in tasks])
