import anyio
import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.mark.anyio
async def test_run_concurrently_preserves_order_and_limits_active_tasks() -> None:
    active = 0
    max_seen = 0

    async def worker(value: int, delay: float) -> int:
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await anyio.sleep(delay)
        active -= 1
        return value

    results = await run_concurrently(
        [
            worker(1, 0.03),
            worker(2, 0.01),
            worker(3, 0.02),
            worker(4, 0.01),
        ],
        max_concurrency=2,
    )

    assert results == [1, 2, 3, 4]
    assert max_seen == 2


@pytest.mark.anyio
async def test_run_concurrently_rejects_invalid_max_concurrency() -> None:
    with pytest.raises(ValueError, match="max_concurrency"):
        await run_concurrently([], max_concurrency=0)


@pytest.mark.anyio
async def test_run_concurrently_aggregates_task_failures() -> None:
    async def ok() -> str:
        return "ok"

    async def fail_with(error: Exception) -> str:
        raise error

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [
                ok(),
                fail_with(ValueError("bad value")),
                fail_with(RuntimeError("bad runtime")),
            ],
            max_concurrency=3,
        )

    assert exc_info.value.partial_results[0] == "ok"
    assert {type(error) for error in exc_info.value.errors} == {
        ValueError,
        RuntimeError,
    }


@pytest.mark.anyio
async def test_run_concurrently_cancels_remaining_tasks_on_timeout() -> None:
    cancelled = anyio.Event()

    async def slow() -> str:
        try:
            await anyio.sleep(10)
        finally:
            cancelled.set()
        return "done"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([slow()], max_concurrency=1, timeout=0.01)

    assert any(isinstance(error, TimeoutError) for error in exc_info.value.errors)
    assert cancelled.is_set()
