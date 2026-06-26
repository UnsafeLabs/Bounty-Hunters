import logging

from fastapi.middleware.request_id import get_request_id

logger = logging.getLogger("fastapi")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id() or "-"
        return True


if not any(
    filter_.__class__.__module__ == __name__
    and filter_.__class__.__name__ == RequestIdFilter.__name__
    for filter_ in logger.filters
):
    logger.addFilter(RequestIdFilter())
