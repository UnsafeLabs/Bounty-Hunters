import asyncio
from collections import deque
from contextvars import ContextVar
from types import SimpleNamespace
from typing import Any, cast

import anyio
import pytest
from fastapi import FastAPI, WebSocket, WebSocketWithHeartbeat
from fastapi import websockets as websockets_module
from fastapi.responses import PlainTextResponse
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect, WebSocketState
from starlette.types import Message


@pytest.fixture(params=["asyncio", "trio"])
def anyio_backend(request: pytest.FixtureRequest) -> str:
    return cast(str, request.param)


class FakeMessageQueue:
    def __init__(self) -> None:
        self._messages: deque[dict[str, Any]] = deque()
        self._available: anyio.Event | None = None

    async def put(self, message: dict[str, Any]) -> None:
        self._messages.append(message)
        if self._available is not None:
            self._available.set()

    async def get(self) -> dict[str, Any]:
        while not self._messages:
            self._available = anyio.Event()
            await self._available.wait()
        return self._messages.popleft()


class FakeWebSocket:
    def __init__(self) -> None:
        self.application_state = WebSocketState.CONNECTING
        self.messages = FakeMessageQueue()
        self.sent_bytes: list[bytes] = []
        self.sent_byte_times: list[float] = []
        self.sent_text: list[str] = []
        self.close_calls: list[tuple[int, str | None]] = []
        self.close_error: Exception | None = None
        self.send_error: Exception | None = None

    async def accept(
        self,
        subprotocol: str | None = None,
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> None:
        self.application_state = WebSocketState.CONNECTED

    async def receive(self) -> dict[str, Any]:
        return await self.messages.get()

    async def send_bytes(self, data: bytes) -> None:
        self.sent_bytes.append(data)

    async def send(self, message: dict[str, Any]) -> None:
        if self.send_error is not None:
            raise self.send_error
        if message["type"] == "websocket.accept":
            self.application_state = WebSocketState.CONNECTED
        if "bytes" in message:
            self.sent_bytes.append(message["bytes"])
            self.sent_byte_times.append(anyio.current_time())
        if "text" in message:
            self.sent_text.append(message["text"])

    async def close(self, code: int, reason: str | None = None) -> None:
        self.application_state = WebSocketState.DISCONNECTED
        self.close_calls.append((code, reason))
        if self.close_error is not None:
            raise self.close_error

    async def send_denial_response(self, response: PlainTextResponse) -> None:
        self.application_state = WebSocketState.DISCONNECTED


def make_heartbeat(**kwargs: Any) -> tuple[FakeWebSocket, WebSocketWithHeartbeat]:
    websocket = FakeWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), **kwargs)
    return websocket, heartbeat


def test_websocket_export_remains_unchanged() -> None:
    from starlette.websockets import WebSocket as StarletteWebSocket

    assert WebSocket is StarletteWebSocket


def test_plain_websocket_still_works() -> None:
    app = FastAPI()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_text(await websocket.receive_text())
        await websocket.close()

    with TestClient(app).websocket_connect("/ws") as websocket:
        websocket.send_text("hello")
        assert websocket.receive_text() == "hello"


def test_heartbeat_defaults_and_overrides() -> None:
    _, heartbeat = make_heartbeat()
    assert heartbeat.ping_interval == 30.0
    assert heartbeat.pong_timeout == 10.0

    _, heartbeat = make_heartbeat(ping_interval=5.0, pong_timeout=2.0)
    assert heartbeat.ping_interval == 5.0
    assert heartbeat.pong_timeout == 2.0


@pytest.mark.parametrize("name", ["ping_interval", "pong_timeout"])
@pytest.mark.parametrize("value", [0, -1, float("nan"), float("inf")])
def test_heartbeat_intervals_must_be_positive(name: str, value: float) -> None:
    with pytest.raises(ValueError, match=f"{name} must be greater than 0"):
        make_heartbeat(**{name: value})


@pytest.mark.anyio
async def test_heartbeat_sends_ping_at_configured_interval_and_accepts_pong() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=0.03, pong_timeout=0.05)
    started_at = anyio.current_time()
    await heartbeat.accept()

    await anyio.sleep(0.01)
    assert websocket.sent_bytes == []
    with anyio.fail_after(0.2):
        while not websocket.sent_bytes:
            await anyio.sleep(0)
    assert websocket.sent_bytes == [b"ping"]
    assert websocket.sent_byte_times[0] - started_at >= 0.02

    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    await websocket.messages.put({"type": "websocket.receive", "text": "payload"})
    assert await heartbeat.receive_text() == "payload"
    assert heartbeat.message_count == 1

    with anyio.fail_after(0.2):
        while len(websocket.sent_bytes) < 2:
            await anyio.sleep(0)
    assert websocket.sent_byte_times[1] - websocket.sent_byte_times[0] >= 0.02
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    assert websocket.close_calls == []
    await heartbeat.close()


