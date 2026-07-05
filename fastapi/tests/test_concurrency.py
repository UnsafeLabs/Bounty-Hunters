import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def test_run_concurrently_limits_concurrency() -> None:
    running = 0
    max_seen = 0

    async def worker(index: int) -> int:
        nonlocal max_seen, running
        running += 1
        max_seen = max(max_seen, running)
        await asyncio.sleep(0.01)
        running -= 1
        return index

    results = await run_concurrently(
        [worker(index) for index in range(6)],
        max_concurrency=2,
    )

    assert results == [0, 1, 2, 3, 4, 5]
    assert max_seen == 2


async def test_run_concurrently_preserves_input_order() -> None:
    async def worker(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    results = await run_concurrently(
        [worker(1, 0.03), worker(2, 0.01), worker(3, 0.02)],
        max_concurrency=3,
    )

    assert results == [1, 2, 3]


async def test_run_concurrently_can_run_sequentially() -> None:
    events: list[tuple[str, int]] = []

    async def worker(index: int) -> int:
        events.append(("start", index))
        await asyncio.sleep(0)
        events.append(("end", index))
        return index

    results = await run_concurrently(
        [worker(index) for index in range(3)],
        max_concurrency=1,
    )

    assert results == [0, 1, 2]
    assert events == [
        ("start", 0),
        ("end", 0),
        ("start", 1),
        ("end", 1),
        ("start", 2),
        ("end", 2),
    ]


async def test_run_concurrently_runs_all_when_limit_exceeds_task_count() -> None:
    running = 0
    max_seen = 0

    async def worker(index: int) -> int:
        nonlocal max_seen, running
        running += 1
        max_seen = max(max_seen, running)
        await asyncio.sleep(0.01)
        running -= 1
        return index

    results = await run_concurrently(
        [worker(index) for index in range(3)],
        max_concurrency=10,
    )

    assert results == [0, 1, 2]
    assert max_seen == 3


async def test_run_concurrently_collects_all_failures() -> None:
    async def fail_with(error: Exception) -> None:
        await asyncio.sleep(0)
        raise error

    async def succeed() -> str:
        await asyncio.sleep(0)
        return "ok"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [
                fail_with(ValueError("first")),
                succeed(),
                fail_with(RuntimeError("second")),
            ],
            max_concurrency=3,
        )

    assert [type(error) for error in exc_info.value.failures] == [
        ValueError,
        RuntimeError,
    ]
    assert exc_info.value.partial_results == [None, "ok", None]


async def test_run_concurrently_timeout_cancels_pending_tasks() -> None:
    cancelled = False

    async def fast() -> str:
        return "done"

    async def slow() -> str:
        nonlocal cancelled
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            cancelled = True
            raise
        return "late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([fast(), slow()], max_concurrency=2, timeout=0.01)

    assert exc_info.value.partial_results == ["done", None]
    assert any(isinstance(error, TimeoutError) for error in exc_info.value.failures)
    assert cancelled is True
