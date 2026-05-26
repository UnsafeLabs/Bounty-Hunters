import csv
import importlib
import io
from collections.abc import AsyncIterable, Mapping, Sequence
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


CSVRow = Mapping[str, Any] | Sequence[Any]


def _render_csv_row(row: Sequence[Any], delimiter: str) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=delimiter, lineterminator="\r\n")
    writer.writerow(row)
    return output.getvalue()


def _csv_values(row: CSVRow, headers: Sequence[str] | None) -> Sequence[Any]:
    if isinstance(row, Mapping):
        if headers is not None:
            return [row.get(header, "") for header in headers]
        return list(row.values())
    return row


async def _stream_csv_rows(
    rows: AsyncIterable[CSVRow],
    *,
    headers: Sequence[str] | None,
    delimiter: str,
) -> AsyncIterable[str]:
    if headers is not None:
        yield _render_csv_row(headers, delimiter)
    async for row in rows:
        yield _render_csv_row(_csv_values(row, headers), delimiter)


def _sanitize_csv_filename(filename: str) -> str:
    return (
        filename.replace("\\", "_")
        .replace("/", "_")
        .replace("\r", "")
        .replace("\n", "")
        .replace('"', "")
    )


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
        http_headers: Mapping[str, str] | None = None,
        background: BackgroundTask | None = None,
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError("delimiter must be a single character")

        safe_filename = _sanitize_csv_filename(filename)
        response_headers = {
            "Content-Disposition": f'attachment; filename="{safe_filename}"'
        }
        if http_headers is not None:
            response_headers.update(http_headers)

        super().__init__(
            _stream_csv_rows(rows, headers=headers, delimiter=delimiter),
            status_code=status_code,
            headers=response_headers,
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
