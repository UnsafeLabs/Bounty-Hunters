"""Tests for StreamingCSVResponse."""

from typing import Any, AsyncGenerator, Sequence

import pytest
from fastapi.responses import StreamingCSVResponse


async def _async_rows(
    rows: list[Sequence[Any]],
) -> AsyncGenerator[Sequence[Any], None]:
    for row in rows:
        yield row


class TestStreamingCSVResponse:
    """Test suite for StreamingCSVResponse."""

    @pytest.mark.asyncio
    async def test_basic_csv_output(self):
        """Basic CSV with headers produces correct output."""
        response = StreamingCSVResponse(
            rows=_async_rows([[1, "Alice"], [2, "Bob"]]),
            headers=["id", "name"],
        )
        content = b"".join([chunk async for chunk in response.body_iterator])
        expected = b"id,name\r\n1,Alice\r\n2,Bob\r\n"
        assert content == expected

    @pytest.mark.asyncio
    async def test_no_headers(self):
        """CSV without headers works correctly."""
        response = StreamingCSVResponse(
            rows=_async_rows([["a", 1], ["b", 2]]),
        )
        content = b"".join([chunk async for chunk in response.body_iterator])
        expected = b"a,1\r\nb,2\r\n"
        assert content == expected

    @pytest.mark.asyncio
    async def test_comma_in_value_is_quoted(self):
        """Values containing commas are wrapped in double quotes."""
        response = StreamingCSVResponse(
            rows=_async_rows([["hello, world", 42]]),
            headers=["greeting", "number"],
        )
        content = b"".join([chunk async for chunk in response.body_iterator])
        expected = b'greeting,number\r\n"hello, world",42\r\n'
        assert content == expected

    @pytest.mark.asyncio
    async def test_quotes_in_value_are_escaped(self):
        """Values containing double quotes have them escaped by doubling."""
        response = StreamingCSVResponse(
            rows=_async_rows([['say "hello"', 42]]),
            headers=["text", "value"],
        )
        content = b"".join([chunk async for chunk in response.body_iterator])
        expected = b'text,value\r\n"say ""hello""",42\r\n'
        assert content == expected

    @pytest.mark.asyncio
    async def test_newlines_in_value_are_quoted(self):
        """Values containing newlines are wrapped in quotes."""
        response = StreamingCSVResponse(
            rows=_async_rows([["line1\nline2", 99]]),
            headers=["text", "num"],
        )
        content = b"".join([chunk async for chunk in response.body_iterator])
        expected = b'text,num\r\n"line1\nline2",99\r\n'
        assert content == expected

    @pytest.mark.asyncio
    async def test_custom_delimiter(self):
        """Custom delimiter works correctly."""
        response = StreamingCSVResponse(
            rows=_async_rows([["a", "b"], ["c", "d"]]),
            headers=["col1", "col2"],
            delimiter=";",
        )
        content = b"".join([chunk async for chunk in response.body_iterator])
        expected = b"col1;col2\r\na;b\r\nc;d\r\n"
        assert content == expected

    @pytest.mark.asyncio
    async def test_content_disposition_filename(self):
        """Filename in Content-Disposition header is configurable."""
        response = StreamingCSVResponse(
            rows=_async_rows([[1]]),
            filename="my-export.csv",
        )
        assert response.headers["Content-Disposition"] == 'attachment; filename="my-export.csv"'

    @pytest.mark.asyncio
    async def test_content_type(self):
        """Content-Type is set to text/csv."""
        response = StreamingCSVResponse(
            rows=_async_rows([[1]]),
        )
        assert response.media_type == "text/csv"

    @pytest.mark.asyncio
    async def test_none_values_handled(self):
        """None values are converted to empty strings."""
        response = StreamingCSVResponse(
            rows=_async_rows([[1, None, 3]]),
            headers=["a", "b", "c"],
        )
        content = b"".join([chunk async for chunk in response.body_iterator])
        expected = b"a,b,c\r\n1,,3\r\n"
        assert content == expected

    @pytest.mark.asyncio
    async def test_streaming_no_full_load(self):
        """Rows are streamed without loading entire dataset in memory."""
        # Verify by creating a large generator and checking it's iterated lazily
        called = 0

        async def lazy_rows() -> AsyncGenerator[Sequence[Any], None]:
            nonlocal called
            for i in range(10):
                called += 1
                yield [i]

        response = StreamingCSVResponse(
            rows=lazy_rows(),
            headers=["num"],
        )
        # Read only first chunk
        async for chunk in response.body_iterator:
            assert called <= 2  # Only first row(s) materialized
            break
