from typing import Any

from fastapi import UploadFile


ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/zip",
    "application/x-gzip",
}

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


async def validate_upload_file(
    file: UploadFile,
    max_size: int = MAX_FILE_SIZE,
    allowed_types: set[str] | None = None,
) -> UploadFile:
    """Validate file size and content type for an UploadFile."""
    allowed = allowed_types or ALLOWED_CONTENT_TYPES

    if file.content_type and file.content_type not in allowed:
        raise ValueError(
            f"Content type '{file.content_type}' not allowed. "
            f"Allowed types: {', '.join(sorted(allowed))}"
        )

    content = await file.read()
    file_size = len(content)

    if file_size > max_size:
        raise ValueError(
            f"File size {file_size} bytes exceeds maximum {max_size} bytes"
        )

    await file.seek(0)
    return file


def validate_file_size(file: UploadFile, max_size: int = MAX_FILE_SIZE) -> None:
    """Synchronous file size validation (checks size attribute if available)."""
    size = getattr(file, "size", None)
    if size is not None and size > max_size:
        raise ValueError(
            f"File size {size} bytes exceeds maximum {max_size} bytes"
        )