def test_heartbeat_messages_work_through_asgi() -> None:
    app = FastAPI()
    counts: list[int] = []

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        heartbeat = WebSocketWithHeartbeat(
            websocket, ping_interval=0.01, pong_timeout=0.2
        )
        await heartbeat.accept()
        message = await heartbeat.receive_text()
        counts.append(heartbeat.message_count)
        await heartbeat.send_text(message)
        await heartbeat.close()

    with TestClient(app).websocket_connect("/ws") as websocket:
        assert websocket.receive_bytes() == b"ping"
        websocket.send_bytes(b"pong")
        websocket.send_text("hello")
        assert websocket.receive_text() == "hello"

    assert counts == [1]


@pytest.mark.anyio
async def test_pong_timeout_closes_with_1001_and_invokes_async_callback() -> None:
    disconnected: list[tuple[int, float]] = []

    async def on_disconnect(code: int, duration: float) -> None:
        await anyio.sleep(0)
        disconnected.append((code, duration))

    websocket, heartbeat = make_heartbeat(
        ping_interval=0.01,
        pong_timeout=0.01,
        on_disconnect=on_disconnect,
    )
    await heartbeat.accept()
    await anyio.sleep(0.04)

    assert websocket.sent_bytes == [b"ping"]
    assert websocket.close_calls == [(1001, "Pong timeout")]
    assert len(disconnected) == 1
    assert disconnected[0][0] == 1001
    assert disconnected[0][1] > 0

    duration = heartbeat.connection_duration
    await anyio.sleep(0.01)
    assert heartbeat.connection_duration == duration


@pytest.mark.anyio
async def test_remote_disconnect_invokes_sync_callback_once() -> None:
    disconnected: list[tuple[int, float]] = []
    websocket, heartbeat = make_heartbeat(
        ping_interval=1,
        on_disconnect=lambda code, duration: disconnected.append((code, duration)),
    )
    await heartbeat.accept()
    await websocket.messages.put(
        {"type": "websocket.disconnect", "code": 1006, "reason": "lost"}
    )

    with pytest.raises(WebSocketDisconnect) as exc_info:
        await heartbeat.receive_text()

    assert exc_info.value.code == 1006
    assert len(disconnected) == 1
    assert disconnected[0][0] == 1006
    assert disconnected[0][1] >= 0
    await heartbeat.close()
    assert len(disconnected) == 1


@pytest.mark.anyio
async def test_remote_disconnect_waits_for_async_callback() -> None:
    callback_started = anyio.Event()
    callback_waiting = anyio.Event()
    release_callback = anyio.Event()
    receive_finished = anyio.Event()

    async def on_disconnect(code: int, duration: float) -> None:
        callback_started.set()
        callback_waiting.set()
        await release_callback.wait()

    websocket, heartbeat = make_heartbeat(ping_interval=1, on_disconnect=on_disconnect)
    await heartbeat.accept()

    async def receive() -> None:
        with pytest.raises(WebSocketDisconnect):
            await heartbeat.receive_text()
        receive_finished.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(receive)
        await websocket.messages.put({"type": "websocket.disconnect", "code": 1006})
        await callback_waiting.wait()
        assert not receive_finished.is_set()
        release_callback.set()

    assert receive_finished.is_set()


def test_trio_background_task_supports_spawn_without_context_argument(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spawned: list[Any] = []

    def spawn_system_task(coroutine: Any) -> None:
        spawned.append(coroutine)

    trio = SimpleNamespace(
        lowlevel=SimpleNamespace(spawn_system_task=spawn_system_task)
    )
    monkeypatch.setattr(websockets_module, "_is_trio_backend", lambda: True)
    monkeypatch.setattr(websockets_module, "import_module", lambda name: trio)

    async def run() -> None:
        pass

    task = websockets_module._BackgroundTask(run)
    task.start()

    assert spawned == [task._run]


@pytest.mark.anyio
async def test_message_count_tracks_all_non_heartbeat_receive_methods() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.receive", "text": "one"})
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"two"})
    await websocket.messages.put({"type": "websocket.receive", "text": '{"value": 3}'})

    assert await heartbeat.receive_text() == "one"
    assert await heartbeat.receive_bytes() == b"two"
    assert await heartbeat.receive_json() == {"value": 3}
    assert heartbeat.message_count == 3
    await heartbeat.close()


