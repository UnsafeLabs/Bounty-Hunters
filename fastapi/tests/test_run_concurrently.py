import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_run_concurrently_preserves_input_order():
    async def work(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    results = await run_concurrently(
        [work(1, 0.03), work(2, 0.01), work(3, 0.02)],
        max_concurrency=3,
    )

    assert results == [1, 2, 3]


@pytest.mark.anyio
async def test_run_concurrently_limits_concurrency():
    active = 0
    max_seen = 0

    async def work() -> int:
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await asyncio.sleep(0.01)
        active -= 1
        return max_seen

    await run_concurrently([work() for _ in range(6)], max_concurrency=2)

    assert max_seen == 2


@pytest.mark.anyio
async def test_run_concurrently_collects_failures():
    async def fail(message: str) -> None:
        raise RuntimeError(message)

    async def succeed() -> str:
        return "ok"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [fail("first"), succeed(), fail("second")],
            max_concurrency=3,
        )

    assert [str(error) for error in exc_info.value.failures] == [
        "first",
        "second",
    ]
    assert exc_info.value.partial_results == [None, "ok", None]


@pytest.mark.anyio
async def test_run_concurrently_timeout_cancels_remaining_tasks():
    async def fast() -> str:
        return "done"

    async def slow() -> str:
        await asyncio.sleep(1)
        return "late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([fast(), slow()], max_concurrency=2, timeout=0.01)

    assert exc_info.value.partial_results == ["done", None]
    assert any(isinstance(error, TimeoutError) for error in exc_info.value.failures)


@pytest.mark.anyio
async def test_run_concurrently_max_concurrency_one_runs_sequentially():
    order: list[str] = []

    async def work(name: str) -> str:
        order.append(f"start:{name}")
        await asyncio.sleep(0)
        order.append(f"end:{name}")
        return name

    results = await run_concurrently(
        [work("a"), work("b")],
        max_concurrency=1,
    )

    assert results == ["a", "b"]
    assert order == ["start:a", "end:a", "start:b", "end:b"]
