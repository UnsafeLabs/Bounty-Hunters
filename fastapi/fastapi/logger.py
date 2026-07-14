import logging


class _RequestIDFilter(logging.Filter):
    """Injects the current request ID (if any) into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        from fastapi.middleware.request_id import request_id_ctx

        rid = request_id_ctx.get(None)
        record.request_id = rid or "-"  # type: ignore[attr-defined]
        return True


logger = logging.getLogger("fastapi")
logger.addFilter(_RequestIDFilter())
