from fastapi.responses import StreamingCSVResponse


async def _rows():
    yield ["Alice", "30", "Engineer"]
    yield ["Bob", "25", "Designer"]
    yield ["Charlie", "35", "Product, Manager & Co."]
    yield ['Diana', '28', 'Developer "Extraordinaire"']
    yield ["Eve", "32", "Multi\nline\nvalue"]


def test_csv_with_headers():
    async def _run():
        resp = StreamingCSVResponse(
            rows=_rows(),
            headers=["Name", "Age", "Title"],
            filename="people.csv",
        )
        chunks = [c async for c in resp.body_iterator]
        body = "".join(chunks)
        assert body.startswith("Name,Age,Title\n")
        assert '"Product, Manager & Co."' in body
        assert '"Developer ""Extraordinaire"""' in body
        assert body.count('"') > 0
    import asyncio
    asyncio.run(_run())


def test_csv_without_headers():
    async def _run():
        resp = StreamingCSVResponse(rows=_rows())
        chunks = [c async for c in resp.body_iterator]
        body = "".join(chunks)
        assert not body.startswith("Name")
        assert "Alice" in body
    import asyncio
    asyncio.run(_run())


def test_custom_delimiter():
    async def _run():
        resp = StreamingCSVResponse(
            rows=_rows(),
            headers=["Name", "Age", "Title"],
            delimiter=";",
        )
        chunks = [c async for c in resp.body_iterator]
        body = "".join(chunks)
        assert body.startswith("Name;Age;Title\n")
        assert "Alice;30;Engineer" in body
    import asyncio
    asyncio.run(_run())


def test_content_type_header():
    async def _run():
        resp = StreamingCSVResponse(rows=_rows())
        assert resp.headers["Content-Type"] == "text/csv; charset=utf-8"
        assert resp.headers["Content-Disposition"] == 'attachment; filename="export.csv"'
    import asyncio
    asyncio.run(_run())


def test_escaping():
    async def _run():
        resp = StreamingCSVResponse(
            rows=_rows(),
            headers=["Name", "Age", "Title"],
        )
        chunks = [c async for c in resp.body_iterator]
        body = "".join(chunks)
        assert '"Product, Manager & Co."' in body
        assert '"Developer ""Extraordinaire"""' in body
        assert '"Multi\nline\nvalue"' in body
    import asyncio
    asyncio.run(_run())
