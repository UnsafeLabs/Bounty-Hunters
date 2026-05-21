import contextvars
import logging

_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "fastapi_request_id", default=None
)


class RequestIDLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        return True


def set_request_id(request_id: str) -> contextvars.Token:
    return _request_id.set(request_id)


def reset_request_id(token: contextvars.Token) -> None:
    _request_id.reset(token)


def get_request_id() -> str | None:
    return _request_id.get()


logger = logging.getLogger("fastapi")

if not any(isinstance(log_filter, RequestIDLogFilter) for log_filter in logger.filters):
    logger.addFilter(RequestIDLogFilter())
