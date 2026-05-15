from __future__ import annotations

import csv
import io
from collections.abc import AsyncIterator
from typing import Any

from starlette.responses import StreamingResponse


class StreamingCSVResponse(StreamingResponse):
    """Streaming response that encodes an iterable of rows as CSV data.

    Accepts an iterable of **dicts** (column names are auto-detected from the
    first row) or an iterable of **lists/tuples**.  The CSV content is streamed
    with ``text/csv`` content type, making it suitable for large datasets that
    should not be buffered entirely in memory.

    Usage as a **response class**::

        from fastapi.responses import StreamingCSVResponse
        from fastapi import APIRouter

        router = APIRouter()

        @router.get("/export", response_class=StreamingCSVResponse)
        def export_csv():
            rows = [
                {"name": "Alice", "age": 30, "city": "New York"},
                {"name": "Bob",   "age": 25, "city": "London"},
            ]
            return StreamingCSVResponse(rows)

    Usage with a **generator** for large datasets::

        def large_csv():
            yield ["col_a", "col_b", "col_c"]
            for batch in query_database():
                for row in batch:
                    yield [row["a"], row["b"], row["c"]]

        return StreamingCSVResponse(large_csv())

    Args:
        content: An iterable of dicts, lists, or tuples representing CSV rows.
        status_code: HTTP status code (default ``200``).
        headers: Optional custom headers.
        media_type: Media type. Defaults to ``\"text/csv\"``.
        background: Optional background task.
        columns: Ordered list of column names. Required when ``content`` is an
            iterable of lists and you want a header row; when ``content`` is an
            iterable of dicts, columns may be provided to control ordering and
            subset of columns — if omitted, column names are auto-detected from
            the first dict in the iterable.
        delimiter: Single-character field delimiter. Defaults to ``,`` (comma).

    Raises:
        ValueError: If ``delimiter`` is not a single character.
    """

    media_type = "text/csv"

    def __init__(
        self,
        content: Any = None,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        media_type: str = "text/csv",
        background: Any = None,
        *,
        columns: list[str] | None = None,
        delimiter: str = ",",
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError(
                f"delimiter must be a single character, got {delimiter!r}"
            )

        self._columns = columns
        self._delimiter = delimiter

        stream = _csv_stream(content, columns=columns, delimiter=delimiter)

        super().__init__(
            stream,
            status_code=status_code,
            headers=headers,
            media_type=media_type,
            background=background,
        )


async def _csv_stream(
    content: Any,
    *,
    columns: list[str] | None = None,
    delimiter: str = ",",
) -> AsyncIterator[bytes]:
    """Convert an iterable of rows into CSV bytes ready for streaming."""

    writer_buffer = io.StringIO()
    writer = csv.writer(writer_buffer, delimiter=delimiter)

    # ------------------------------------------------------------------
    # Convert a sync iterable to an async iterator if needed
    # ------------------------------------------------------------------
    if hasattr(content, "__aiter__"):
        aiter: AsyncIterator[Any] = content  # type: ignore[assignment]
    elif hasattr(content, "__iter__"):

        async def _sync_wrapper() -> AsyncIterator[Any]:
            for item in content:  # type: ignore[union-attr]
                yield item

        aiter = _sync_wrapper()
    else:
        raise TypeError("content must be an async or sync iterable")

    # ------------------------------------------------------------------
    # Peek at the first item to detect column names from dict keys
    # ------------------------------------------------------------------
    resolved_columns: list[str] | None = columns

    if resolved_columns is None:
        first_item = None
        async for item in aiter:
            first_item = item
            break

        if first_item is None:
            # Empty iterable — nothing to stream
            return

        if isinstance(first_item, dict):
            resolved_columns = list(first_item.keys())

            # Chain the first item back into the stream so it is written
            # as a data row after the header.
            async def _prepend_first(
                first: Any,
                rest: AsyncIterator[Any],
            ) -> AsyncIterator[Any]:
                yield first
                async for item in rest:
                    yield item

            aiter = _prepend_first(first_item, aiter)

        elif isinstance(first_item, (list, tuple)):
            # No columns specified for list/tuple rows — skip the header
            # and write data rows only.
            yield writer.writerow(first_item).__str__().encode()
            writer_buffer.seek(0)
            writer_buffer.truncate(0)
            # Chain the rest
            async def _prepend_rest(rest: AsyncIterator[Any]) -> AsyncIterator[Any]:
                async for item in rest:
                    yield item

            aiter = _prepend_rest(aiter)

        else:
            raise TypeError(
                f"Expected dict, list, or tuple rows, got {type(first_item).__name__}"
            )

    # ------------------------------------------------------------------
    # Write the header row (only when columns are resolved)
    # ------------------------------------------------------------------
    if resolved_columns is not None:
        writer.writerow(resolved_columns)
        yield writer_buffer.getvalue().encode("utf-8")
        writer_buffer.seek(0)
        writer_buffer.truncate(0)

    # ------------------------------------------------------------------
    # Write data rows
    # ------------------------------------------------------------------
    async for row in aiter:
        if isinstance(row, dict):
            writer.writerow(
                [str(row.get(col, "")) for col in resolved_columns]  # type: ignore[union-attr]
            )
        elif isinstance(row, (list, tuple)):
            writer.writerow(row)
        else:
            raise TypeError(
                f"Expected dict, list, or tuple rows, got {type(row).__name__}"
            )

        yield writer_buffer.getvalue().encode("utf-8")
        writer_buffer.seek(0)
        writer_buffer.truncate(0)
