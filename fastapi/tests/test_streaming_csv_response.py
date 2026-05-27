import pytest
from fastapi.responses import StreamingCSVResponse


@pytest.mark.anyio
async def test_streaming_csv_response_streams_headers_and_rows():
    consumed: list[str] = []

    async def row_stream():
        consumed.append("first")
        yield {"name": "Ada", "note": "plain"}
        consumed.append("second")
        yield {"name": "Grace", "note": "has,comma"}

    response = StreamingCSVResponse(
        row_stream(), headers=["name", "note"], filename="users.csv"
    )

    assert response.media_type == "text/csv"
    assert response.headers["content-type"] == "text/csv"
    assert response.headers["content-disposition"] == 'attachment; filename="users.csv"'
    assert consumed == []

    body = "".join([chunk async for chunk in response.body_iterator])

    assert consumed == ["first", "second"]
    assert body == 'name,note\r\nAda,plain\r\nGrace,"has,comma"\r\n'


@pytest.mark.anyio
async def test_streaming_csv_response_escapes_values_and_custom_delimiter():
    async def row_stream():
        yield ["has;semicolon", 'quoted "value"', "line\nbreak"]

    response = StreamingCSVResponse(row_stream(), delimiter=";")

    body = "".join([chunk async for chunk in response.body_iterator])

    assert body == '"has;semicolon";"quoted ""value""";"line\nbreak"\r\n'
