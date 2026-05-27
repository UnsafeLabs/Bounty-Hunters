import importlib
import io
from typing import Any, AsyncIterator, Optional, Protocol, Union, cast

from fastapi.exceptions import FastAPIDeprecationWarning
from fastapi.sse import EventSourceResponse as EventSourceResponse  # noqa
from starlette.responses import FileResponse as FileResponse  # noqa
from starlette.responses import HTMLResponse as HTMLResponse  # noqa
from starlette.responses import JSONResponse as JSONResponse  # noqa
from starlette.responses import PlainTextResponse as PlainTextResponse  # noqa
from starlette.responses import RedirectResponse as RedirectResponse  # noqa
from starlette.responses import RedirectResponse as RedirectResponse  # noqa
from starlette.responses import Response as Response  # noqa
from starlette.responses import StreamingResponse as StreamingResponse  # noqa
from starlette.datastructures import Headers
from typing_extensions import deprecated


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
    def render(self, content: Any) -> bytes:
        assert orjson is not None, "orjson must be installed to use ORJSONResponse"
        return orjson.dumps(content, option=orjson.OPT_NON_STR_KEYS | orjson.OPT_SERIALIZE_NUMPY)


class StreamingCSVResponse(StreamingResponse):
    """Streaming CSV response for large dataset exports.

    Streams rows of CSV data without loading the entire dataset in memory.
    Supports custom delimiters, configurable filename, and proper RFC 4180 escaping.
    """

    def __init__(
        self,
        content: AsyncIterator[Union[list, tuple]],
        *,
        headers: Optional[list[str]] = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        status_code: int = 200,
        media_type: str = "text/csv",
        background: Any = None,
    ) -> None:
        self._csv_headers = headers
        self._filename = filename
        self._delimiter = delimiter

        # Build Content-Disposition header
        content_disposition = f'attachment; filename="{filename}"'

        # Initialize headers dict
        init_headers: dict[str, str] = {
            "Content-Disposition": content_disposition,
        }

        super().__init__(
            content=self._stream_rows(content),
            status_code=status_code,
            headers=init_headers,
            media_type=media_type,
            background=background,
        )

    def _escape_value(self, value: Any) -> str:
        """Escape a single CSV value according to RFC 4180."""
        if value is None:
            return ""
        str_value = str(value)

        # Check if we need to quote this value
        needs_quoting = (
            self._delimiter in str_value
            or '"' in str_value
            or "\n" in str_value
            or "\r" in str_value
        )

        # Escape double quotes by doubling them
        str_value = str_value.replace('"', '""')

        if needs_quoting:
            str_value = f'"{str_value}"'

        return str_value

    def _format_row(self, row: Union[list, tuple]) -> str:
        """Format a row of data as a CSV line."""
        escaped_values = [self._escape_value(value) for value in row]
        return self._delimiter.join(escaped_values) + "\r\n"

    async def _stream_rows(self, content: AsyncIterator[Union[list, tuple]]) -> AsyncIterator[bytes]:
        """Stream rows as CSV data."""
        if self._csv_headers is not None:
            yield self._format_row(self._csv_headers).encode("utf-8")

        async for row in content:
            yield self._format_row(row).encode("utf-8")
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
