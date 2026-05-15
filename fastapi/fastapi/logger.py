import logging

from fastapi.middleware.request_id import RequestIDFilter

logger = logging.getLogger("fastapi")
logger.addFilter(RequestIDFilter())
