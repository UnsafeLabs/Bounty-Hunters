from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

# Heartbeat wrapper (issue #766). Existing WebSocket re-exports unchanged.
try:
    from fastapi.websocket_heartbeat import WebSocketWithHeartbeat as WebSocketWithHeartbeat  # noqa: F401
except Exception:  # pragma: no cover
    pass

