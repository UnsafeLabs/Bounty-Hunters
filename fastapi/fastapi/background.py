import inspect
from collections.abc import Callable, Sequence
from typing import Annotated, Any, Literal, TypedDict, cast

from annotated_doc import Doc
from fastapi.logger import logger
from starlette._utils import is_async_callable
from starlette.background import BackgroundTask as StarletteBackgroundTask
from starlette.background import BackgroundTasks as StarletteBackgroundTasks
from starlette.concurrency import run_in_threadpool


class BackgroundTaskInfo(TypedDict):
    name: str
    args: tuple[Any, ...]
    kwargs: dict[str, Any]
    retry_count: int
    max_retries: int


class BackgroundTaskResult(TypedDict):
    task_name: str
    status: Literal["success", "failed"]
    exception: str | None
    retry_count: int


ErrorCallback = Callable[[Exception, BackgroundTaskInfo], Any]


class _UnsetType:
    pass


_UNSET = _UnsetType()


def _task_name(func: Callable[..., Any]) -> str:
    return getattr(func, "__name__", func.__class__.__name__)


def _accepts_keyword(func: Callable[..., Any], name: str) -> bool:
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return False

    for parameter in signature.parameters.values():
        if parameter.kind is inspect.Parameter.VAR_KEYWORD:
            return True
        if parameter.name == name and parameter.kind in {
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        }:
            return True
    return False


class BackgroundTask(StarletteBackgroundTask):
    def __init__(
        self,
        func: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        task_results: list[BackgroundTaskResult],
        on_error: ErrorCallback | None = None,
        max_retries: int = 0,
    ) -> None:
        self._func = func
        self._args = args
        self._kwargs = kwargs
        self.task_results = task_results
        self.on_error = on_error
        self.max_retries = max_retries
        self.is_async = is_async_callable(func)
        self.name = _task_name(func)

    async def __call__(self) -> None:
        retry_count = 0

        while True:
            try:
                if self.is_async:
                    await self._func(*self._args, **self._kwargs)
                else:
                    await run_in_threadpool(self._func, *self._args, **self._kwargs)
            except Exception as exc:
                logger.exception(
                    "Background task %s failed on attempt %s of %s",
                    self.name,
                    retry_count + 1,
                    self.max_retries + 1,
                )
                await self._call_error_callback(exc, retry_count)

                if retry_count < self.max_retries:
                    retry_count += 1
                    continue

                self.task_results.append(
                    {
                        "task_name": self.name,
                        "status": "failed",
                        "exception": str(exc),
                        "retry_count": retry_count,
                    }
                )
                if self.on_error is None and self.max_retries == 0:
                    raise
                return
            else:
                self.task_results.append(
                    {
                        "task_name": self.name,
                        "status": "success",
                        "exception": None,
                        "retry_count": retry_count,
                    }
                )
                return

    async def _call_error_callback(self, exc: Exception, retry_count: int) -> None:
        if self.on_error is None:
            return

        task_info: BackgroundTaskInfo = {
            "name": self.name,
            "args": self._args,
            "kwargs": self._kwargs,
            "retry_count": retry_count,
            "max_retries": self.max_retries,
        }
        result = self.on_error(exc, task_info)
        if inspect.isawaitable(result):
            await result


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

    def __init__(self, tasks: Sequence[StarletteBackgroundTask] | None = None):
        super().__init__(tasks)
        self.task_results: list[BackgroundTaskResult] = []

    def add_task(  # type: ignore[override]
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
        on_error: Annotated[
            ErrorCallback | _UnsetType,
            Doc(
                """
                Optional callback called with the exception and background task
                info whenever an attempt fails.
                """
            ),
        ] = _UNSET,
        max_retries: Annotated[
            int | _UnsetType,
            Doc(
                """
                Maximum number of times to retry the task after the first failed
                attempt.
                """
            ),
        ] = _UNSET,
        **kwargs: Any,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        task_kwargs = dict(kwargs)
        task_on_error: ErrorCallback | None = None
        task_max_retries = 0
        passed_through_on_error = False

        if on_error is not _UNSET:
            if (
                _accepts_keyword(func, "on_error")
                and (max_retries is _UNSET or not callable(on_error))
            ):
                task_kwargs["on_error"] = on_error
                passed_through_on_error = True
            else:
                task_on_error = cast(ErrorCallback, on_error)

        if max_retries is not _UNSET:
            if (on_error is _UNSET or passed_through_on_error) and _accepts_keyword(
                func, "max_retries"
            ):
                task_kwargs["max_retries"] = max_retries
            else:
                task_max_retries = cast(int, max_retries)

        if task_max_retries < 0:
            raise ValueError("max_retries must be greater than or equal to 0")

        self.tasks.append(
            BackgroundTask(
                func,
                args,
                task_kwargs,
                self.task_results,
                on_error=task_on_error,
                max_retries=task_max_retries,
            )
        )
