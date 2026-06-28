import asyncio

import pytest
from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect, WebSocketWithHeartbeat
from starlette.websockets import WebSocket as StarletteWebSocket


class FakeWebSocket:
    def __init__(self, messages: list[dict]):
        self.messages: asyncio.Queue[dict] = asyncio.Queue()
        for message in messages:
            self.messages.put_nowait(message)
        self.accepted = False
        self.sent_text: list[str] = []
        self.closed_code: int | None = None
        self.closed_reason: str | None = None

    async def accept(self, *args, **kwargs) -> None:
        self.accepted = True

    async def receive(self) -> dict:
        return await self.messages.get()

    async def send_text(self, data: str) -> None:
        self.sent_text.append(data)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closed_code = code
        self.closed_reason = reason


def run(coro):
    return asyncio.run(coro)


def test_existing_websocket_export_is_unchanged():
    assert WebSocket is StarletteWebSocket


def test_default_and_custom_heartbeat_values():
    default = WebSocketWithHeartbeat(FakeWebSocket([]))
    custom = WebSocketWithHeartbeat(
        FakeWebSocket([]),
        ping_interval=5,
        pong_timeout=2,
        ping_message="custom-ping",
        pong_message="custom-pong",
    )

    assert default.ping_interval == 30.0
    assert default.pong_timeout == 10.0
    assert custom.ping_interval == 5
    assert custom.pong_timeout == 2
    assert custom.ping_message == "custom-ping"
    assert custom.pong_message == "custom-pong"


def test_heartbeat_sends_ping_and_accepts_pong():
    async def scenario():
        fake = FakeWebSocket([{"type": "websocket.receive", "text": "pong"}])
        websocket = WebSocketWithHeartbeat(
            fake,
            ping_interval=0.01,
            pong_timeout=0.1,
        )

        websocket.start_heartbeat()
        await asyncio.sleep(0.03)
        await websocket.stop_heartbeat()

        assert fake.sent_text
        assert fake.sent_text[0] == "ping"
        assert fake.closed_code is None

    run(scenario())


def test_heartbeat_closes_when_pong_timeout_expires():
    async def scenario():
        disconnects: list[tuple[int, float]] = []
        fake = FakeWebSocket([])
        websocket = WebSocketWithHeartbeat(
            fake,
            ping_interval=0.01,
            pong_timeout=0.01,
            on_disconnect=lambda code, duration: disconnects.append((code, duration)),
        )

        websocket.start_heartbeat()
        await asyncio.sleep(0.05)

        assert fake.sent_text
        assert fake.sent_text[0] == "ping"
        assert fake.closed_code == 1001
        assert disconnects
        assert disconnects[0][0] == 1001
        assert disconnects[0][1] >= 0

    run(scenario())


def test_non_pong_messages_are_preserved_for_application_receive():
    async def scenario():
        fake = FakeWebSocket(
            [
                {"type": "websocket.receive", "text": "client-message"},
                {"type": "websocket.receive", "text": "pong"},
            ]
        )
        websocket = WebSocketWithHeartbeat(
            fake,
            ping_interval=0.01,
            pong_timeout=0.1,
        )

        websocket.start_heartbeat()
        await asyncio.sleep(0.03)
        await websocket.stop_heartbeat()
        message = await websocket.receive_text()

        assert message == "client-message"
        assert websocket.message_count == 1

    run(scenario())


def test_receive_disconnect_invokes_callback_and_raises():
    async def scenario():
        disconnects: list[tuple[int, float]] = []
        fake = FakeWebSocket([{"type": "websocket.disconnect", "code": 1000}])
        websocket = WebSocketWithHeartbeat(
            fake,
            on_disconnect=lambda code, duration: disconnects.append((code, duration)),
        )

        with pytest.raises(WebSocketDisconnect):
            await websocket.receive_text()

        assert disconnects
        assert disconnects[0][0] == 1000

    run(scenario())


def test_async_disconnect_callback_is_supported():
    async def scenario():
        disconnects: list[int] = []

        async def on_disconnect(code: int, duration: float) -> None:
            disconnects.append(code)

        fake = FakeWebSocket([])
        websocket = WebSocketWithHeartbeat(fake, on_disconnect=on_disconnect)

        await websocket.close(code=1001)

        assert disconnects == [1001]
        assert fake.closed_code == 1001

    run(scenario())


def test_accept_can_start_heartbeat():
    async def scenario():
        fake = FakeWebSocket([{"type": "websocket.receive", "text": "pong"}])
        websocket = WebSocketWithHeartbeat(
            fake,
            ping_interval=0.01,
            pong_timeout=0.1,
        )

        await websocket.accept()
        await asyncio.sleep(0.03)
        await websocket.stop_heartbeat()

        assert fake.accepted is True
        assert fake.sent_text
        assert fake.sent_text[0] == "ping"

    run(scenario())


def test_invalid_heartbeat_configuration_raises():
    with pytest.raises(ValueError, match="ping_interval"):
        WebSocketWithHeartbeat(FakeWebSocket([]), ping_interval=0)
    with pytest.raises(ValueError, match="pong_timeout"):
        WebSocketWithHeartbeat(FakeWebSocket([]), pong_timeout=0)
