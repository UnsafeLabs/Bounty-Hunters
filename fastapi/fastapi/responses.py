import importlib
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


class StreamingCSVResponse(StreamingResponse):
    """A streaming CSV response for large dataset exports.

    Accepts an async generator of row data and streams it as a CSV file
    without loading the entire dataset into memory.

    Implements RFC 4180 escaping: values containing commas, double quotes,
    or newlines are wrapped in double quotes, with internal double quotes
    escaped by doubling.

    ## Usage

    ```python
    from fastapi import FastAPI
    from fastapi.responses import StreamingCSVResponse

    app = FastAPI()

    async def generate_rows():
        yield [\"Alice\", 30, \"Engineer\"]
        yield [\"Bob\", 25, \"Designer\"]

    @app.get(\"/export\")
    async def export():
        return StreamingCSVResponse(
            generate_rows(),
            headers=[\"Name\", \"Age\", \"Role\"],
            filename=\"users.csv\",
        )
    ```
    """

    def __init__(
        self,
        rows,
        headers: list[str] | None = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        media_type: str = "text/csv",
        **kwargs,
    ):
        self._rows = rows
        self._headers = headers
        self._delimiter = delimiter

        content = self._stream()
        content_headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
        }

        super().__init__(
            content=content,
            media_type=media_type,
            headers=content_headers,
            **kwargs,
        )

    @staticmethod
    def _escape_field(value: Any, delimiter: str) -> str:
        """Escape a CSV field per RFC 4180."""
        s = str(value)
        # If the value contains a comma, double quote, newline, or the
        # delimiter itself, wrap in double quotes and escape internal quotes.
        needs_escaping = (
            delimiter in s or '"' in s or "\n" in s or "\r" in s or "," in s
        )
        if needs_escaping:
            return '"' + s.replace('"', '""') + '"'
        return s

    async def _stream(self):
        """Async generator that yields CSV content as bytes."""
        if self._headers:
            line = self._delimiter.join(
                self._escape_field(h, self._delimiter) for h in self._headers
            )
            yield (line + "\r\n").encode("utf-8")

        async for row in self._rows:
            line = self._delimiter.join(
                self._escape_field(cell, self._delimiter) for cell in row
            )
            yield (line + "\r\n").encode("utf-8")
