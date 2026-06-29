import csv
import importlib
from collections.abc import AsyncIterable, AsyncIterator, Iterable, Mapping
from io import StringIO
from typing import Any, Protocol, cast
from urllib.parse import quote

from fastapi.exceptions import FastAPIDeprecationWarning
from fastapi.sse import EventSourceResponse as EventSourceResponse  # noqa
from starlette.responses import FileResponse as FileResponse  # noqa
from starlette.responses import HTMLResponse as HTMLResponse  # noqa
from starlette.responses import JSONResponse as JSONResponse  # noqa
from starlette.responses import PlainTextResponse as PlainTextResponse  # noqa
from starlette.responses import RedirectResponse as RedirectResponse  # noqa
from starlette.responses import Response as Response  # noqa
from starlette.responses import StreamingResponse as StreamingResponse  # noqa
from typing_extensions import deprecated


class _UjsonModule(Protocol):
    def dumps(self, __obj: Any, *, ensure_ascii: bool = ...) -> str: ...


class _OrjsonModule(Protocol):
    OPT_NON_STR_KEYS: int
    OPT_SERIALIZE_NUMPY: int

    def dumps(self, __obj: Any, *, option: int = ...) -> bytes: ...


try:
    ujson = cast(_UjsonModule, importlib.import_module("ujson"))
except ModuleNotFoundError:  # pragma: nocover
    ujson = None  # type: ignore[assignment]


try:
    orjson = cast(_OrjsonModule, importlib.import_module("orjson"))
except ModuleNotFoundError:  # pragma: nocover
    orjson = None  # type: ignore[assignment]


def _get_content_disposition(filename: str) -> str:
    content_disposition_filename = quote(filename)
    if content_disposition_filename != filename:
        return f"attachment; filename*=utf-8''{content_disposition_filename}"
    return f'attachment; filename="{filename}"'


def _normalize_csv_row(
    row: Any,
    headers: tuple[Any, ...] | None = None,
) -> Iterable[Any]:
    if isinstance(row, Mapping):
        if headers is not None:
            return [row.get(header, "") for header in headers]
        return row.values()
    if isinstance(row, (str, bytes, bytearray)):
        return [row]
    if isinstance(row, Iterable):
        return row
    return [row]


def _render_csv_row(row: Iterable[Any], delimiter: str) -> str:
    output = StringIO()
    writer = csv.writer(output, delimiter=delimiter, lineterminator="\r\n")
    writer.writerow(row)
    return output.getvalue()


async def _stream_csv_rows(
    rows: AsyncIterable[Any] | Iterable[Any],
    headers: tuple[Any, ...] | None,
    delimiter: str,
) -> AsyncIterator[str]:
    if headers is not None:
        yield _render_csv_row(headers, delimiter)

    if isinstance(rows, AsyncIterable):
        async for row in rows:
            yield _render_csv_row(_normalize_csv_row(row, headers), delimiter)
        return

    for row in rows:
        yield _render_csv_row(_normalize_csv_row(row, headers), delimiter)


class StreamingCSVResponse(StreamingResponse):
    """Stream CSV rows without building the full export in memory."""

    media_type = "text/csv"

    def __init__(
        self,
        rows: AsyncIterable[Any] | Iterable[Any],
        *,
        headers: Iterable[Any] | None = None,
        filename: str = "data.csv",
        delimiter: str = ",",
        status_code: int = 200,
        response_headers: Mapping[str, str] | None = None,
        background: Any = None,
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError("CSV delimiter must be a single character")

        csv_headers = tuple(headers) if headers is not None else None
        http_headers = dict(response_headers or {})
        http_headers.setdefault(
            "Content-Disposition",
            _get_content_disposition(filename),
        )
        super().__init__(
            _stream_csv_rows(rows, csv_headers, delimiter),
            status_code=status_code,
            headers=http_headers,
            media_type=self.media_type,
            background=background,
        )


@deprecated(
    "UJSONResponse is deprecated, FastAPI now serializes data directly to JSON "
    "bytes via Pydantic when a return type or response model is set, which is "
    "faster and doesn't need a custom response class. Read more in the FastAPI "
    "docs: https://fastapi.tiangolo.com/advanced/custom-response/#orjson-or-response-model "
    "and https://fastapi.tiangolo.com/tutorial/response-model/",
    category=FastAPIDeprecationWarning,
    stacklevel=2,
)
class UJSONResponse(JSONResponse):
    """JSON response using the ujson library to serialize data to JSON.

    **Deprecated**: `UJSONResponse` is deprecated. FastAPI now serializes data
    directly to JSON bytes via Pydantic when a return type or response model is
    set, which is faster and doesn't need a custom response class.

    Read more in the
    [FastAPI docs for Custom Response](https://fastapi.tiangolo.com/advanced/custom-response/#orjson-or-response-model)
    and the
    [FastAPI docs for Response Model](https://fastapi.tiangolo.com/tutorial/response-model/).

    **Note**: `ujson` is not included with FastAPI and must be installed
    separately, e.g. `pip install ujson`.
    """

    def render(self, content: Any) -> bytes:
        assert ujson is not None, "ujson must be installed to use UJSONResponse"
        return ujson.dumps(content, ensure_ascii=False).encode("utf-8")


@deprecated(
    "ORJSONResponse is deprecated, FastAPI now serializes data directly to JSON "
    "bytes via Pydantic when a return type or response model is set, which is "
    "faster and doesn't need a custom response class. Read more in the FastAPI "
    "docs: https://fastapi.tiangolo.com/advanced/custom-response/#orjson-or-response-model "
    "and https://fastapi.tiangolo.com/tutorial/response-model/",
    category=FastAPIDeprecationWarning,
    stacklevel=2,
)
class ORJSONResponse(JSONResponse):
    """JSON response using the orjson library to serialize data to JSON.

    **Deprecated**: `ORJSONResponse` is deprecated. FastAPI now serializes data
    directly to JSON bytes via Pydantic when a return type or response model is
    set, which is faster and doesn't need a custom response class.

    Read more in the
    [FastAPI docs for Custom Response](https://fastapi.tiangolo.com/advanced/custom-response/#orjson-or-response-model)
    and the
    [FastAPI docs for Response Model](https://fastapi.tiangolo.com/tutorial/response-model/).

    **Note**: `orjson` is not included with FastAPI and must be installed
    separately, e.g. `pip install orjson`.
    """

    def render(self, content: Any) -> bytes:
        assert orjson is not None, "orjson must be installed to use ORJSONResponse"
        return orjson.dumps(
            content, option=orjson.OPT_NON_STR_KEYS | orjson.OPT_SERIALIZE_NUMPY
        )
