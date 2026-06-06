import pytest
from fastapi.responses import StreamingCSVResponse


async def collect(response: StreamingCSVResponse) -> str:
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


async def async_rows():
    yield {"name": "Ada", "note": "contains,comma"}
    yield {"name": "Grace", "note": 'contains "quote"'}
    yield {"name": "Linus", "note": "contains\nnewline"}


@pytest.mark.anyio
async def test_streaming_csv_response_writes_headers_and_escapes_values():
    response = StreamingCSVResponse(async_rows(), headers=["name", "note"])

    body = await collect(response)

    assert body == (
        "name,note\n"
        'Ada,"contains,comma"\n'
        'Grace,"contains ""quote"""\n'
        'Linus,"contains\nnewline"\n'
    )


@pytest.mark.anyio
async def test_streaming_csv_response_supports_custom_delimiter():
    response = StreamingCSVResponse([["a", "b,c"]], delimiter=";")

    assert await collect(response) == "a;b,c\n"


def test_streaming_csv_response_sets_content_headers():
    response = StreamingCSVResponse([], filename="report.csv")

    assert response.media_type == "text/csv"
    assert response.headers["content-disposition"] == 'attachment; filename="report.csv"'


@pytest.mark.anyio
async def test_streaming_csv_response_streams_without_eager_iteration():
    consumed = []

    async def rows():
        for value in ["one", "two"]:
            consumed.append(value)
            yield [value]

    response = StreamingCSVResponse(rows())

    assert consumed == []
    assert await collect(response) == "one\ntwo\n"
    assert consumed == ["one", "two"]
