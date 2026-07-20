"""Tests for run_concurrently (issue #803)."""

from __future__ import annotations

import asyncio
import importlib.util
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_PATH = _ROOT / "fastapi" / "concurrency.py"


def _load():
    name = "fastapi_concurrency_local"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_order_preserved_despite_completion_order():
    mod = _load()

    async def main():
        async def slow():
            await asyncio.sleep(0.05)
            return "slow"

        async def fast():
            await asyncio.sleep(0.001)
            return "fast"

        return await mod.run_concurrently([slow(), fast()], max_concurrency=2)

    assert asyncio.run(main()) == ["slow", "fast"]


def test_max_concurrency_limits_parallelism():
    mod = _load()

    async def main():
        current = 0
        peak = 0
        lock = asyncio.Lock()

        async def worker():
            nonlocal current, peak
            async with lock:
                current += 1
                peak = max(peak, current)
            await asyncio.sleep(0.03)
            async with lock:
                current -= 1
            return 1

        await mod.run_concurrently([worker() for _ in range(6)], max_concurrency=2)
        return peak

    assert asyncio.run(main()) <= 2


def test_max_concurrency_one_is_sequential():
    mod = _load()

    async def main():
        log = []

        async def w(i):
            log.append(("start", i))
            await asyncio.sleep(0.01)
            log.append(("end", i))
            return i

        out = await mod.run_concurrently([w(0), w(1), w(2)], max_concurrency=1)
        return out, log

    out, log = asyncio.run(main())
    assert out == [0, 1, 2]
    assert log == [
        ("start", 0),
        ("end", 0),
        ("start", 1),
        ("end", 1),
        ("start", 2),
        ("end", 2),
    ]


def test_error_collection():
    mod = _load()

    async def main():
        async def ok():
            return 1

        async def bad():
            raise ValueError("boom")

        try:
            await mod.run_concurrently([ok(), bad(), ok()], max_concurrency=3)
            return None
        except mod.ConcurrencyError as err:
            return err

    err = asyncio.run(main())
    assert err is not None
    assert err.exceptions[0] is None
    assert isinstance(err.exceptions[1], ValueError)
    assert err.exceptions[2] is None
    assert len(err.failures) == 1


def test_timeout_cancels_and_reports():
    mod = _load()

    async def main():
        async def quick():
            await asyncio.sleep(0.01)
            return "q"

        async def slow():
            await asyncio.sleep(2.0)
            return "s"

        t0 = time.monotonic()
        try:
            await mod.run_concurrently([quick(), slow()], max_concurrency=2, timeout=0.1)
            return None, None, 0.0
        except mod.ConcurrencyError as err:
            return err, time.monotonic() - t0

    err, elapsed = asyncio.run(main())
    assert err is not None
    assert elapsed < 1.0
    assert err.results[0] == "q"
    assert err.exceptions[1] is not None