@pytest.mark.anyio
async def test_connection_duration_starts_when_accepted() -> None:
    _, heartbeat = make_heartbeat(ping_interval=1)
    await anyio.sleep(0.01)
    await heartbeat.accept()
    started_duration = heartbeat.connection_duration
    await anyio.sleep(0.01)

    assert started_duration < 0.005
    assert heartbeat.connection_duration >= 0.01
    await heartbeat.close()


@pytest.mark.anyio
async def test_pong_is_consumed_without_application_receive() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=0.01, pong_timeout=0.04)
    await heartbeat.accept()

    with anyio.fail_after(0.1):
        while not websocket.sent_bytes:
            await anyio.sleep(0)
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    await anyio.sleep(0.02)

    assert websocket.close_calls == []
    await heartbeat.close()


@pytest.mark.anyio
async def test_pong_payload_is_delivered_when_no_response_is_pending() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})

    assert await heartbeat.receive_bytes() == b"pong"
    assert heartbeat.message_count == 1
    await heartbeat.close()


@pytest.mark.anyio
async def test_pong_timeout_unblocks_pending_receive() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=0.01, pong_timeout=0.01)
    await heartbeat.accept()

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with anyio.fail_after(0.1):
            await heartbeat.receive_text()

    assert exc_info.value.code == 1001
    assert websocket.close_calls == [(1001, "Pong timeout")]


@pytest.mark.anyio
async def test_remote_disconnect_is_detected_without_application_receive() -> None:
    disconnected = anyio.Event()
    codes: list[int] = []

    def on_disconnect(code: int, duration: float) -> None:
        codes.append(code)
        disconnected.set()

    websocket, heartbeat = make_heartbeat(ping_interval=1, on_disconnect=on_disconnect)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.disconnect", "code": 1006})

    with anyio.fail_after(0.1):
        await disconnected.wait()
    assert codes == [1006]


@pytest.mark.anyio
async def test_raw_accept_and_close_use_heartbeat_lifecycle() -> None:
    disconnected: list[int] = []
    websocket, heartbeat = make_heartbeat(
        ping_interval=0.01,
        pong_timeout=1,
        on_disconnect=lambda code, duration: disconnected.append(code),
    )

    await heartbeat.send({"type": "websocket.accept"})
    with anyio.fail_after(0.1):
        while not websocket.sent_bytes:
            await anyio.sleep(0)
    await heartbeat.send(
        {"type": "websocket.close", "code": 1008, "reason": "Policy violation"}
    )

    assert websocket.close_calls == [(1008, "Policy violation")]
    assert disconnected == [1008]
    assert heartbeat._receive_task is not None and heartbeat._receive_task.done
    assert heartbeat._heartbeat_task is not None and heartbeat._heartbeat_task.done


@pytest.mark.anyio
async def test_callback_failure_does_not_replace_disconnect(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def on_disconnect(code: int, duration: float) -> None:
        raise ValueError("callback failed")

    websocket, heartbeat = make_heartbeat(ping_interval=1, on_disconnect=on_disconnect)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.disconnect", "code": 1008})

    with pytest.raises(WebSocketDisconnect) as exc_info:
        await heartbeat.receive_text()

    assert exc_info.value.code == 1008
    assert "WebSocket on_disconnect callback failed" in caplog.text


@pytest.mark.anyio
async def test_send_is_rejected_once_close_starts() -> None:
    close_started = anyio.Event()
    release_close = anyio.Event()

    class SlowCloseWebSocket(FakeWebSocket):
        async def close(self, code: int, reason: str | None = None) -> None:
            close_started.set()
            await release_close.wait()
            await super().close(code, reason)

    websocket = SlowCloseWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), ping_interval=1)
    await heartbeat.accept()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(heartbeat.close)
        await close_started.wait()
        with pytest.raises(RuntimeError, match="once a close message"):
            await heartbeat.send_text("too late")
        release_close.set()

    assert websocket.sent_text == []


@pytest.mark.anyio
async def test_close_cancels_blocked_application_send() -> None:
    send_started = anyio.Event()
    send_errors: list[str] = []

    class BlockingSendWebSocket(FakeWebSocket):
        async def send(self, message: dict[str, Any]) -> None:
            if message.get("text") == "blocked":
                send_started.set()
                await anyio.sleep_forever()
            await super().send(message)

    websocket = BlockingSendWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), ping_interval=1)
    await heartbeat.accept()

    async def send() -> None:
        try:
            await heartbeat.send_text("blocked")
        except RuntimeError as exc:
            send_errors.append(str(exc))

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(send)
        await send_started.wait()
        with anyio.fail_after(0.1):
            await heartbeat.close(code=1001)

    assert send_errors == ["WebSocket send was interrupted by connection close."]
    assert websocket.close_calls == [(1001, None)]


