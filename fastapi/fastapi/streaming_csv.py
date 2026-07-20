"""StreamingCSVResponse for large dataset exports (issue #799)."""

from __future__ import annotations

from typing import Any, AsyncIterator, Iterable, Optional, Sequence, Union


def csv_escape(value: Any, delimiter: str = ",") -> str:
    if value is None:
        s = ""
    else:
        s = str(value)
    must_quote = (
        delimiter in s
        or '"' in s
        or "\n" in s
        or "\r" in s
    )
    if '"' in s:
        s = s.replace('"', '""')
    if must_quote:
        return f'"{s}"'
    return s


def format_csv_row(row: Sequence[Any], delimiter: str = ",") -> str:
    return delimiter.join(csv_escape(v, delimiter) for v in row) + "\n"


async def iter_csv(
    rows: Union[AsyncIterator[Sequence[Any]], Iterable[Sequence[Any]]],
    *,
    headers: Optional[Sequence[str]] = None,
    delimiter: str = ",",
) -> AsyncIterator[str]:
    if headers is not None:
        yield format_csv_row(headers, delimiter)
    if hasattr(rows, "__aiter__"):
        async for row in rows:  # type: ignore[union-attr]
            yield format_csv_row(row, delimiter)
    else:
        for row in rows:  # type: ignore[union-attr]
            yield format_csv_row(row, delimiter)


class StreamingCSVResponse:
    """
    Minimal StreamingCSVResponse (async body iterator + headers).
    Compatible shape with Starlette StreamingResponse for tests.
    """

    media_type = "text/csv"

    def __init__(
        self,
        rows: Union[AsyncIterator[Sequence[Any]], Iterable[Sequence[Any]]],
        *,
        headers: Optional[Sequence[str]] = None,
        filename: str = "export.csv",
        delimiter: str = ",",
        status_code: int = 200,
    ) -> None:
        self.rows = rows
        self.column_headers = headers
        self.filename = filename
        self.delimiter = delimiter
        self.status_code = status_code
        self.headers = {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": f'attachment; filename="{filename}"',
        }

    async def body_iterator(self) -> AsyncIterator[bytes]:
        async for chunk in iter_csv(
            self.rows, headers=self.column_headers, delimiter=self.delimiter
        ):
            yield chunk.encode("utf-8")
