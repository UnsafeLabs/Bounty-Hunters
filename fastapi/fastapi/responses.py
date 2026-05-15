import csv
import importlib
from io import StringIO
from typing import Any, AsyncGenerator, Protocol, Sequence, cast

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


def _escape_csv_value(value: Any, delimiter: str) -> str:
    """Escape a single CSV value per RFC 4180."""
    s = str(value) if value is not None else ""
    needs_quoting = (
        delimiter in s
        or '"' in s
        or "\n" in s
        or "\r" in s
        or "," in s
    )
    if needs_quoting:
        escaped = s.replace('"', '""')
        s = f'"{escaped}"'
    return s


async def _csv_row_generator(
    headers: Sequence[str] | None,
    rows: AsyncGenerator[Sequence[Any], None],
    delimiter: str,
) -> AsyncGenerator[bytes, None]:
    """Generate CSV content as bytes from an async row generator."""
    if headers:
        header_line = delimiter.join(_escape_csv_value(h, delimiter) for h in headers)
        yield (header_line + "\r\n").encode("utf-8")

    async for row in rows:
        values = [_escape_csv_value(v, delimiter) for v in row]
        line = delimiter.join(values)
        yield (line + "\r\n").encode("utf-8")


class StreamingCSVResponse(StreamingResponse):
    """
    A streaming CSV response for large dataset exports.

    Streams rows as CSV without loading the entire dataset into memory.
    Supports RFC 4180 escaping, custom delimiters, and configurable filenames.

    ## Example

    ```python
    from fastapi.responses import StreamingCSVResponse


    async def generate_rows():
        for i in range(1000000):
            yield [i, f"item-{i}", "description"]

    @app.get("/export.csv")
    async def export_csv():
        return StreamingCSVResponse(
            rows=generate_rows(),
            headers=["id", "name", "description"],
            filename="export.csv",
        )
    ```
    """

    MEDIA_TYPE = "text/csv"

    def __init__(
        self,
        rows: AsyncGenerator[Sequence[Any], None],
        headers: Sequence[str] | None = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        status_code: int = 200,
        **kwargs: Any,
    ):
        """
        Create a streaming CSV response.

        Args:
            rows: Async generator yielding sequences (lists/tuples) of row values.
            headers: Optional list of column names written as the first row.
            filename: Filename in the Content-Disposition header.
            delimiter: CSV delimiter character (default: comma).
            status_code: HTTP status code (default: 200).
        """
        content = _csv_row_generator(headers, rows, delimiter)
        super().__init__(
            content=content,
            status_code=status_code,
            media_type=self.MEDIA_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
            **kwargs,
        )
