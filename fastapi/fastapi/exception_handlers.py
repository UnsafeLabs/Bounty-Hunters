"""Exception handlers for FastAPI."""

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION


_SENSITIVE_FIELD_NAMES = {"password", "secret", "token", "api_key"}


def _redact_sensitive_fields(obj: object, depth: int = 0) -> object:
    """Recursively redact sensitive fields in nested structures.

    Fields named ``password``, ``secret``, ``token``, or ``api_key`` are
    replaced with ``"***REDACTED***"`` in the echoed body.
    """
    if depth > 20:  # safety limit for recursion
        return obj
    if isinstance(obj, dict):
        redacted: dict[str, object] = {}
        for key, value in obj.items():
            if isinstance(key, str) and key.lower() in _SENSITIVE_FIELD_NAMES:
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = _redact_sensitive_fields(value, depth + 1)
        return redacted
    if isinstance(obj, list):
        return [_redact_sensitive_fields(item, depth + 1) for item in obj]
    return obj


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
    detail: dict[str, object] = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }

    # Include the request body in debug mode, with sensitive fields redacted
    if request.app.debug:
        try:
            body = await request.body()
            if body:
                import json as _json

                try:
                    parsed_body: object = _json.loads(body)
                except (_json.JSONDecodeError, ValueError):
                    parsed_body = body.decode("utf-8", errors="replace")
                detail["body"] = _redact_sensitive_fields(parsed_body)
        except Exception:
            detail["body"] = "<unavailable>"

    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(detail),
    )


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )