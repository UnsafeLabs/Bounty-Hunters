from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION

# Field names redacted when echoing validation request bodies in debug mode.
_SENSITIVE_FIELD_NAMES = frozenset({"password", "secret", "token", "api_key"})
_REDACTED = "***REDACTED***"


def redact_sensitive_fields(value: Any) -> Any:
    """Recursively redact sensitive keys from nested request body payloads."""
    if isinstance(value, dict):
        redacted: dict[Any, Any] = {}
        for key, item in value.items():
            if isinstance(key, str) and key.lower() in _SENSITIVE_FIELD_NAMES:
                redacted[key] = _REDACTED
            else:
                redacted[key] = redact_sensitive_fields(item)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive_fields(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_sensitive_fields(item) for item in value)
    return value


async def http_exception_handler(request: Request, exc: HTTPException) -> Response:
    headers = getattr(exc, "headers", None)
    if not is_body_allowed_for_status_code(exc.status_code):
        return Response(status_code=exc.status_code, headers=headers)
    return JSONResponse(
        {"detail": exc.detail}, status_code=exc.status_code, headers=headers
    )


async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    content: dict[str, Any] = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }
    # Echo redacted body only when the app is in debug mode.
    if getattr(request.app, "debug", False):
        content["body"] = jsonable_encoder(redact_sensitive_fields(exc.body))
    return JSONResponse(status_code=422, content=content)


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
