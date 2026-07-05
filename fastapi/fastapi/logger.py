import logging
from contextvars import ContextVar, Token

logger = logging.getLogger("fastapi")

_request_id_context: ContextVar[str | None] = ContextVar(
    "fastapi_request_id",
    default=None,
)


def get_request_id() -> str | None:
    return _request_id_context.get()


def set_request_id(request_id: str) -> Token[str | None]:
    return _request_id_context.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id_context.reset(token)


class RequestIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id() or "-"
        return True


if not any(isinstance(existing, RequestIDFilter) for existing in logger.filters):
    logger.addFilter(RequestIDFilter())
