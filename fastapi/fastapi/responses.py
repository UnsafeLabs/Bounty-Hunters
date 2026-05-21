import csv
import importlib
from collections.abc import AsyncIterable, Iterable, Mapping, Sequence
from io import StringIO
from typing import Any, Protocol, cast

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

CSVRow = Mapping[str, Any] | Sequence[Any]


def _quote_content_disposition_filename(filename: str) -> str:
    return filename.replace("\\", "\\\\").replace('"', '\\"')


def _normalise_csv_row(row: CSVRow, headers: Sequence[str] | None) -> Sequence[Any]:
    if isinstance(row, Mapping):
        if headers is not None:
            return [row.get(header, "") for header in headers]
        return list(row.values())
    if isinstance(row, str | bytes):
        return [row]
    return row


def _render_csv_row(
    row: CSVRow,
    *,
    headers: Sequence[str] | None,
    delimiter: str,
) -> str:
    output = StringIO()
    writer = csv.writer(output, delimiter=delimiter)
    writer.writerow(_normalise_csv_row(row, headers))
    return output.getvalue()


async def _iterate_csv_rows(
    content: AsyncIterable[CSVRow] | Iterable[CSVRow],
    *,
    headers: Sequence[str] | None,
    delimiter: str,
) -> AsyncIterable[str]:
    if headers is not None:
        yield _render_csv_row(headers, headers=None, delimiter=delimiter)

    if isinstance(content, AsyncIterable):
        async for row in content:
            yield _render_csv_row(row, headers=headers, delimiter=delimiter)
    else:
        for row in content:
            yield _render_csv_row(row, headers=headers, delimiter=delimiter)


class StreamingCSVResponse(StreamingResponse):
    """Stream CSV rows without materialising the full export in memory."""

    media_type = "text/csv"

    def __init__(
        self,
        content: AsyncIterable[CSVRow] | Iterable[CSVRow],
        status_code: int = 200,
        headers: Sequence[str] | None = None,
        response_headers: Mapping[str, str] | None = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        background: Any = None,
    ) -> None:
        rendered_rows = _iterate_csv_rows(
            content,
            headers=headers,
            delimiter=delimiter,
        )
        http_headers = dict(response_headers or {})
        http_headers.setdefault(
            "Content-Disposition",
            f'attachment; filename="{_quote_content_disposition_filename(filename)}"',
        )
        super().__init__(
            rendered_rows,
            status_code=status_code,
            headers=http_headers,
            media_type=self.media_type,
            background=background,
        )


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
