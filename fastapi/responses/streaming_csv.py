"""Fix: Add StreamingCSVResponse for large dataset exports (#799)"""

import csv
import io
import asyncio
from typing import AsyncIterator, Sequence, Any
from fastapi.responses import StreamingResponse

class StreamingCSVResponse(StreamingResponse):
    """Stream CSV data to avoid loading entire dataset into memory."""

    def __init__(
        self,
        rows: AsyncIterator[Sequence[Any]] | Sequence[Sequence[Any]],
        filename: str = "export.csv",
        headers: Sequence[str] | None = None,
        batch_size: int = 1000,
        **kwargs,
    ):
        self._rows = rows
        self._headers = headers
        self._batch_size = batch_size

        super().__init__(
            content=self._generate(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Type": "text/csv; charset=utf-8",
            },
            **kwargs,
        )

    async def _generate(self) -> AsyncIterator[str]:
        output = io.StringIO()
        writer = csv.writer(output)

        # Write header row
        if self._headers:
            writer.writerow(self._headers)
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

        # Write data rows in batches
        count = 0
        if hasattr(self._rows, "__aiter__"):
            async for row in self._rows:
                writer.writerow(row)
                count += 1
                if count >= self._batch_size:
                    yield output.getvalue()
                    output.seek(0)
                    output.truncate(0)
                    count = 0
                    await asyncio.sleep(0)  # Yield control
        else:
            for row in self._rows:
                writer.writerow(row)
                count += 1
                if count >= self._batch_size:
                    yield output.getvalue()
                    output.seek(0)
                    output.truncate(0)
                    count = 0

        # Flush remaining
        if count > 0:
            yield output.getvalue()
