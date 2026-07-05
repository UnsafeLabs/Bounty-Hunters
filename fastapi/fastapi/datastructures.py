from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import (
    Annotated,
    Any,
    BinaryIO,
    TypeVar,
    cast,
    Optional,
)

from annotated_doc import Doc
from fastapi import HTTPException
from fastapi import status
from pydantic import GetJsonSchemaHandler
from starlette.datastructures import URL as URL  # noqa: F401
from starlette.datastructures import Address as Address  # noqa: F401
from starlette.datastructures import FormData as FormData  # noqa: F401
from starlette.datastructures import Headers as Headers  # noqa: F401
from starlette.datastructures import QueryParams as QueryParams  # noqa: F401
from starlette.datastructures import State as State  # noqa: F401
from starlette.datastructures import UploadFile as StarletteUploadFile


@dataclass
class ValidationResult:
    """Result of file validation."""
    is_valid: bool
    file_size: int
    content_type: Optional[str]


class UploadFile(StarletteUploadFile):
    """
    A file uploaded in a request.

    Define it as a *path operation function* (or dependency) parameter.

    If you are using a regular `def` function, you can use the `upload_file.file`
    attribute to access the raw standard Python file (blocking, not async), useful and
    needed for non-async code.

    Read more about it in the
    [FastAPI docs for Request Files](https://fastapi.tiangolo.com/tutorial/request-files/).

    ## Example

    ```python
    from typing import Annotated

    from fastapi import FastAPI, File, UploadFile

    app = FastAPI()


    @app.post("/files/")
    async def create_file(file: Annotated[bytes, File()]):
        return {"file_size": len(file)}


    @app.post("/uploadfile/")
    async def create_upload_file(file: UploadFile):
        return {"filename": file.filename}
        str | None, Doc("The content type of the request, from the headers.")
    ]

    def __init__(
        self,
        file: BinaryIO,
        *,
        size: int | None = None,
        filename: str | None = None,
        headers: "Headers | None" = None,
        max_size: int | None = None,
        allowed_content_types: list[str] | None = None,
    ) -> None:
        """
        Initialize an UploadFile.

        Args:
            file: The file object.
            size: The size of the file in bytes.
            filename: The original file name.
            headers: The headers of the request.
            max_size: Maximum allowed file size in bytes. If exceeded, raises 413.
            allowed_content_types: List of allowed MIME types. If file type is not in list, raises 415.
        """
        super().__init__(file, size=size, filename=filename, headers=headers)
        self.max_size = max_size
        self.allowed_content_types = allowed_content_types

    async def write(
        self,
        data: Annotated[
    ]
    filename: Annotated[str | None, Doc("The original file name.")]
    size: Annotated[int | None, Doc("The size of the file in bytes.")]
    headers: Annotated[Headers, Doc("The headers of the request.")]
    content_type: Annotated[
        str | None, Doc("The content type of the request, from the headers.")
    ]

    async def write(
        self,
        data: Annotated[
            bytes,
            Doc(
                """
                The bytes to write to the file.
                """
            ),
        ],
    ) -> None:
        """
        Write some bytes to the file.

        You normally wouldn't use this from a file you read in a request.

        To be awaitable, compatible with async, this is run in threadpool.
        """
        return await super().write(data)

    async def read(
        self,
        size: Annotated[
            int,
            Doc(
                """
                The number of bytes to read from the file.
                """
            ),
        ] = -1,
    ) -> bytes:
        """
        Read some bytes from the file.

        To be awaitable, compatible with async, this is run in threadpool.
        """
        return await super().read(size)

    async def seek(
        self,
        offset: Annotated[
        """
        return await super().close()

    async def validate(self) -> ValidationResult:
        """
        Validate the uploaded file against size and content type constraints.

        Returns:
            ValidationResult with is_valid, file_size, and content_type fields.

        Raises:
            HTTPException 413 if file exceeds max_size.
            HTTPException 415 if content type is not allowed.
        """
        # Determine file size
        file_size = self.size
        if file_size is None:
            # If size is not set, try to determine it by seeking to end
            current_pos = await self.tell()
            await self.seek(0, 2)  # Seek to end
            file_size = await self.tell()
            await self.seek(current_pos)  # Restore position

        # Determine content type
        content_type = self.content_type

        # Check size constraint
        if self.max_size is not None and file_size is not None and file_size > self.max_size:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File size {file_size} exceeds maximum allowed size {self.max_size}",
            )

        # Check content type constraint
        if self.allowed_content_types is not None and content_type is not None:
            if content_type not in self.allowed_content_types:
                raise HTTPException(
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    detail=f"Content type '{content_type}' is not allowed. Allowed types: {self.allowed_content_types}",
                )

        return ValidationResult(
            is_valid=True, file_size=file_size or 0, content_type=content_type
        )

    @classmethod
    def _validate(cls, __input_value: Any, _: Any) -> "UploadFile":
        if not isinstance(__input_value, StarletteUploadFile):
        ],
    ) -> None:
        """
        Move to a position in the file.

        Any next read or write will be done from that position.

        To be awaitable, compatible with async, this is run in threadpool.
        """
        return await super().seek(offset)

    async def close(self) -> None:
        """
        Close the file.

        To be awaitable, compatible with async, this is run in threadpool.
        """
        return await super().close()

    @classmethod
    def _validate(cls, __input_value: Any, _: Any) -> "UploadFile":
        if not isinstance(__input_value, StarletteUploadFile):
            raise ValueError(f"Expected UploadFile, received: {type(__input_value)}")
        return cast(UploadFile, __input_value)

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: Mapping[str, Any], handler: GetJsonSchemaHandler
    ) -> dict[str, Any]:
        return {"type": "string", "contentMediaType": "application/octet-stream"}

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source: type[Any], handler: Callable[[Any], Mapping[str, Any]]
    ) -> Mapping[str, Any]:
        from ._compat.v2 import with_info_plain_validator_function

        return with_info_plain_validator_function(cls._validate)


class DefaultPlaceholder:
    """
    You shouldn't use this class directly.

    It's used internally to recognize when a default value has been overwritten, even
    if the overridden default value was truthy.
    """

    def __init__(self, value: Any):
        self.value = value

    def __bool__(self) -> bool:
        return bool(self.value)

    def __eq__(self, o: object) -> bool:
        return isinstance(o, DefaultPlaceholder) and o.value == self.value


DefaultType = TypeVar("DefaultType")


def Default(value: DefaultType) -> DefaultType:
    """
    You shouldn't use this function directly.

    It's used internally to recognize when a default value has been overwritten, even
    if the overridden default value was truthy.
    """
    return DefaultPlaceholder(value)  # type: ignore


# Sentinel for "parameter not provided" in Param/FieldInfo.
# Typed as None to satisfy ty
_Unset = Default(None)