@pytest.mark.anyio
async def test_close_failure_reaches_all_callers_and_pending_receive() -> None:
    close_started = anyio.Event()
    release_close = anyio.Event()
    errors: list[str] = []
    disconnect_codes: list[int] = []

    class FailingCloseWebSocket(FakeWebSocket):
        async def close(self, code: int, reason: str | None = None) -> None:
            close_started.set()
            await release_close.wait()
            raise RuntimeError("close failed")

    websocket = FailingCloseWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        cast(WebSocket, websocket),
        ping_interval=1,
        on_disconnect=lambda code, duration: disconnect_codes.append(code),
    )
    await heartbeat.accept()

    async def close() -> None:
        try:
            await heartbeat.close(code=1001)
        except RuntimeError as exc:
            errors.append(str(exc))

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(close)
        await close_started.wait()
        task_group.start_soon(close)
        release_close.set()

    assert errors == ["close failed", "close failed"]
    message = await heartbeat.receive()
    assert message["type"] == "websocket.disconnect"
    assert message["code"] == 1006
    assert disconnect_codes == [1006]


@pytest.mark.anyio
async def test_context_manager_stops_background_tasks() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)

    async with heartbeat:
        await heartbeat.accept()

    assert websocket.close_calls == [(1000, None)]
    assert heartbeat._receive_task is not None and heartbeat._receive_task.done
    assert heartbeat._heartbeat_task is not None and heartbeat._heartbeat_task.done


@pytest.mark.anyio
async def test_stop_heartbeat_keeps_receive_monitor_running() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.accept()

    await heartbeat.stop_heartbeat()
    assert heartbeat._receive_task is not None and not heartbeat._receive_task.done

    await websocket.messages.put({"type": "websocket.receive", "text": "after stop"})
    assert await heartbeat.receive_text() == "after stop"
    assert heartbeat.message_count == 1
    await heartbeat.close()


@pytest.mark.anyio
async def test_typed_receive_before_accept_preserves_state() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)

    with pytest.raises(RuntimeError, match='Need to call "accept" first'):
        await heartbeat.receive_text()

    assert websocket.application_state == WebSocketState.CONNECTING
    assert heartbeat.connection_duration == 0


@pytest.mark.anyio
async def test_raw_receive_before_accept_returns_connect_message() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await websocket.messages.put({"type": "websocket.connect"})

    message = await heartbeat.receive()

    assert message["type"] == "websocket.connect"
    assert heartbeat.connection_duration == 0
    assert heartbeat.message_count == 0


@pytest.mark.anyio
async def test_close_unblocks_raw_receive_before_accept() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    receive_finished = anyio.Event()

    async def receive() -> None:
        message = await heartbeat.receive()
        assert message["type"] == "websocket.disconnect"
        assert message["code"] == 1001
        receive_finished.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(receive)
        await anyio.sleep(0)
        await heartbeat.close(code=1001)
        with anyio.fail_after(0.1):
            await receive_finished.wait()

    assert websocket.close_calls == [(1001, None)]


@pytest.mark.anyio
async def test_cancelled_accept_closes_connected_transport() -> None:
    accept_started = anyio.Event()
    teardown_finished = anyio.Event()
    cancel_scope_holder: list[anyio.CancelScope] = []

    class InterruptedAcceptWebSocket(FakeWebSocket):
        async def accept(
            self,
            subprotocol: str | None = None,
            headers: list[tuple[bytes, bytes]] | None = None,
        ) -> None:
            self.application_state = WebSocketState.CONNECTED
            accept_started.set()
            await anyio.sleep_forever()

    websocket = InterruptedAcceptWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        cast(WebSocket, websocket),
        ping_interval=1,
        on_disconnect=lambda code, duration: teardown_finished.set(),
    )

    async def accept() -> None:
        with anyio.CancelScope() as cancel_scope:
            cancel_scope_holder.append(cancel_scope)
            await heartbeat.accept()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(accept)
        await accept_started.wait()
        cancel_scope_holder[0].cancel()

    with anyio.fail_after(0.1):
        await teardown_finished.wait()
    assert websocket.close_calls == [(1001, "WebSocket accept interrupted")]
    assert heartbeat.connection_duration >= 0


