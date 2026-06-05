from __future__ import annotations

import logging
from contextvars import ContextVar, Token

logger = logging.getLogger("fastapi")

request_id_context_var: ContextVar[str | None] = ContextVar(
    "fastapi_request_id", default=None
)


def get_request_id(default: str = "-") -> str:
    request_id = request_id_context_var.get()
    if request_id is None:
        return default
    return request_id


def set_request_id(request_id: str) -> Token[str | None]:
    return request_id_context_var.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    request_id_context_var.reset(token)


class RequestIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


if not any(isinstance(log_filter, RequestIDFilter) for log_filter in logger.filters):
    logger.addFilter(RequestIDFilter())
