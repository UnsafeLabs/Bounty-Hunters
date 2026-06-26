 ```diff
--- a/fastapi/fastapi/encoders.py
+++ b/fastapi/fastapi/encoders.py
@@ -1,5 +1,6 @@
 import dataclasses
 import datetime
+import base64
 from collections import defaultdict, deque
 from collections.abc import Callable
 from decimal import Decimal
@@ -76,7 +77,6 @@
 
 
 ENCODERS_BY_TYPE: dict[type[Any], Callable[[Any], Any]] = {
-    bytes: lambda o: o.decode(),
     Color: str,
     PyExtraColor: str,
     datetime.date: isoformat,
@@ -127,6 +127,11 @@
             The input object to convert to JSON.
             """
        ),
    ],
    include: Annotated[
        IncEx | None,
        Doc(
            """
            Pydantic's `include` parameter, passed to Pydantic models to set the
            fields to include.
            """
        ),
    ] = None,
    exclude: Annotated[
        IncEx | None,
        Doc(
            """
            Pydantic's `exclude` parameter, passed to Pydantic models to set the
            fields to exclude.
            """
        ),
    ] = None,
    by_alias: Annotated[
        bool,
        Doc(
            """
            Pydantic's `by_alias` parameter, passed to Pydantic models to define if
            the output should use the alias or the field names.
            """
        ),
    ] = True,
    exclude_unset: Annotated[
        bool,
        Doc(
            """
            Pydantic's `exclude_unset` parameter, passed to Pydantic models to
            define if it should exclude the fields that were not explicitly set.
            """
        ),
    ] = False,
    exclude_defaults: Annotated[
        bool,
        Doc(
            """
            Pydantic's `exclude_defaults` parameter, passed to Pydantic models
            to define if it should exclude the fields that have default values.
            """
        ),
    ] = False,
    exclude_none: Annotated[
        bool,
        Doc(
            """
            Pydantic's `exclude_none` parameter, passed to Pydantic models to
            define if it should exclude the fields that are equal to `None`.
            """
        ),
    ] = False,
    custom_encoder: Annotated[
        dict[Any, Callable[[Any], Any]] | None,
        Doc(
            """
            A custom dictionary of encoders, or `None` to use the default ones.
            """
        ),
    ] = None,
    sqlalchemy_safe: Annotated[
        bool,
        Doc(
            """
            Whether to check for SQLAlchemy safe encoding.
            """
        ),
    ] = True,
    bytes_encoding: Annotated[
        str,
 Doc(
            """
            Encoding to use for bytes and memoryview objects. Either "base64" or "hex".
            """
        ),
    ] = "base64",
) -> Any:
    if custom_encoder is None:
        custom_encoder = {}
    if include is not None and not isinstance(include, (set, dict)):
        include = set(include)  # type: ignore[arg-type]
    if exclude is not None and not isinstance(exclude, (set, dict)):
        exclude = set(exclude)  # type: ignore[arg-type]
    
    if isinstance(obj, bytes):
        if bytes_encoding == "hex":
            return obj.hex()
        return base64.b64encode(obj).decode("ascii")
    
    if isinstance(obj, memoryview):
        obj_bytes = obj.tobytes()
        if bytes_encoding == "hex":
            return obj_bytes.hex()
        return base64.b64encode(obj_bytes).decode("ascii")
    
    if dataclasses.is_dataclass(obj):
        obj_dict = dataclasses.asdict(obj)  # type: ignore[arg-type]
        return jsonable_encoder(
            obj_dict,
            include=include,
            exclude=exclude,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
            exclude_none=exclude_none,
            custom_encoder=custom_encoder,
            sqlalchemy_safe=sqlalchemy_safe,
            bytes_encoding=bytes_encoding,
        )
    
    if isinstance(obj, Enum):
        return obj.value
    
    if isinstance(obj, PurePath):
        return str(obj)
    
    if isinstance(obj, (str, int, float, type(None))):
        return obj
    
    if isinstance(obj, Pattern):
        return obj.pattern
    
    if isinstance(obj, dict):
        encoded_dict = {}
        allowed_keys = set(obj.keys())
        if include is not None:
            allowed_keys &= set(include)
        if exclude is not None:
            allowed_keys -= set(exclude)
        for k in allowed_keys:
            v = obj[k]
            encoded_dict[k] = jsonable_encoder(
                v,
                include=include,
                exclude=exclude,
                by_alias=by_alias,
                exclude_unset=exclude_unset,
                exclude_defaults=exclude_defaults,
                exclude_none=exclude_none,
                custom_encoder=custom_encoder,
                sqlalchemy_safe=sqlalchemy_safe,
                bytes_encoding=bytes_encoding,
            )
        return encoded_dict
    
    if isinstance(obj, (list, set, frozenset, GeneratorType, tuple, deque)):
        encoded_list = []
        for item in obj:
            encoded_list.append(
                jsonable_encoder(
                    item,
                    include=include,
                    exclude=exclude,
                    by_alias=by_alias,
                    exclude_unset=exclude_unset,
                    exclude_defaults=exclude_defaults,
                    exclude_none=exclude_none,
                    custom_encoder=custom_encoder,
                    sqlalchemy_safe=sqlalchemy_safe,
                    bytes_encoding=bytes_encoding,
                )
            )
        return encoded_list
    
    if isinstance(obj, BaseModel):
        encoders: dict[Any, Any] = {}
        if not hasattr(obj, "model_config"):
            # Pydantic v1 compatibility
            encoders = getattr(obj.__config__, "json_encoders", {})  # type: ignore[attr-defined]
        else:
            # Pydantic v2
            encoders = getattr(obj.model_config, "json_encoders", {})  # type: ignore[union-attr]
        if custom_encoder:
            custom_encoder = {**encoders, **custom_encoder}
        else:
            custom_encoder = encoders
        
        model_data: dict[str, Any] = {}
        if not hasattr(obj, "model_dump"):
            # Pydantic v1 compatibility
            model_data = obj.dict(
                include=include,
                exclude=exclude,
                by_alias=by_alias,
                exclude_unset=exclude_unset,
                exclude_defaults=exclude_defaults,
                exclude_none=exclude_none,
            )
        else:
            # Pydantic v2
            model_data = obj.model_dump(
                include=include,
                exclude=exclude,
                by_alias=by_alias,
                exclude_unset=exclude_unset,
                exclude_defaults=exclude_defaults,
                exclude_none=exclude_none,
            )
        
        return jsonable_encoder(
            model_data,
            include=include,
            exclude=exclude,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
