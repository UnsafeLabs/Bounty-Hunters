import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


async def _noop() -> str:
    return "ok"


async def _slow(delay: float, value: str) -> str:
    await asyncio.sleep(delay)
    return value


async def _fail(msg: str) -> str:
    raise ValueError(msg)


@pytest.mark.anyio
async def test_basic_execution():
    results = await run_concurrently([_noop(), _noop()])
    assert results == ["ok", "ok"]


@pytest.mark.anyio
async def test_maintains_order():
    coros = [_slow(0.05, "first"), _slow(0.01, "second")]
    results = await run_concurrently(coros)
    assert results == ["first", "second"]


@pytest.mark.anyio
async def test_max_concurrency_one():
    start = asyncio.get_event_loop().time()
    coros = [_slow(0.1, "a"), _slow(0.1, "b")]
    await run_concurrently(coros, max_concurrency=1)
    elapsed = asyncio.get_event_loop().time() - start
    assert elapsed >= 0.2


@pytest.mark.anyio
async def test_max_concurrency_greater_than_count():
    coros = [_slow(0.02, "a"), _slow(0.02, "b")]
    results = await run_concurrently(coros, max_concurrency=10)
    assert results == ["a", "b"]


@pytest.mark.anyio
async def test_concurrency_error_with_exceptions():
    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([_fail("bad"), _noop()])
    assert len(exc_info.value.exceptions) == 1
    assert isinstance(exc_info.value.exceptions[0], ValueError)


@pytest.mark.anyio
async def test_concurrency_error_all_failures():
    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([_fail("e1"), _fail("e2")])
    assert len(exc_info.value.exceptions) == 2


@pytest.mark.anyio
async def test_timeout_cancels_remaining():
    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([_slow(0.01, "fast"), _slow(10, "slow")], timeout=0.05)
    assert len(exc_info.value.exceptions) == 1
    assert isinstance(exc_info.value.exceptions[0], TimeoutError)
