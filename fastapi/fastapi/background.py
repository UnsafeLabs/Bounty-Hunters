import inspect
from collections.abc import Callable
from typing import Annotated, Any, cast

from annotated_doc import Doc
from starlette.background import BackgroundTask as StarletteBackgroundTask
from starlette.background import BackgroundTasks as StarletteBackgroundTasks

from .logger import logger

TaskResult = dict[str, Any]
ErrorCallback = Callable[[Exception, dict[str, Any]], Any]
_Unset = object()


class BackgroundTask:
    def __init__(
        self,
        func: Callable[..., Any],
        *args: Any,
        _background_on_error: ErrorCallback | None = None,
        _background_max_retries: int = 0,
        _background_handle_errors: bool = False,
        **kwargs: Any,
    ) -> None:
        if _background_max_retries < 0:
            raise ValueError("max_retries must be greater than or equal to 0")

        self.func = func
        self.args = args
        self.kwargs = kwargs
        self.on_error = _background_on_error
        self.max_retries = _background_max_retries
        self.handle_errors = _background_handle_errors
        self.task_name = getattr(func, "__name__", func.__class__.__name__)
        self._task = StarletteBackgroundTask(func, *args, **kwargs)
        self.last_result: TaskResult | None = None

    async def __call__(self) -> TaskResult:
        retry_count = 0

        while True:
            try:
                await self._task()
            except Exception as exc:
                logger.exception(
                    "Background task %s failed on attempt %s",
                    self.task_name,
                    retry_count + 1,
                )
                task_info = self._task_info(retry_count=retry_count)
                await self._call_error_callback(exc, task_info)

                if retry_count < self.max_retries:
                    retry_count += 1
                    continue

                result = self._task_result(
                    status="failed",
                    retry_count=retry_count,
                    exception=exc,
                )
                if not self.handle_errors:
                    raise
                return result

            return self._task_result(status="success", retry_count=retry_count)

    def _task_info(self, *, retry_count: int) -> dict[str, Any]:
        return {
            "task_name": self.task_name,
            "retry_count": retry_count,
            "max_retries": self.max_retries,
            "args": self.args,
            "kwargs": self.kwargs,
        }

    async def _call_error_callback(
        self, exc: Exception, task_info: dict[str, Any]
    ) -> None:
        if self.on_error is None:
            return

        try:
            result = self.on_error(exc, task_info)
            if inspect.isawaitable(result):
                await result
        except Exception:
            logger.exception(
                "Background task error callback failed for %s",
                self.task_name,
            )

    def _task_result(
        self,
        *,
        status: str,
        retry_count: int,
        exception: Exception | None = None,
    ) -> TaskResult:
        result = {
            "task_name": self.task_name,
            "status": status,
            "exception": str(exception) if exception else None,
            "retry_count": retry_count,
        }
        self.last_result = result
        return result


def _task_name(task: Any) -> str:
    func = getattr(task, "func", None)
    if func is not None:
        return str(getattr(func, "__name__", func.__class__.__name__))
    return str(task.__class__.__name__)


def _accepts_keyword(func: Callable[..., Any], keyword: str) -> bool:
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return True

    return any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        or (
            parameter.name == keyword
            and parameter.kind
            in (
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                inspect.Parameter.KEYWORD_ONLY,
            )
        )
        for parameter in signature.parameters.values()
    )


def _resolve_control_argument(
    *,
    func: Callable[..., Any],
    kwargs: dict[str, Any],
    keyword: str,
    value: Any,
    alias_value: Any,
    default: Any,
) -> Any:
    if alias_value is not _Unset:
        if value is not _Unset:
            kwargs[keyword] = value
        return alias_value
    if value is _Unset:
        return default
    if _accepts_keyword(func, keyword):
        kwargs[keyword] = value
        return default
    return value


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

    def __init__(self, tasks: list[Any] | None = None):
        super().__init__(tasks=tasks)
        self.task_results: list[TaskResult] = []

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
        on_error: Annotated[
            ErrorCallback | None | object,
            Doc(
                """
                An optional callback called when a task raises an exception. It
                receives the exception and a task info dictionary containing the
                original task function name.
                """
            ),
        ] = _Unset,
        max_retries: Annotated[
            int | object,
            Doc(
                """
                The number of times to retry a failed background task before
                recording it as failed.
                """
            ),
        ] = _Unset,
        background_on_error: ErrorCallback | None | object = _Unset,
        background_max_retries: int | object = _Unset,
        **kwargs: Any,
    ) -> None:
        """
        Add a function to be called in the background after the response is sent.

        Read more about it in the
        [FastAPI docs for Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).
        """
        control_on_error = _resolve_control_argument(
            func=func,
            kwargs=kwargs,
            keyword="on_error",
            value=on_error,
            alias_value=background_on_error,
            default=None,
        )
        control_max_retries = _resolve_control_argument(
            func=func,
            kwargs=kwargs,
            keyword="max_retries",
            value=max_retries,
            alias_value=background_max_retries,
            default=0,
        )
        should_handle_errors = (
            control_on_error is not None or int(control_max_retries) > 0
        )
        task = BackgroundTask(
            func,
            *args,
            _background_on_error=cast(ErrorCallback | None, control_on_error),
            _background_max_retries=int(control_max_retries),
            _background_handle_errors=should_handle_errors,
            **kwargs,
        )
        cast(list[Any], self.tasks).append(task)

    async def __call__(self) -> None:
        for task in self.tasks:
            if isinstance(task, BackgroundTask):
                try:
                    result = await task()
                except Exception:
                    if task.last_result is not None:
                        self.task_results.append(task.last_result)
                    raise
            else:
                result = await self._run_existing_task(task)
            self.task_results.append(result)

    async def _run_existing_task(self, task: Any) -> TaskResult:
        name = _task_name(task)
        try:
            await task()
        except Exception as exc:
            logger.exception("Background task %s failed on attempt 1", name)
            result = {
                "task_name": name,
                "status": "failed",
                "exception": str(exc),
                "retry_count": 0,
            }
            self.task_results.append(result)
            raise

        return {
            "task_name": name,
            "status": "success",
            "exception": None,
            "retry_count": 0,
        }