@pytest.mark.anyio
async def test_close_does_not_overlap_blocked_accept() -> None:
    accept_started = anyio.Event()
    accept_running = False
    accept_errors: list[str] = []

    class BlockingAcceptWebSocket(FakeWebSocket):
        async def accept(
            self,
            subprotocol: str | None = None,
            headers: list[tuple[bytes, bytes]] | None = None,
        ) -> None:
            nonlocal accept_running
            self.application_state = WebSocketState.CONNECTED
            accept_running = True
            accept_started.set()
            try:
                await anyio.sleep_forever()
            finally:
                accept_running = False

        async def close(self, code: int, reason: str | None = None) -> None:
            assert not accept_running
            await super().close(code, reason)

    websocket = BlockingAcceptWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), ping_interval=1)

    async def accept() -> None:
        try:
            await heartbeat.accept()
        except RuntimeError as exc:
            accept_errors.append(str(exc))

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(accept)
        await accept_started.wait()
        with anyio.fail_after(0.1):
            await heartbeat.close(code=1001)

    assert accept_errors == ["WebSocket accept was interrupted by connection close."]
    assert websocket.close_calls == [(1001, None)]


@pytest.mark.anyio
async def test_accept_disconnect_invokes_callback() -> None:
    disconnected: list[int] = []

    class DisconnectingAcceptWebSocket(FakeWebSocket):
        async def accept(
            self,
            subprotocol: str | None = None,
            headers: list[tuple[bytes, bytes]] | None = None,
        ) -> None:
            self.application_state = WebSocketState.DISCONNECTED
            raise WebSocketDisconnect(1006)

    websocket = DisconnectingAcceptWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        cast(WebSocket, websocket),
        ping_interval=1,
        on_disconnect=lambda code, duration: disconnected.append(code),
    )

    with pytest.raises(WebSocketDisconnect) as exc_info:
        await heartbeat.accept()

    assert exc_info.value.code == 1006
    assert disconnected == [1006]
    assert heartbeat.connection_duration == 0


@pytest.mark.anyio
async def test_duplicate_accept_does_not_close_an_established_connection() -> None:
    class SingleAcceptWebSocket(FakeWebSocket):
        async def accept(
            self,
            subprotocol: str | None = None,
            headers: list[tuple[bytes, bytes]] | None = None,
        ) -> None:
            if self.application_state == WebSocketState.CONNECTED:
                raise RuntimeError("already accepted")
            await super().accept(subprotocol, headers)

    websocket = SingleAcceptWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), ping_interval=1)
    await heartbeat.accept()

    with pytest.raises(RuntimeError):
        await heartbeat.accept()

    assert websocket.application_state == WebSocketState.CONNECTED
    assert websocket.close_calls == []
    await heartbeat.close()


@pytest.mark.anyio
async def test_duplicate_raw_accept_does_not_close_an_established_connection() -> None:
    class SingleAcceptWebSocket(FakeWebSocket):
        async def send(self, message: dict[str, Any]) -> None:
            if (
                message["type"] == "websocket.accept"
                and self.application_state == WebSocketState.CONNECTED
            ):
                raise RuntimeError("already accepted")
            await super().send(message)

    websocket = SingleAcceptWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), ping_interval=1)
    await heartbeat.send({"type": "websocket.accept"})

    with pytest.raises(RuntimeError):
        await heartbeat.send({"type": "websocket.accept"})

    assert websocket.application_state == WebSocketState.CONNECTED
    assert websocket.close_calls == []
    await heartbeat.close()


@pytest.mark.anyio
async def test_stale_pong_before_ping_send_does_not_acknowledge_ping() -> None:
    send_started = anyio.Event()
    release_send = anyio.Event()

    class BlockingWebSocket(FakeWebSocket):
        async def send(self, message: dict[str, Any]) -> None:
            if message.get("text") == "blocked":
                send_started.set()
                await release_send.wait()
            await super().send(message)

    websocket = BlockingWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        cast(WebSocket, websocket), ping_interval=0.01, pong_timeout=0.01
    )
    await heartbeat.accept()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(heartbeat.send_text, "blocked")
        await send_started.wait()
        await anyio.sleep(0.02)
        await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
        release_send.set()

    with anyio.fail_after(0.1):
        while not websocket.close_calls:
            await anyio.sleep(0)

    assert websocket.sent_bytes == [b"ping"]
    assert websocket.close_calls == [(1001, "Pong timeout")]


@pytest.mark.anyio
async def test_pong_during_ping_transport_send_is_accepted() -> None:
    ping_transmitted = anyio.Event()
    release_send = anyio.Event()

    class SlowPingWebSocket(FakeWebSocket):
        async def send(self, message: dict[str, Any]) -> None:
            await super().send(message)
            if message.get("bytes") == b"ping":
                ping_transmitted.set()
                await release_send.wait()

    websocket = SlowPingWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        cast(WebSocket, websocket), ping_interval=0.01, pong_timeout=0.05
    )
    await heartbeat.accept()

    with anyio.fail_after(0.1):
        await ping_transmitted.wait()
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    release_send.set()
    await anyio.sleep(0.02)

    assert websocket.close_calls == []
    await heartbeat.close()


