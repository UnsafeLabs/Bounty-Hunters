from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION
from starlette.applications import Starlette
import os


# Sensitive field names to redact from request body
SENSITIVE_FIELDS = {'password', 'secret', 'token', 'api_key'}


def _redact_sensitive_fields(body: dict) -> dict:
    """Recursively redact sensitive fields from a nested dictionary."""
    if not isinstance(body, dict):
        return body

    redacted = {}
    for key, value in body.items():
        if key.lower() in SENSITIVE_FIELDS:
            redacted[key] = '***REDACTED***'
        elif isinstance(value, dict):
            redacted[key] = _redact_sensitive_fields(value)
        elif isinstance(value, list):
            redacted[key] = [
                _redact_sensitive_fields(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            redacted[key] = value

    return redacted


def _is_debug_mode(app: Starlette | None = None) -> bool:
    """Check if the application is running in debug mode."""
    if app and getattr(app, 'debug', False):
        return True
    return os.environ.get('APP_DEBUG', '').lower() in ('true', '1', 'yes')


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
    """Enhanced validation error handler with request context and body redaction.

    Includes:
    - Request path and HTTP method for debugging
    - Validation errors from exc.errors()
    - In debug mode: echoed request body with sensitive fields redacted
    """
    content: dict = {
        "detail": jsonable_encoder(exc.errors()),
        "request": {
            "path": str(request.url.path),
            "method": request.method,
        },
    }

    # Add body in debug mode with sensitive fields redacted
    if _is_debug_mode(request.app):
        try:
            body = await request.json()
            content["body"] = _redact_sensitive_fields(body)
        except Exception:
            # If body is not JSON, try to get raw body
            try:
                raw_body = await request.body()
                if raw_body:
                    content["body"] = _redact_sensitive_fields(
                        {"raw": raw_body.decode('utf-8', errors='replace')}
                    )
            except Exception:
                pass

    return JSONResponse(status_code=422, content=content)


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
