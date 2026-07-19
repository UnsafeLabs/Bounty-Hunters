import csv
import io
from typing import Any

from starlette.responses import StreamingResponse


class StreamingCSVResponse(StreamingResponse):
    """Streaming CSV response for large dataset exports."""

    media_type = "text/csv"

    def __init__(
        self,
        rows: Any,
        headers: dict[str, str] | None = None,
        filename: str = "export.csv",
        chunk_size: int = 1000,
    ) -> None:
        self._rows = rows
        self._chunk_size = chunk_size

        default_headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "text/csv; charset=utf-8",
        }
        if headers:
            default_headers.update(headers)

        super().__init__(
            content=self._generate(),
            media_type="text/csv",
            headers=default_headers,
        )

    def _generate(self):
        output = io.StringIO()
        writer = csv.writer(output)

        batch: list[list[Any]] = []
        for row in self._rows:
            batch.append(row)
            if len(batch) >= self._chunk_size:
                writer.writerows(batch)
                yield output.getvalue().encode("utf-8")
                output.seek(0)
                output.truncate(0)
                batch = []

        if batch:
            writer.writerows(batch)
            yield output.getvalue().encode("utf-8")
