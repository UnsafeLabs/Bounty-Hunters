import importlib
import csv
import io
from collections.abc import AsyncGenerator
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
from starlette.types import Receive, Scope, Send
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
    """Stream CSV data from an async generator without loading entire dataset.

    Parameters:
        rows: Async generator yielding sequences (list, tuple) of row values.
        headers: Optional list of column names for the first row.
        filename: Filename for Content-Disposition header.
        delimiter: CSV delimiter character (default ',').
        status_code: HTTP status code (default 200).
    """

    def __init__(
        self,
        rows: AsyncGenerator[list[str] | tuple[str, ...], None],
        *,
        headers: list[str] | None = None,
        filename: str | None = None,
        delimiter: str = ",",
        status_code: int = 200,
        **kwargs: Any,
    ) -> None:
        self._rows = rows
        self._csv_headers = headers
        self._delimiter = delimiter

        media_type = kwargs.pop("media_type", "text/csv")
        super().__init__(
            content=self._csv_generator(),
            status_code=status_code,
            media_type=media_type,
            **kwargs,
        )

        if filename is not None:
            self.headers.setdefault(
                "content-disposition", f'attachment; filename="{filename}"'
            )

    async def _csv_generator(self) -> AsyncGenerator[bytes, None]:
        """Generate CSV rows with proper RFC 4180 escaping."""
        if self._csv_headers is not None:
            yield self._escape_row(self._csv_headers).encode("utf-8") + b"\r\n"

        async for row in self._rows:
            yield self._escape_row(row).encode("utf-8") + b"\r\n"

    def _escape_row(self, row: list[str] | tuple[str, ...]) -> str:
        """Escape a row per RFC 4180: wrap fields with commas/quotes/newlines."""
        values = [str(v) for v in row]
        escaped = []
        for val in values:
            if (
                self._delimiter in val
                or '"' in val
                or "\n" in val
                or "\r" in val
            ):
                val = val.replace('"', '""')
                val = f'"{val}"'
            escaped.append(val)
        return self._delimiter.join(escaped)
