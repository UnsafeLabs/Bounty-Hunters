import logging

from .middleware.request_id import request_id_var


class RequestIDFilter(logging.Filter):
    """Logging filter that adds request_id to log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        req_id = request_id_var.get()
        record.request_id = req_id if req_id else "-"
        return True


logger = logging.getLogger("fastapi")
logger.addFilter(RequestIDFilter())
