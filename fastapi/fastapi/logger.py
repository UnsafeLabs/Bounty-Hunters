import logging
from contextvars import ContextVar

request_id_context: ContextVar[str | None] = ContextVar(
    "fastapi_request_id", default=None
)


def get_request_id() -> str | None:
    return request_id_context.get()


class RequestIDLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id() or ""
        return True


logger = logging.getLogger("fastapi")

if not any(isinstance(filter_, RequestIDLogFilter) for filter_ in logger.filters):
    logger.addFilter(RequestIDLogFilter())
