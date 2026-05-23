import logging

from .middleware.request_id import request_id_var


class RequestIDFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.request_id = request_id_var.get()
        except LookupError:
            record.request_id = "-"
        return True


logger = logging.getLogger("fastapi")
