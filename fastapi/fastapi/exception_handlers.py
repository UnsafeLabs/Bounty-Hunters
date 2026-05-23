from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION

SENSITIVE_VALIDATION_BODY_FIELDS = {"password", "secret", "token", "api_key"}


def _redact_sensitive_validation_body(value):
    if isinstance(value, dict):
        return {
            key: (
                "***REDACTED***"
                if isinstance(key, str)
                and key.lower() in SENSITIVE_VALIDATION_BODY_FIELDS
                else _redact_sensitive_validation_body(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_sensitive_validation_body(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_sensitive_validation_body(item) for item in value)
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
    content = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }
    if getattr(request.app, "debug", False) and getattr(exc, "body", None) is not None:
        content["body"] = jsonable_encoder(
            _redact_sensitive_validation_body(exc.body)
        )
    return JSONResponse(
        status_code=422,
        content=content,
    )


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
