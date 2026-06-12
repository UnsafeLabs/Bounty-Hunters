import importlib
import csv
import io
from typing import Any, AsyncGenerator, Iterable, Optional, Protocol, Sequence, cast

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
    """
    Streaming CSV response for large dataset exports.
    Accepts an async generator of row data (lists or tuples).
    """

    def __init__(
        self,
        content: AsyncGenerator[Sequence[Any], None] | Iterable[Sequence[Any]],
        status_code: int = 200,
        headers: Optional[dict[str, str]] = None,
        media_type: Optional[str] = None,
        background: Optional[Any] = None,
        filename: str = "export.csv",
        column_headers: Optional[Sequence[str]] = None,
        delimiter: str = ",",
    ) -> None:
        self.column_headers = column_headers
        self.delimiter = delimiter

        headers = headers or {}
        headers.setdefault(
            "Content-Disposition", f'attachment; filename="{filename}"'
        )

        super().__init__(
            content=self._csv_generator(content),
            status_code=status_code,
            headers=headers,
            media_type=media_type or "text/csv",
            background=background,
        )

    async def _csv_generator(
        self, content: AsyncGenerator[Sequence[Any], None] | Iterable[Sequence[Any]]
    ) -> AsyncGenerator[str, None]:
        output = io.StringIO()
        writer = csv.writer(output, delimiter=self.delimiter, quoting=csv.QUOTE_MINIMAL)

        # Write column headers if provided
        if self.column_headers:
            writer.writerow(self.column_headers)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

        if hasattr(content, "__aiter__"):
            async for row in content:  # type: ignore
                writer.writerow(row)
                yield output.getvalue()
                output.seek(0)
                output.truncate(0)
        else:
            for row in content:  # type: ignore
                writer.writerow(row)
                yield output.getvalue()
                output.seek(0)
                output.truncate(0)
