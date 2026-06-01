"""
UploadFile validation with size and content type checks.
"""
from starlette.datastructures import UploadFile as StarletteUploadFile
from typing import Optional, List, Set
from fastapi import HTTPException, status


class ValidatedUploadFile:
    """
    UploadFile wrapper with validation.

    Usage:
        @app.post("/upload")
        async def upload(file: ValidatedUploadFile = Depends(
            ValidatedUploadFile.validator(max_size=10*1024*1024, allowed_types=["image/png", "image/jpeg"])
        )):
            content = await file.read()
    """

    def __init__(
        self,
        file: StarletteUploadFile,
        max_size: Optional[int] = None,
        allowed_types: Optional[Set[str]] = None,
    ):
        self.file = file
        self.max_size = max_size
        self.allowed_types = allowed_types

    async def validate(self) -> None:
        """Validate file size and content type."""
        # Check content type
        if self.allowed_types and self.file.content_type not in self.allowed_types:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"File type '{self.file.content_type}' not allowed. Allowed: {self.allowed_types}",
            )

        # Check file size
        if self.max_size:
            content = await self.file.read()
            size = len(content)
            await self.file.seek(0)  # Reset position

            if size > self.max_size:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File size ({size} bytes) exceeds maximum ({self.max_size} bytes)",
                )

            if size == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Empty file upload",
                )

    @staticmethod
    def validator(
        max_size: Optional[int] = None,
        allowed_types: Optional[List[str]] = None,
    ):
        """Create a dependency for file validation."""
        allowed_set = set(allowed_types) if allowed_types else None

        async def _validate(file: StarletteUploadFile) -> ValidatedUploadFile:
            validated = ValidatedUploadFile(file, max_size, allowed_set)
            await validated.validate()
            return validated

        return _validate

    async def read(self, size: int = -1) -> bytes:
        return await self.file.read(size)

    async def seek(self, offset: int) -> None:
        await self.file.seek(offset)

    @property
    def filename(self) -> Optional[str]:
        return self.file.filename

    @property
    def content_type(self) -> Optional[str]:
        return self.file.content_type
