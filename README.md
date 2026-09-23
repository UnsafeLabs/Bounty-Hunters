import copy
import http.client
import inspect
import warnings
from collections.abc import Sequence
from typing import Any, Literal, cast

from fastapi import routing
from fastapi._compat import (
    ModelField,
    get_definitions,
    get_flat_models_from_fields,
    get_model_name_map,
    get_schema_from_model_field,
    lenient_issubclass,
)
from fastapi.datastructures import DefaultPlaceholder, _Unset
from fastapi.dependencies.models import Dependant
from fastapi.dependencies.utils import (
    _get_flat_fields_from_params,
    get_flat_dependant,
    get_flat_params,
    get_validation_alias,
)
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import FastAPIDeprecationWarning
from fastapi.openapi.constants import METHODS_WITH_BODY, REF_PREFIX
from fastapi.openapi.models import OpenAPI
from fastapi.params import Body, ParamTypes
from fastapi.responses import Response
from fastapi.sse import _SSE_EVENT_SCHEMA
from fastapi.types import ModelNameMap
from fastapi.utils import (
    deep_dict_update,
    generate_operation_id_for_path,
    is_body_allowed_for_status_code,
)
from pydantic import BaseModel
from starlette.responses import JSONResponse
from starlette.routing import BaseRoute

validation_error_definition = {
    "title": "ValidationError",
    "type": "object",
    "properties": {
        "loc": {
            "title": "Location",
            "type": "array",
            "items": {"anyOf": [{"type": "string"}, {"type": "integer"}]},
        },
        "msg": {"title": "Message", "type": "string"},
        "type": {"title": "Error Type", "type": "string"},
        "input": {"title": "Input"},
        "ctx": {"title": "Context", "type": "object"},
    },
    "required": ["loc", "msg", "type"],
}

validation_error_response_definition = {
    "title": "HTTPValidationError",
    "type": "object",
    "properties": {
        "detail": {
            "title": "Detail",
            "type": "array",
            "items": {"$ref": REF_PREFIX + "ValidationError"},
        }
    },
}

status_code_ranges: dict[str, str] = {
    "1XX": "Information",
    "2XX": "Success",
    "3XX": "Redirection",
    "4XX": "Client Error",
    "5XX": "Server Error",
    "DEFAULT": "Default Response",
}

def get_openapi(
    *,
    title: str,
    version: str,
    openapi_version: str = "3.1.0",
    summary: str | None = None,
    description: str | None = None,
    routes: Sequence[BaseRoute],
    tags: list[dict[str, Any]] | None = None,
    servers: list[dict[str, Any]] | None = None,
    contact: dict[str, Any] | None = None,
    license_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    info: dict[str, Any] = {"title": title, "version": version}
    if summary:
        info["summary"] = summary
    if description:
        info["description"] = description
    if contact:
        info["contact"] = contact
    if license_info:
        info["license"] = license_info
    openapi_schema: dict[str, Any] = {
        "openapi": openapi_version,
        "info": info,
        "paths": {},
    }
    if servers:
        openapi_schema["servers"] = servers
    if tags:
        openapi_schema["tags"] = tags
    # ... (rest of implementation)
    return openapi_schema

def get_openapi_security_definitions(
    flat_dependant: Dependant,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    security_definitions = {}
    # Use a dict to merge scopes for same security scheme
    operation_security_dict: dict[str, list[str]] = {}
    for security_dependency in flat_dependant._security_dependencies:
        security_definition = jsonable_encoder(
            security_dependency._security_scheme.model,
            by_alias=True,
            exclude_none=True,
        )
        security_name = security_dependency._security_scheme.scheme_name
        security_definitions[security_name] = security_definition
        # Merge scopes for the same security scheme
        if security_name not in operation_security_dict:
            operation_security_dict[security_name] = []
        for scope in security_dependency.oauth_scopes or []:
            if scope not in operation_security_dict[security_name]:
                operation_security_dict[security_name].append(scope)
    operation_security = [
        {name: scopes} for name, scopes in operation_security_dict.items()
    ]
    return security_definitions, operation_security


def _get_openapi_operation_parameters(
    *,
    dependant: Dependant,
    model_name_map: ModelNameMap,
    field_mapping: dict[
        tuple[ModelField, Literal["validation", "serialization"]], dict[str, Any]
    ],
    separate_input_output_schemas: bool = True,
) -> list[dict[str, Any]]:
    parameters = []
    flat_dependant = get_flat_dependant(dependant, skip_repeats=True)
    path_params = _get_flat_fields_from_params(flat_dependant.path_params)
    query_params = _get_flat_fields_from_params(flat_dependant.query_params)
    header_params = _get_flat_fields_from_params(flat_dependant.header_params)
    cookie_params = _get_flat_fields_from_params(flat_dependant.cookie_params)
    parameter_groups = [
        (ParamTypes.path, path_params),
        (ParamTypes.query, query_params),
        (ParamTypes.header, header_params),
        (ParamTypes.cookie, cookie_params),
    ]
    default_convert_underscores = True
    if len(flat_dependant.header_params) == 1:
        first_field = flat_dependant.header_params[0]
        if lenient_issubclass(first_field.field_info.annotation, BaseModel):
            default_convert_underscores = getattr(
                first_field.field_info, "convert_underscores", True
            )
    for param_type, param_group in parameter_groups:
        for param in param_group:
            field_info = param.field_info
            # field_info = cast(Param, field_info)
            if not getattr(field_info, "include_in_schema", True):
                continue
            param_schema = get_schema_from_model_field(
                field=param,
                model_name_map=model_name_map,
                field_mapping=field_mapping,
                separate_input_output_schemas=separate_input_output_schemas,
            )
            name = get_validation_alias(param)
            convert_underscores = getattr(
                param.field_info,
                "convert_underscores",
                default_convert_underscores,
            )
            if (
                param_type == ParamTypes.header
                and name == param.name
                and convert_underscores
            ):
                name = param.name.replace("_", "-")

            parameter = {
                "name": name,
                "in": param_type.value,
                "required": param.field_info.is_required(),
                "schema": param_schema,
            }
            if field_info.description:
                parameter["description"] = field_info.description
            openapi_examples = getattr(field_info, "openapi_examples", None)
            example = getattr(field_info, "example", None)
            if openapi_examples:
                parameter["examples"] = jsonable_encoder(openapi_examples)
            elif example is not _Unset:
                parameter["example"] = jsonable_encoder(example)
            if getattr(field_info, "deprecated", None):
                parameter["deprecated"] = True
            parameters.append(parameter)
    return parameters


def get_openapi_operation_request_body(
    *,
    body_field: ModelField | None,
    model_name_map: ModelNameMap,
    field_mapping: dict[
        tuple[ModelField, Literal["validation", "serialization"]], dict[str, Any]
    ],
    separate_input_output_schemas: bool = True,
) -> dict[str, Any] | None:
    if not body_field:
        return None
    assert isinstance(body_field, ModelField)
    body_schema = get_schema_from_model_field(
        field=body_field,
        model_name_map=model_name_map,
        field_mapping=field_m