@pytest.mark.anyio
async def test_background_tasks_preserve_context_variables() -> None:
    request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
    callback_values: list[str | None] = []
    callback_called = anyio.Event()
    request_id.set("request-123")

    def on_disconnect(code: int, duration: float) -> None:
        callback_values.append(request_id.get())
        callback_called.set()

    websocket, heartbeat = make_heartbeat(ping_interval=1, on_disconnect=on_disconnect)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.disconnect", "code": 1000})

    with anyio.fail_after(0.1):
        await callback_called.wait()
    assert callback_values == ["request-123"]


@pytest.mark.anyio
async def test_context_manager_allows_websocket_denial_response() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)

    async with heartbeat:
        await heartbeat.send_denial_response(
            PlainTextResponse("denied", status_code=403)
        )

    assert websocket.application_state == WebSocketState.DISCONNECTED
    assert websocket.close_calls == []
    assert heartbeat.connection_duration == 0


@pytest.mark.anyio
async def test_message_backlog_is_bounded() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.accept()

    for index in range(33):
        await websocket.messages.put({"type": "websocket.receive", "text": str(index)})

    with anyio.fail_after(0.2):
        while not websocket.close_calls:
            await anyio.sleep(0)

    app_queued = [
        message
        for message in heartbeat._messages
        if isinstance(message, dict) and message["type"] == "websocket.receive"
    ]
    assert heartbeat.message_count == 32
    assert len(app_queued) == 32
    assert websocket.close_calls == [(1013, "Heartbeat message backlog exceeded")]
    assert len(heartbeat._messages) == 33
    last_message = heartbeat._messages[-1]
    assert not isinstance(last_message, Exception)
    assert last_message["type"] == "websocket.disconnect"


@pytest.mark.anyio
async def test_heartbeat_send_disconnect_preserves_transport_code() -> None:
    disconnected: list[int] = []
    websocket, heartbeat = make_heartbeat(
        ping_interval=0.01,
        on_disconnect=lambda code, duration: disconnected.append(code),
    )
    websocket.send_error = WebSocketDisconnect(1006)
    await heartbeat.accept()

    with anyio.fail_after(0.1):
        while not disconnected:
            await anyio.sleep(0)

    assert disconnected == [1006]
    assert websocket.close_calls == []


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_cancelling_close_caller_does_not_cancel_teardown() -> None:
    close_started = anyio.Event()
    release_close = anyio.Event()
    disconnected = anyio.Event()

    class SlowCloseWebSocket(FakeWebSocket):
        async def close(self, code: int, reason: str | None = None) -> None:
            close_started.set()
            await release_close.wait()
            await super().close(code, reason)

    websocket = SlowCloseWebSocket()
    heartbeat = WebSocketWithHeartbeat(
        cast(WebSocket, websocket),
        ping_interval=1,
        on_disconnect=lambda code, duration: disconnected.set(),
    )
    await heartbeat.accept()
    close_task = asyncio.create_task(heartbeat.close(code=1001))

    await close_started.wait()
    close_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await close_task

    release_close.set()
    with anyio.fail_after(0.1):
        await disconnected.wait()

    assert websocket.close_calls == [(1001, None)]
    assert heartbeat._receive_task is not None and heartbeat._receive_task.done
    assert heartbeat._heartbeat_task is not None and heartbeat._heartbeat_task.done


@pytest.mark.anyio
async def test_raw_accept_preserves_websocket_connect_message() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1, pong_timeout=5)

    await heartbeat.send({"type": "websocket.accept"})
    await websocket.messages.put({"type": "websocket.connect"})
    await websocket.messages.put({"type": "websocket.receive", "text": "hello"})

    with anyio.fail_after(1):
        assert await heartbeat.receive() == {"type": "websocket.connect"}
        assert await heartbeat.receive_text() == "hello"
    assert heartbeat.message_count == 1
    await heartbeat.close()


@pytest.mark.anyio
async def test_connect_event_does_not_reduce_application_backlog_limit() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.send({"type": "websocket.accept"})
    await websocket.messages.put({"type": "websocket.connect"})
    for index in range(32):
        await websocket.messages.put({"type": "websocket.receive", "text": str(index)})

    with anyio.fail_after(0.1):
        while heartbeat.message_count < 32:
            await anyio.sleep(0)

    assert websocket.close_calls == []
    assert await heartbeat.receive() == {"type": "websocket.connect"}
    assert heartbeat._pending_message_count == 32
    await heartbeat.close()


