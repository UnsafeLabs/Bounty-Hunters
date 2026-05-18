"""Fix: Add file size and content type validation to UploadFile (#761)"""

import magic
from fastapi import UploadFile, HTTPException
from dataclasses import dataclass
from typing import Sequence

@dataclass
class UploadLimits:
    max_file_size: int = 50 * 1024 * 1024  # 50MB
    allowed_content_types: Sequence[str] = (
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "application/pdf", "text/plain", "text/csv",
        "application/json", "application/zip",
    )
    allowed_extensions: Sequence[str] = (
        ".jpg", ".jpeg", ".png", ".gif", ".webp",
        ".pdf", ".txt", ".csv", ".json", ".zip",
    )

async def validate_upload(file: UploadFile, limits: UploadLimits | None = None) -> UploadFile:
    config = limits or UploadLimits()

    # Check extension
    if config.allowed_extensions:
        ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in config.allowed_extensions:
            raise HTTPException(400, f"File extension {ext} not allowed")

    # Read content for validation
    content = await file.read()

    # Check size
    if len(content) > config.max_file_size:
        raise HTTPException(413, f"File too large: {len(content)} bytes (max {config.max_file_size})")

    # Check content type via magic bytes
    mime = magic.from_buffer(content[:2048], mime=True)
    if config.allowed_content_types and mime not in config.allowed_content_types:
        raise HTTPException(400, f"Content type {mime} not allowed")

    # Reset file position
    await file.seek(0)
    return file
