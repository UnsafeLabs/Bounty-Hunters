"""
Enhanced validation error handler with request body inclusion.
Improves debugging by showing which field caused the validation error.
"""
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import json


async def enhanced_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    Enhanced validation error handler that includes:
    - Request body in error response
    - Field-level error details
    - Error location (body, query, path, header)
    - Human-readable error messages
    """
    errors = []
    for error in exc.errors():
        error_detail = {
            "type": error.get("type", "unknown"),
            "loc": list(error.get("loc", [])),
            "msg": error.get("msg", ""),
            "input": error.get("input"),
        }
        
        # Add context based on location
        loc = error.get("loc", [])
        if loc:
            location_type = loc[0] if loc else "unknown"
            field_name = ".".join(str(l) for l in loc[1:]) if len(loc) > 1 else "root"
            error_detail["location"] = location_type
            error_detail["field"] = field_name
        
        errors.append(error_detail)

    # Try to include request body for debugging
    request_body = None
    try:
        body = await request.body()
        if body:
            try:
                request_body = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                request_body = body.decode("utf-8", errors="replace")[:1000]
    except Exception:
        request_body = "<unable to read>"

    return JSONResponse(
        status_code=422,
        content={
            "detail": errors,
            "body": request_body,
            "path": str(request.url.path),
            "method": request.method,
        },
    )


async def enhanced_http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Enhanced HTTP exception handler with request context."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "path": str(request.url.path),
            "method": request.method,
        },
    )
