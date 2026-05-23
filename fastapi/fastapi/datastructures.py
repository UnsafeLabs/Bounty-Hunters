from collections.abc import Callable, Mapping
from typing import (
    Annotated,
    Any,
    BinaryIO,
    TypeVar,
    cast,
)

from annotated_doc import Doc
from pydantic import GetJsonSchemaHandler
from starlette.datastructures import URL as URL  # noqa: F401
from starlette.datastructures import Address as Address  # noqa: F401
from starlette.datastructures import FormData as FormData  # noqa: F401
from starlette.datastructures import Headers as Headers  # noqa: F401
from starlette.datastructures import QueryParams as QueryParams  # noqa: F401
from starlette.datastructures import State as State  # noqa: F401
from starlette.datastructures import UploadFile as StarletteUploadFile


class UploadFile(StarletteUploadFile):
    file: Annotated[
        BinaryIO,
        Doc("The standard Python file object (non-async)."),
    ]
    filename: Annotated[str | None, Doc("The original file name.")]
    size: Annotated[int | None, Doc("The size of the file in bytes.")]
    headers: Annotated[Headers, Doc("The headers of the request.")]
    content_type: Annotated[
        str | None, Doc("The content type of the request, from the headers.")
    ]

    def __init__(
        self,
        *args: Any,
        max_size: int | None = None,
        allowed_content_types: list[str] | None = None,
        **kwargs: Any,
    ):
        super().__init__(*args, **kwargs)
        self.max_size = max_size
        self.allowed_content_types = allowed_content_types

    async def validate(self) -> dict[str, Any]:
        result: dict[str, Any] = {"is_valid": True, "file_size": self.size, "content_type": self.content_type}
        if self.max_size is not None and self.size is not None and self.size > self.max_size:
            from starlette.exceptions import HTTPException
            raise HTTPException(status_code=413, detail=f"File size {self.size} exceeds maximum {self.max_size}")
        if self.allowed_content_types is not None and self.content_type not in self.allowed_content_types:
            from starlette.exceptions import HTTPException
            raise HTTPException(status_code=415, detail=f"Content type {self.content_type} not allowed")
        return result

    async def write(self, data: Annotated[bytes, Doc("The bytes to write.")]) -> None:
        return await super().write(data)

    async def read(self, size: Annotated[int, Doc("Bytes to read.")] = -1) -> bytes:
        return await super().read(size)

    async def seek(self, offset: Annotated[int, Doc("Position to seek.")]) -> None:
        return await super().seek(offset)

    async def close(self) -> None:
        return await super().close()

    @classmethod
    def _validate(cls, __input_value: Any, _: Any) -> "UploadFile":
        if not isinstance(__input_value, StarletteUploadFile):
            raise ValueError(f"Expected UploadFile, received: {type(__input_value)}")
        return cast(UploadFile, __input_value)

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema: Mapping[str, Any], handler: GetJsonSchemaHandler) -> dict[str, Any]:
        return {"type": "string", "contentMediaType": "application/octet-stream"}

    @classmethod
    def __get_pydantic_core_schema__(cls, source: type[Any], handler: Callable[[Any], Mapping[str, Any]]) -> Mapping[str, Any]:
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
