import asyncio

import pytest

from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.mark.anyio
async def test_run_concurrently_preserves_input_order() -> None:
    async def delayed(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    results = await run_concurrently(
        [
            delayed(1, 0.03),
            delayed(2, 0.01),
            delayed(3, 0.02),
        ],
        max_concurrency=3,
    )

    assert results == [1, 2, 3]


@pytest.mark.anyio
async def test_run_concurrently_limits_active_tasks() -> None:
    active = 0
    peak_active = 0

    async def worker(value: int) -> int:
        nonlocal active, peak_active
        active += 1
        peak_active = max(peak_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return value

    results = await run_concurrently(
        [worker(value) for value in range(6)],
        max_concurrency=2,
    )

    assert results == [0, 1, 2, 3, 4, 5]
    assert peak_active == 2


@pytest.mark.anyio
async def test_run_concurrently_supports_sequential_execution() -> None:
    order: list[str] = []

    async def worker(value: str) -> str:
        order.append(f"start:{value}")
        await asyncio.sleep(0)
        order.append(f"end:{value}")
        return value

    results = await run_concurrently(
        [worker("a"), worker("b"), worker("c")],
        max_concurrency=1,
    )

    assert results == ["a", "b", "c"]
    assert order == ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]


@pytest.mark.anyio
async def test_run_concurrently_collects_all_failures() -> None:
    async def fail(message: str) -> None:
        await asyncio.sleep(0)
        raise RuntimeError(message)

    async def succeed() -> str:
        await asyncio.sleep(0)
        return "ok"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [fail("first"), succeed(), fail("second")],
            max_concurrency=3,
        )

    error = exc_info.value
    assert [str(exc) for exc in error.exceptions] == ["first", "second"]
    assert error.partial_results == [None, "ok", None]


@pytest.mark.anyio
async def test_run_concurrently_timeout_cancels_pending_tasks() -> None:
    cancelled = asyncio.Event()

    async def fast() -> str:
        await asyncio.sleep(0.01)
        return "done"

    async def slow() -> str:
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return "too late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([fast(), slow()], max_concurrency=2, timeout=0.05)

    error = exc_info.value
    assert any(isinstance(exc, TimeoutError) for exc in error.exceptions)
    assert error.partial_results == ["done", None]
    assert cancelled.is_set()


@pytest.mark.anyio
async def test_run_concurrently_allows_concurrency_above_task_count() -> None:
    async def worker(value: int) -> int:
        await asyncio.sleep(0)
        return value

    results = await run_concurrently([worker(1), worker(2)], max_concurrency=10)

    assert results == [1, 2]


@pytest.mark.anyio
async def test_run_concurrently_rejects_invalid_concurrency() -> None:
    async def worker() -> str:
        return "unused"

    coroutine = worker()
    try:
        with pytest.raises(ValueError, match="max_concurrency"):
            await run_concurrently([coroutine], max_concurrency=0)
    finally:
        coroutine.close()
