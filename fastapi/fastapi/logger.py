import logging

from fastapi.middleware.request_id import RequestIDLogFilter

logger = logging.getLogger("fastapi")

if not any(
    isinstance(logger_filter, RequestIDLogFilter) for logger_filter in logger.filters
):
    logger.addFilter(RequestIDLogFilter())
