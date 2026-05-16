import logging
from contextvars import ContextVar

logger = logging.getLogger("fastapi")

request_id_context: ContextVar[str | None] = ContextVar(
    "fastapi_request_id",
    default=None,
)


def get_request_id() -> str | None:
    return request_id_context.get()


def _install_request_id_record_factory() -> None:
    current_factory = logging.getLogRecordFactory()
    if getattr(current_factory, "_fastapi_request_id_factory", False):
        return

    def record_factory(*args, **kwargs):  # type: ignore[no-untyped-def]
        record = current_factory(*args, **kwargs)
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id() or "-"
        return record

    record_factory._fastapi_request_id_factory = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(record_factory)


_install_request_id_record_factory()
