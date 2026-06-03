import logging
import contextvars

logger = logging.getLogger("fastapi")
request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

class RequestIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        req_id = request_id_var.get()
        record.request_id = req_id or "-"  # type: ignore
        if req_id and isinstance(record.msg, str) and not record.msg.startswith(f"[{req_id}]"):
            record.msg = f"[{req_id}] {record.msg}"
        return True

if not any(isinstance(f, RequestIDFilter) for f in logger.filters):
    logger.addFilter(RequestIDFilter())
