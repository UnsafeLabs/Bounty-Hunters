import logging
from contextvars import ContextVar, Token

logger = logging.getLogger("fastapi")

_request_id: ContextVar[str | None] = ContextVar("fastapi_request_id", default=None)


def get_request_id() -> str | None:
    return _request_id.get()


def set_request_id(request_id: str | None) -> Token:
    return _request_id.set(request_id)


def reset_request_id(token: Token) -> None:
    _request_id.reset(token)


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id() or "-"
        return True


logger.addFilter(RequestIdFilter())
