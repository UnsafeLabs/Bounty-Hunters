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

CSVRow = Mapping[str, Any] | Iterable[Any]


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


class StreamingCSVResponse(StreamingResponse):
    media_type = "text/csv"

    def __init__(
        self,
        rows: AsyncIterable[CSVRow],
        *,
        headers: Sequence[str] | None = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        status_code: int = 200,
        response_headers: Mapping[str, str] | None = None,
        background: Any = None,
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError("delimiter must be a single character")

        csv_headers = tuple(headers or ())
        http_headers = dict(response_headers or {})
        http_headers.setdefault(
            "content-disposition", self._content_disposition(filename)
        )
        super().__init__(
            self._stream_rows(rows, csv_headers, delimiter),
            status_code=status_code,
            media_type=self.media_type,
            headers=http_headers,
            background=background,
        )

    @classmethod
    async def _stream_rows(
        cls,
        rows: AsyncIterable[CSVRow],
        headers: tuple[str, ...],
        delimiter: str,
    ) -> AsyncIterable[bytes]:
        if headers:
            yield cls._render_row(headers, delimiter)

        async for row in rows:
            yield cls._render_row(cls._row_values(row, headers), delimiter)

    @staticmethod
    def _row_values(row: CSVRow, headers: tuple[str, ...]) -> Iterable[Any]:
        if isinstance(row, Mapping):
            if headers:
                return [row.get(header, "") for header in headers]
            return row.values()

        if isinstance(row, (str, bytes)):
            return [row]

        return row

    @staticmethod
    def _render_row(values: Iterable[Any], delimiter: str) -> bytes:
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\r\n")
        writer.writerow(["" if value is None else value for value in values])
        return buffer.getvalue().encode("utf-8")

    @staticmethod
    def _content_disposition(filename: str) -> str:
        safe_filename = filename or "export.csv"
        fallback_filename = safe_filename.encode("ascii", "ignore").decode("ascii")
        fallback_filename = fallback_filename or "export.csv"
        fallback_filename = (
            fallback_filename.replace("\\", "_")
            .replace("/", "_")
            .replace('"', "_")
            .replace("\r", "_")
            .replace("\n", "_")
        )
        encoded_filename = quote(safe_filename, safe="")
        return (
            f'attachment; filename="{fallback_filename}"; '
            f"filename*=utf-8''{encoded_filename}"
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
