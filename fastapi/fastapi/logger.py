import logging

from .middleware.request_id import request_id_var


class RequestIDFilter(logging.Filter):
    def filter(self, record):
        record.request_id = request_id_var.get()
        return True


logger = logging.getLogger("fastapi")
logger.addFilter(RequestIDFilter())
