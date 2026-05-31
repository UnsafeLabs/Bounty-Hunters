import asyncio

import pytest

from fastapi.task_runner import TaskResult, TaskRunner


@pytest.mark.anyio
async def test_run_single():
    runner = TaskRunner(max_concurrent=5)

    async def double(x: int) -> int:
        return x * 2

    result = await runner.run(double(3))
    assert result.result == 6
    assert result.exception is None
    assert result.timed_out is False


@pytest.mark.anyio
async def test_run_captures_exception():
    runner = TaskRunner(max_concurrent=5)

    async def fail() -> None:
        raise ValueError("boom")

    result = await runner.run(fail())
    assert result.result is None
    assert isinstance(result.exception, ValueError)
    assert result.timed_out is False


@pytest.mark.anyio
async def test_run_timeout():
    runner = TaskRunner(max_concurrent=5, timeout=0.05)

    async def slow() -> None:
        await asyncio.sleep(10)

    result = await runner.run(slow())
    assert result.timed_out is True
    assert result.result is None
    assert result.exception is None


@pytest.mark.anyio
async def test_run_per_task_timeout_overrides_default():
    runner = TaskRunner(max_concurrent=5, timeout=10)

    async def slow() -> None:
        await asyncio.sleep(10)

    result = await runner.run(slow(), timeout=0.05)
    assert result.timed_out is True


@pytest.mark.anyio
async def test_run_per_task_timeout_none_uses_default():
    runner = TaskRunner(max_concurrent=5, timeout=0.05)

    async def slow() -> None:
        await asyncio.sleep(10)

    result = await runner.run(slow(), timeout=None)
    assert result.timed_out is True


@pytest.mark.anyio
async def test_run_many_concurrency_limit():
    max_concurrent = 3
    runner = TaskRunner(max_concurrent=max_concurrent)
    active = 0
    peak = 0

    async def track() -> int:
        nonlocal active, peak
        async with runner._semaphore:
            active += 1
            if active > peak:
                peak = active
            await asyncio.sleep(0.05)
            active -= 1
            return active

    coros = [track() for _ in range(10)]
    results = await runner.run_many(coros)
    assert len(results) == 10
    assert all(r.exception is None and not r.timed_out for r in results)
    assert peak <= max_concurrent


@pytest.mark.anyio
async def test_run_many_mixed_results():
    runner = TaskRunner(max_concurrent=5)

    async def ok() -> str:
        return "done"

    async def fail() -> None:
        raise RuntimeError("err")

    async def slow() -> None:
        await asyncio.sleep(10)

    results = await runner.run_many(
        [ok(), fail(), slow()],
        timeout=0.05,
    )
    assert results[0].result == "done"
    assert isinstance(results[1].exception, RuntimeError)
    assert results[2].timed_out is True


@pytest.mark.anyio
async def test_run_many_empty():
    runner = TaskRunner()
    results = await runner.run_many([])
    assert results == []


def test_invalid_max_concurrent():
    with pytest.raises(ValueError, match="max_concurrent"):
        TaskRunner(max_concurrent=0)


def test_invalid_timeout():
    with pytest.raises(ValueError, match="timeout"):
        TaskRunner(timeout=0)
