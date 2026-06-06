import csv
import importlib
import io
from collections.abc import AsyncIterable, Iterable, Mapping, Sequence
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


def _csv_content_disposition(filename: str) -> str:
    safe_filename = filename.replace("\r", "_").replace("\n", "_")
    quoted_filename = quote(safe_filename, safe="")
    if quoted_filename == safe_filename:
        return f'attachment; filename="{safe_filename}"'
    return f"attachment; filename*=utf-8''{quoted_filename}"


def _csv_row_values(
    row: Any,
    headers: Sequence[str] | None,
) -> Iterable[Any]:
    if isinstance(row, Mapping):
        if headers is None:
            return row.values()
        return (row.get(header, "") for header in headers)
    if isinstance(row, str | bytes):
        return (row,)
    return row


def _render_csv_row(
    row: Iterable[Any],
    delimiter: str,
) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=delimiter, lineterminator="\r\n")
    writer.writerow("" if value is None else value for value in row)
    return output.getvalue().encode("utf-8")


class StreamingCSVResponse(StreamingResponse):
    media_type = "text/csv"

    def __init__(
        self,
        rows: AsyncIterable[Any] | Iterable[Any],
        *,
        headers: Sequence[str] | None = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        status_code: int = 200,
        response_headers: Mapping[str, str] | None = None,
        background: Any = None,
    ) -> None:
        http_headers = dict(response_headers or {})
        http_headers.setdefault(
            "Content-Disposition",
            _csv_content_disposition(filename),
        )
        super().__init__(
            self._stream_rows(rows, csv_headers=headers, delimiter=delimiter),
            status_code=status_code,
            headers=http_headers,
            media_type=self.media_type,
            background=background,
        )

    @staticmethod
    async def _stream_rows(
        rows: AsyncIterable[Any] | Iterable[Any],
        *,
        csv_headers: Sequence[str] | None,
        delimiter: str,
    ) -> AsyncIterable[bytes]:
        if csv_headers is not None:
            yield _render_csv_row(csv_headers, delimiter)

        if isinstance(rows, AsyncIterable):
            async for row in rows:
                yield _render_csv_row(_csv_row_values(row, csv_headers), delimiter)
            return

        for row in rows:
            yield _render_csv_row(_csv_row_values(row, csv_headers), delimiter)


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
