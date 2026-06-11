import csv
import importlib
import io
from collections.abc import AsyncIterable, Iterable, Mapping, Sequence
from typing import Any, Protocol, cast
from urllib.parse import quote

from fastapi.exceptions import FastAPIDeprecationWarning
from fastapi.sse import EventSourceResponse as EventSourceResponse  # noqa
from starlette.background import BackgroundTask
from starlette.concurrency import iterate_in_threadpool
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


CSVRow = Sequence[Any] | Mapping[str, Any]


try:
    ujson = cast(_UjsonModule, importlib.import_module("ujson"))
except ModuleNotFoundError:  # pragma: nocover
    ujson = None  # type: ignore[assignment]


try:
    orjson = cast(_OrjsonModule, importlib.import_module("orjson"))
except ModuleNotFoundError:  # pragma: nocover
    orjson = None  # type: ignore[assignment]


class StreamingCSVResponse(StreamingResponse):
    media_type = "text/csv"

    def __init__(
        self,
        content: AsyncIterable[CSVRow] | Iterable[CSVRow],
        *,
        headers: Sequence[str] | Mapping[str, str] | None = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        status_code: int = 200,
        media_type: str | None = None,
        background: BackgroundTask | None = None,
        response_headers: Mapping[str, str] | None = None,
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError("delimiter must be a single character")
        csv_headers: Sequence[str] | None
        http_headers = dict(response_headers or {})
        if isinstance(headers, Mapping):
            csv_headers = None
            http_headers.update(headers)
        else:
            csv_headers = headers
        http_headers.setdefault(
            "Content-Disposition",
            self._content_disposition(filename),
        )
        super().__init__(
            self._stream_csv(content, csv_headers=csv_headers, delimiter=delimiter),
            status_code=status_code,
            headers=http_headers,
            media_type=media_type or self.media_type,
            background=background,
        )

    async def _stream_csv(
        self,
        content: AsyncIterable[CSVRow] | Iterable[CSVRow],
        *,
        csv_headers: Sequence[str] | None,
        delimiter: str,
    ) -> AsyncIterable[bytes]:
        if csv_headers is not None:
            yield self._render_row(csv_headers, delimiter=delimiter)

        if isinstance(content, AsyncIterable):
            async for row in content:
                yield self._render_row(
                    self._normalize_row(row, headers=csv_headers),
                    delimiter=delimiter,
                )
        else:
            async for row in iterate_in_threadpool(iter(content)):
                yield self._render_row(
                    self._normalize_row(row, headers=csv_headers),
                    delimiter=delimiter,
                )

    def _normalize_row(
        self,
        row: CSVRow,
        *,
        headers: Sequence[str] | None,
    ) -> Sequence[Any]:
        if isinstance(row, Mapping):
            if headers is not None:
                return [row.get(header, "") for header in headers]
            return list(row.values())
        if isinstance(row, str | bytes):
            return [row]
        return row

    def _render_row(self, row: Sequence[Any], *, delimiter: str) -> bytes:
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\r\n")
        writer.writerow(row)
        return buffer.getvalue().encode("utf-8")

    def _content_disposition(self, filename: str) -> str:
        quoted_filename = quote(filename)
        if quoted_filename != filename:
            return f"attachment; filename*=utf-8''{quoted_filename}"
        escaped_filename = filename.replace("\\", "\\\\").replace('"', '\\"')
        return f'attachment; filename="{escaped_filename}"'


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
