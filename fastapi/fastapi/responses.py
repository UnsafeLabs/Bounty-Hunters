import csv
import importlib
import io
import re
from collections.abc import AsyncIterable, AsyncIterator, Iterable, Mapping, Sequence
from typing import Any, Protocol, cast

from fastapi.exceptions import FastAPIDeprecationWarning
from fastapi.sse import EventSourceResponse as EventSourceResponse  # noqa
from starlette.background import BackgroundTask
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


_FILENAME_UNSAFE_CHARS = re.compile(r'[\r\n"\\]+')


def _csv_row_values(row: Any, headers: Sequence[str] | None = None) -> list[Any]:
    if isinstance(row, Mapping):
        if headers is not None:
            return [row.get(header, "") for header in headers]
        return list(row.values())
    if isinstance(row, (str, bytes)):
        return [row]
    if isinstance(row, Iterable):
        return list(row)
    return [row]


def _render_csv_row(row: Sequence[Any], delimiter: str) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, delimiter=delimiter)
    writer.writerow(["" if value is None else value for value in row])
    return buffer.getvalue().encode("utf-8")


def _content_disposition(filename: str) -> str:
    safe_filename = _FILENAME_UNSAFE_CHARS.sub("_", filename).strip() or "download.csv"
    return f'attachment; filename="{safe_filename}"'


class StreamingCSVResponse(StreamingResponse):
    """Streaming response for CSV exports.

    Rows can be sync or async iterables. Mapping rows are emitted in header order
    when headers are provided, and the standard csv module handles CSV escaping.
    """

    media_type = "text/csv"

    def __init__(
        self,
        rows: AsyncIterable[Any] | Iterable[Any],
        *,
        headers: Sequence[str] | None = None,
        filename: str = "download.csv",
        delimiter: str = ",",
        status_code: int = 200,
        http_headers: Mapping[str, str] | None = None,
        media_type: str | None = None,
        background: BackgroundTask | None = None,
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError("CSV delimiter must be a one-character string")

        response_headers = dict(http_headers or {})
        response_headers.setdefault(
            "Content-Disposition", _content_disposition(filename)
        )

        super().__init__(
            self._stream_rows(rows, headers, delimiter),
            status_code=status_code,
            headers=response_headers,
            media_type=media_type or self.media_type,
            background=background,
        )

    async def _stream_rows(
        self,
        rows: AsyncIterable[Any] | Iterable[Any],
        headers: Sequence[str] | None,
        delimiter: str,
    ) -> AsyncIterator[bytes]:
        csv_headers = list(headers) if headers is not None else None
        if csv_headers is not None:
            yield _render_csv_row(csv_headers, delimiter)

        if isinstance(rows, AsyncIterable):
            async for row in rows:
                yield _render_csv_row(_csv_row_values(row, csv_headers), delimiter)
        else:
            for row in rows:
                yield _render_csv_row(_csv_row_values(row, csv_headers), delimiter)


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