@pytest.mark.anyio
async def test_restarting_heartbeat_serializes_transport_receives() -> None:
    receive_started = anyio.Event()
    concurrent_receives = 0
    max_concurrent_receives = 0

    class CheckedReceiveWebSocket(FakeWebSocket):
        async def receive(self) -> dict[str, Any]:
            nonlocal concurrent_receives, max_concurrent_receives
            concurrent_receives += 1
            max_concurrent_receives = max(max_concurrent_receives, concurrent_receives)
            receive_started.set()
            try:
                return await super().receive()
            finally:
                concurrent_receives -= 1

    websocket = CheckedReceiveWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), ping_interval=1)
    await heartbeat.accept()
    await receive_started.wait()
    await heartbeat.stop_heartbeat()

    heartbeat.start_heartbeat()
    await anyio.sleep(0)
    assert max_concurrent_receives == 1
    await websocket.messages.put({"type": "websocket.receive", "text": "message"})
    assert await heartbeat.receive_text() == "message"

    await heartbeat.close()
    assert max_concurrent_receives == 1


@pytest.mark.anyio
async def test_close_unblocks_receive_after_heartbeat_is_stopped() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.accept()
    await heartbeat.stop_heartbeat()

    receive_finished = anyio.Event()

    async def receive() -> None:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            await heartbeat.receive_text()
        assert exc_info.value.code == 1001
        receive_finished.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(receive)
        await anyio.sleep(0)
        await heartbeat.close(code=1001)
        with anyio.fail_after(0.1):
            await receive_finished.wait()

    assert websocket.close_calls == [(1001, None)]


@pytest.mark.anyio
async def test_restarted_heartbeat_consumes_pong_before_pending_receive() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=0.01, pong_timeout=0.03)
    await heartbeat.accept()
    await heartbeat.stop_heartbeat()

    received: list[str] = []

    async def receive() -> None:
        received.append(await heartbeat.receive_text())

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(receive)
        await anyio.sleep(0)
        heartbeat.start_heartbeat()
        with anyio.fail_after(0.1):
            while not websocket.sent_bytes:
                await anyio.sleep(0)
        await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
        await websocket.messages.put({"type": "websocket.receive", "text": "message"})

    assert received == ["message"]
    assert websocket.close_calls == []
    await heartbeat.close()


@pytest.mark.anyio
async def test_start_during_stop_restarts_heartbeat_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=0.01, pong_timeout=0.05)
    await heartbeat.accept()
    old_task = heartbeat._heartbeat_task
    assert old_task is not None
    stop_started = anyio.Event()
    release_stop = anyio.Event()
    stop_scope: list[anyio.CancelScope] = []
    original_stop = old_task.stop

    async def delayed_stop() -> None:
        stop_started.set()
        await release_stop.wait()
        await original_stop()

    monkeypatch.setattr(old_task, "stop", delayed_stop)

    async def stop() -> None:
        with anyio.CancelScope() as cancel_scope:
            stop_scope.append(cancel_scope)
            await heartbeat.stop_heartbeat()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(stop)
        await stop_started.wait()
        heartbeat.start_heartbeat()
        stop_scope[0].cancel()
        release_stop.set()

    with anyio.fail_after(0.1):
        while True:
            current_task = heartbeat._heartbeat_task
            if current_task is not old_task and current_task is not None:
                if not current_task.done:
                    break
            await anyio.sleep(0)
    with anyio.fail_after(0.1):
        while not websocket.sent_bytes:
            await anyio.sleep(0)
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    await heartbeat.close()


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_asyncio_cancellation_during_stop_preserves_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=0.01, pong_timeout=0.05)
    await heartbeat.accept()
    old_task = heartbeat._heartbeat_task
    assert old_task is not None
    stop_started = anyio.Event()
    release_stop = anyio.Event()
    original_stop = old_task.stop

    async def delayed_stop() -> None:
        stop_started.set()
        await release_stop.wait()
        await original_stop()

    monkeypatch.setattr(old_task, "stop", delayed_stop)
    stop_task = asyncio.create_task(heartbeat.stop_heartbeat())
    await stop_started.wait()
    heartbeat.start_heartbeat()
    stop_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await stop_task
    release_stop.set()

    with anyio.fail_after(0.1):
        while True:
            current_task = heartbeat._heartbeat_task
            if current_task is not old_task and current_task is not None:
                if not current_task.done:
                    break
            await anyio.sleep(0)
    with anyio.fail_after(0.1):
        while not websocket.sent_bytes:
            await anyio.sleep(0)
    await websocket.messages.put({"type": "websocket.receive", "bytes": b"pong"})
    await heartbeat.close()


