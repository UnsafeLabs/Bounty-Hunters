"""UploadFile size and content-type validation (issue #761)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence


@dataclass
class ValidationResult:
    is_valid: bool
    file_size: int
    content_type: Optional[str]
    error: Optional[str] = None
    status_code: Optional[int] = None


class UploadValidationError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def validate_upload(
    *,
    file_size: int,
    content_type: Optional[str],
    max_size: Optional[int] = None,
    allowed_content_types: Optional[Sequence[str]] = None,
) -> ValidationResult:
    if max_size is not None and file_size > max_size:
        return ValidationResult(
            is_valid=False,
            file_size=file_size,
            content_type=content_type,
            error="Payload Too Large",
            status_code=413,
        )
    if allowed_content_types is not None:
        allowed = set(allowed_content_types)
        if content_type not in allowed:
            return ValidationResult(
                is_valid=False,
                file_size=file_size,
                content_type=content_type,
                error="Unsupported Media Type",
                status_code=415,
            )
    return ValidationResult(
        is_valid=True, file_size=file_size, content_type=content_type
    )


def enforce_upload_constraints(
    *,
    file_size: int,
    content_type: Optional[str],
    max_size: Optional[int] = None,
    allowed_content_types: Optional[Sequence[str]] = None,
) -> ValidationResult:
    result = validate_upload(
        file_size=file_size,
        content_type=content_type,
        max_size=max_size,
        allowed_content_types=allowed_content_types,
    )
    if not result.is_valid:
        raise UploadValidationError(result.status_code or 400, result.error or "invalid")
    return result
