import logging
from contextvars import ContextVar

logger = logging.getLogger("fastapi")

request_id_context: ContextVar[str | None] = ContextVar(
    "fastapi_request_id", default=None
)


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_context.get()
        return True


logger.addFilter(RequestIdFilter())