@pytest.mark.anyio
async def test_denial_response_is_serialized_with_close() -> None:
    denial_started = anyio.Event()
    release_denial = anyio.Event()
    close_finished = anyio.Event()

    class BlockingDenialWebSocket(FakeWebSocket):
        async def send_denial_response(self, response: PlainTextResponse) -> None:
            denial_started.set()
            await release_denial.wait()
            await super().send_denial_response(response)

    websocket = BlockingDenialWebSocket()
    heartbeat = WebSocketWithHeartbeat(cast(WebSocket, websocket), ping_interval=1)

    async def deny() -> None:
        with pytest.raises(RuntimeError, match="interrupted by connection close"):
            await heartbeat.send_denial_response(PlainTextResponse("denied"))

    async def close() -> None:
        await heartbeat.close(code=1001)
        close_finished.set()

    async with anyio.create_task_group() as task_group:
        task_group.start_soon(deny)
        await denial_started.wait()
        task_group.start_soon(close)
        await anyio.sleep(0)
        assert websocket.close_calls == []
        release_denial.set()

    assert close_finished.is_set()
    assert websocket.close_calls == [(1001, None)]


@pytest.mark.anyio
async def test_on_disconnect_callback_can_receive_queued_disconnect() -> None:
    received: list[Message] = []
    heartbeat_holder: list[WebSocketWithHeartbeat] = []

    async def on_disconnect(code: int, duration: float) -> None:
        with anyio.fail_after(0.5):
            received.append(await heartbeat_holder[0].receive())

    websocket, heartbeat = make_heartbeat(ping_interval=1, on_disconnect=on_disconnect)
    heartbeat_holder.append(heartbeat)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.disconnect", "code": 1006})

    with anyio.fail_after(1):
        while not received:
            await anyio.sleep(0)

    assert received[0]["type"] == "websocket.disconnect"
    assert received[0]["code"] == 1006
    with pytest.raises(RuntimeError, match="once a disconnect message"):
        await heartbeat.receive_text()


@pytest.mark.anyio
async def test_disconnect_callback_child_can_receive_and_close() -> None:
    callback_finished = anyio.Event()
    received_codes: list[int] = []
    heartbeat_holder: list[WebSocketWithHeartbeat] = []

    async def on_disconnect(code: int, duration: float) -> None:
        async def child() -> None:
            message = await heartbeat_holder[0].receive()
            received_codes.append(int(message["code"]))
            await heartbeat_holder[0].close()

        async with anyio.create_task_group() as task_group:
            task_group.start_soon(child)
        callback_finished.set()

    websocket, heartbeat = make_heartbeat(ping_interval=1, on_disconnect=on_disconnect)
    heartbeat_holder.append(heartbeat)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.disconnect", "code": 1006})

    with anyio.fail_after(0.1):
        await callback_finished.wait()
    assert received_codes == [1006]


@pytest.mark.anyio
async def test_backlog_overflow_does_not_count_undelivered_message() -> None:
    websocket, heartbeat = make_heartbeat(ping_interval=1)
    await heartbeat.accept()

    for index in range(40):
        await websocket.messages.put({"type": "websocket.receive", "text": str(index)})

    with anyio.fail_after(0.5):
        while not websocket.close_calls:
            await anyio.sleep(0)

    delivered = [
        message
        for message in heartbeat._messages
        if isinstance(message, dict) and message["type"] == "websocket.receive"
    ]
    assert websocket.close_calls == [(1013, "Heartbeat message backlog exceeded")]
    assert heartbeat.message_count == len(delivered) == 32


@pytest.mark.anyio
async def test_on_disconnect_exception_still_queues_disconnect() -> None:
    class Boom(BaseException):
        pass

    heartbeat_holder: list[WebSocketWithHeartbeat] = []

    async def on_disconnect(code: int, duration: float) -> None:
        # Deliver the queued disconnect from inside the callback so a failure
        # after notification cannot lose the disconnect message.
        received = await heartbeat_holder[0].receive()
        assert received["type"] == "websocket.disconnect"
        raise Boom("callback crashed")

    websocket, heartbeat = make_heartbeat(ping_interval=1, on_disconnect=on_disconnect)
    heartbeat_holder.append(heartbeat)
    await heartbeat.accept()
    await websocket.messages.put({"type": "websocket.disconnect", "code": 1006})

    with anyio.fail_after(1):
        while heartbeat._teardown_task is None or not heartbeat._teardown_task.done:
            await anyio.sleep(0)

    assert heartbeat._disconnect_queued
    assert heartbeat._teardown_done is not None and heartbeat._teardown_done.is_set()
    with pytest.raises(RuntimeError, match="once a disconnect message"):
        await heartbeat.receive_text()
