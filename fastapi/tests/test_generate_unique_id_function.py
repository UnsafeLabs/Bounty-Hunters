import warnings

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from inline_snapshot import snapshot
from pydantic import BaseModel


def custom_generate_unique_id(route: APIRoute):
    return f"foo_{route.name}"


def custom_generate_unique_id2(route: APIRoute):
    return f"bar_{route.name}"


def custom_generate_unique_id3(route: APIRoute):
    return f"baz_{route.name}"


class Item(BaseModel):
    name: str
    price: float


class Message(BaseModel):
    title: str
    description: str


def test_top_level_generate_unique_id():
    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)
    router = APIRouter()

    @app.post("/", response_model=list[Item], responses={404: {"model": list[Message]}})
    def post_root(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @router.post(
        "/router", response_model=list[Item], responses={404: {"model": list[Message]}}
    )
    def post_router(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    app.include_router(router)
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/": {
                    "post": {
                        "summary": "Post Root",
                        "operationId": "foo_post_root",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_foo_post_root"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
                "/router": {
                    "post": {
                        "summary": "Post Router",
                        "operationId": "foo_post_router",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_foo_post_router"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Foo Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Foo Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
            },
            "components": {
                "schemas": {
                    "Body_foo_post_root": {
                        "title": "Body_foo_post_root",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_foo_post_router": {
                        "title": "Body_foo_post_router",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "HTTPValidationError": {
                        "title": "HTTPValidationError",
                        "type": "object",
                        "properties": {
                            "detail": {
                                "title": "Detail",
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ValidationError"
                                },
                            }
                        },
                    },
                    "Item": {
                        "title": "Item",
                        "required": ["name", "price"],
                        "type": "object",
                        "properties": {
                            "name": {"title": "Name", "type": "string"},
                            "price": {"title": "Price", "type": "number"},
                        },
                    },
                    "Message": {
                        "title": "Message",
                        "required": ["title", "description"],
                        "type": "object",
                        "properties": {
                            "title": {"title": "Title", "type": "string"},
                            "description": {"title": "Description", "type": "string"},
                        },
                    },
                    "ValidationError": {
                        "title": "ValidationError",
                        "required": ["loc", "msg", "type"],
                        "type": "object",
                        "properties": {
                            "ctx": {"title": "Context", "type": "object"},
                            "input": {"title": "Input"},
                            "loc": {
                                "title": "Location",
                                "type": "array",
                                "items": {
                                    "anyOf": [{"type": "string"}, {"type": "integer"}]
                                },
                            },
                            "msg": {"title": "Message", "type": "string"},
                            "type": {"title": "Error Type", "type": "string"},
                        },
                    },
                }
            },
        }
    )


def test_router_overrides_generate_unique_id():
    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)
    router = APIRouter(generate_unique_id_function=custom_generate_unique_id2)

    @app.post("/", response_model=list[Item], responses={404: {"model": list[Message]}})
    def post_root(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @router.post(
        "/router", response_model=list[Item], responses={404: {"model": list[Message]}}
    )
    def post_router(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    app.include_router(router)
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/": {
                    "post": {
                        "summary": "Post Root",
                        "operationId": "foo_post_root",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_foo_post_root"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
                "/router": {
                    "post": {
                        "summary": "Post Router",
                        "operationId": "bar_post_router",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_bar_post_router"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Bar Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Bar Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
            },
            "components": {
                "schemas": {
                    "Body_bar_post_router": {
                        "title": "Body_bar_post_router",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_foo_post_root": {
                        "title": "Body_foo_post_root",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "HTTPValidationError": {
                        "title": "HTTPValidationError",
                        "type": "object",
                        "properties": {
                            "detail": {
                                "title": "Detail",
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ValidationError"
                                },
                            }
                        },
                    },
                    "Item": {
                        "title": "Item",
                        "required": ["name", "price"],
                        "type": "object",
                        "properties": {
                            "name": {"title": "Name", "type": "string"},
                            "price": {"title": "Price", "type": "number"},
                        },
                    },
                    "Message": {
                        "title": "Message",
                        "required": ["title", "description"],
                        "type": "object",
                        "properties": {
                            "title": {"title": "Title", "type": "string"},
                            "description": {"title": "Description", "type": "string"},
                        },
                    },
                    "ValidationError": {
                        "title": "ValidationError",
                        "required": ["loc", "msg", "type"],
                        "type": "object",
                        "properties": {
                            "ctx": {"title": "Context", "type": "object"},
                            "input": {"title": "Input"},
                            "loc": {
                                "title": "Location",
                                "type": "array",
                                "items": {
                                    "anyOf": [{"type": "string"}, {"type": "integer"}]
                                },
                            },
                            "msg": {"title": "Message", "type": "string"},
                            "type": {"title": "Error Type", "type": "string"},
                        },
                    },
                }
            },
        }
    )


def test_router_include_overrides_generate_unique_id():
    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)
    router = APIRouter(generate_unique_id_function=custom_generate_unique_id2)

    @app.post("/", response_model=list[Item], responses={404: {"model": list[Message]}})
    def post_root(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @router.post(
        "/router", response_model=list[Item], responses={404: {"model": list[Message]}}
    )
    def post_router(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    app.include_router(router, generate_unique_id_function=custom_generate_unique_id3)
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/": {
                    "post": {
                        "summary": "Post Root",
                        "operationId": "foo_post_root",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_foo_post_root"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
                "/router": {
                    "post": {
                        "summary": "Post Router",
                        "operationId": "bar_post_router",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_bar_post_router"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Bar Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Bar Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
            },
            "components": {
                "schemas": {
                    "Body_bar_post_router": {
                        "title": "Body_bar_post_router",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_foo_post_root": {
                        "title": "Body_foo_post_root",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "HTTPValidationError": {
                        "title": "HTTPValidationError",
                        "type": "object",
                        "properties": {
                            "detail": {
                                "title": "Detail",
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ValidationError"
                                },
                            }
                        },
                    },
                    "Item": {
                        "title": "Item",
                        "required": ["name", "price"],
                        "type": "object",
                        "properties": {
                            "name": {"title": "Name", "type": "string"},
                            "price": {"title": "Price", "type": "number"},
                        },
                    },
                    "Message": {
                        "title": "Message",
                        "required": ["title", "description"],
                        "type": "object",
                        "properties": {
                            "title": {"title": "Title", "type": "string"},
                            "description": {"title": "Description", "type": "string"},
                        },
                    },
                    "ValidationError": {
                        "title": "ValidationError",
                        "required": ["loc", "msg", "type"],
                        "type": "object",
                        "properties": {
                            "ctx": {"title": "Context", "type": "object"},
                            "input": {"title": "Input"},
                            "loc": {
                                "title": "Location",
                                "type": "array",
                                "items": {
                                    "anyOf": [{"type": "string"}, {"type": "integer"}]
                                },
                            },
                            "msg": {"title": "Message", "type": "string"},
                            "type": {"title": "Error Type", "type": "string"},
                        },
                    },
                }
            },
        }
    )


def test_subrouter_top_level_include_overrides_generate_unique_id():
    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)
    router = APIRouter()
    sub_router = APIRouter(generate_unique_id_function=custom_generate_unique_id2)

    @app.post("/", response_model=list[Item], responses={404: {"model": list[Message]}})
    def post_root(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @router.post(
        "/router", response_model=list[Item], responses={404: {"model": list[Message]}}
    )
    def post_router(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @sub_router.post(
        "/subrouter",
        response_model=list[Item],
        responses={404: {"model": list[Message]}},
    )
    def post_subrouter(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    router.include_router(sub_router)
    app.include_router(router, generate_unique_id_function=custom_generate_unique_id3)
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/": {
                    "post": {
                        "summary": "Post Root",
                        "operationId": "foo_post_root",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_foo_post_root"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
                "/router": {
                    "post": {
                        "summary": "Post Router",
                        "operationId": "baz_post_router",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_baz_post_router"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Baz Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Baz Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
                "/subrouter": {
                    "post": {
                        "summary": "Post Subrouter",
                        "operationId": "bar_post_subrouter",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_bar_post_subrouter"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Bar Post Subrouter",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Bar Post Subrouter",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
            },
            "components": {
                "schemas": {
                    "Body_bar_post_subrouter": {
                        "title": "Body_bar_post_subrouter",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_baz_post_router": {
                        "title": "Body_baz_post_router",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_foo_post_root": {
                        "title": "Body_foo_post_root",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "HTTPValidationError": {
                        "title": "HTTPValidationError",
                        "type": "object",
                        "properties": {
                            "detail": {
                                "title": "Detail",
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ValidationError"
                                },
                            }
                        },
                    },
                    "Item": {
                        "title": "Item",
                        "required": ["name", "price"],
                        "type": "object",
                        "properties": {
                            "name": {"title": "Name", "type": "string"},
                            "price": {"title": "Price", "type": "number"},
                        },
                    },
                    "Message": {
                        "title": "Message",
                        "required": ["title", "description"],
                        "type": "object",
                        "properties": {
                            "title": {"title": "Title", "type": "string"},
                            "description": {"title": "Description", "type": "string"},
                        },
                    },
                    "ValidationError": {
                        "title": "ValidationError",
                        "required": ["loc", "msg", "type"],
                        "type": "object",
                        "properties": {
                            "ctx": {"title": "Context", "type": "object"},
                            "input": {"title": "Input"},
                            "loc": {
                                "title": "Location",
                                "type": "array",
                                "items": {
                                    "anyOf": [{"type": "string"}, {"type": "integer"}]
                                },
                            },
                            "msg": {"title": "Message", "type": "string"},
                            "type": {"title": "Error Type", "type": "string"},
                        },
                    },
                }
            },
        }
    )


def test_router_path_operation_overrides_generate_unique_id():
    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)
    router = APIRouter(generate_unique_id_function=custom_generate_unique_id2)

    @app.post("/", response_model=list[Item], responses={404: {"model": list[Message]}})
    def post_root(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @router.post(
        "/router",
        response_model=list[Item],
        responses={404: {"model": list[Message]}},
        generate_unique_id_function=custom_generate_unique_id3,
    )
    def post_router(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    app.include_router(router)
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/": {
                    "post": {
                        "summary": "Post Root",
                        "operationId": "foo_post_root",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_foo_post_root"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Foo Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
                "/router": {
                    "post": {
                        "summary": "Post Router",
                        "operationId": "baz_post_router",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_baz_post_router"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Baz Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Baz Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
            },
            "components": {
                "schemas": {
                    "Body_baz_post_router": {
                        "title": "Body_baz_post_router",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_foo_post_root": {
                        "title": "Body_foo_post_root",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "HTTPValidationError": {
                        "title": "HTTPValidationError",
                        "type": "object",
                        "properties": {
                            "detail": {
                                "title": "Detail",
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ValidationError"
                                },
                            }
                        },
                    },
                    "Item": {
                        "title": "Item",
                        "required": ["name", "price"],
                        "type": "object",
                        "properties": {
                            "name": {"title": "Name", "type": "string"},
                            "price": {"title": "Price", "type": "number"},
                        },
                    },
                    "Message": {
                        "title": "Message",
                        "required": ["title", "description"],
                        "type": "object",
                        "properties": {
                            "title": {"title": "Title", "type": "string"},
                            "description": {"title": "Description", "type": "string"},
                        },
                    },
                    "ValidationError": {
                        "title": "ValidationError",
                        "required": ["loc", "msg", "type"],
                        "type": "object",
                        "properties": {
                            "ctx": {"title": "Context", "type": "object"},
                            "input": {"title": "Input"},
                            "loc": {
                                "title": "Location",
                                "type": "array",
                                "items": {
                                    "anyOf": [{"type": "string"}, {"type": "integer"}]
                                },
                            },
                            "msg": {"title": "Message", "type": "string"},
                            "type": {"title": "Error Type", "type": "string"},
                        },
                    },
                }
            },
        }
    )


def test_app_path_operation_overrides_generate_unique_id():
    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)
    router = APIRouter(generate_unique_id_function=custom_generate_unique_id2)

    @app.post(
        "/",
        response_model=list[Item],
        responses={404: {"model": list[Message]}},
        generate_unique_id_function=custom_generate_unique_id3,
    )
    def post_root(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @router.post(
        "/router",
        response_model=list[Item],
        responses={404: {"model": list[Message]}},
    )
    def post_router(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    app.include_router(router)
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/": {
                    "post": {
                        "summary": "Post Root",
                        "operationId": "baz_post_root",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_baz_post_root"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Baz Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Baz Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
                "/router": {
                    "post": {
                        "summary": "Post Router",
                        "operationId": "bar_post_router",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_bar_post_router"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Bar Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Bar Post Router",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
            },
            "components": {
                "schemas": {
                    "Body_bar_post_router": {
                        "title": "Body_bar_post_router",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_baz_post_root": {
                        "title": "Body_baz_post_root",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "HTTPValidationError": {
                        "title": "HTTPValidationError",
                        "type": "object",
                        "properties": {
                            "detail": {
                                "title": "Detail",
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ValidationError"
                                },
                            }
                        },
                    },
                    "Item": {
                        "title": "Item",
                        "required": ["name", "price"],
                        "type": "object",
                        "properties": {
                            "name": {"title": "Name", "type": "string"},
                            "price": {"title": "Price", "type": "number"},
                        },
                    },
                    "Message": {
                        "title": "Message",
                        "required": ["title", "description"],
                        "type": "object",
                        "properties": {
                            "title": {"title": "Title", "type": "string"},
                            "description": {"title": "Description", "type": "string"},
                        },
                    },
                    "ValidationError": {
                        "title": "ValidationError",
                        "required": ["loc", "msg", "type"],
                        "type": "object",
                        "properties": {
                            "ctx": {"title": "Context", "type": "object"},
                            "input": {"title": "Input"},
                            "loc": {
                                "title": "Location",
                                "type": "array",
                                "items": {
                                    "anyOf": [{"type": "string"}, {"type": "integer"}]
                                },
                            },
                            "msg": {"title": "Message", "type": "string"},
                            "type": {"title": "Error Type", "type": "string"},
                        },
                    },
                }
            },
        }
    )


def test_callback_override_generate_unique_id():
    app = FastAPI(generate_unique_id_function=custom_generate_unique_id)
    callback_router = APIRouter(generate_unique_id_function=custom_generate_unique_id2)

    @callback_router.post(
        "/post-callback",
        response_model=list[Item],
        responses={404: {"model": list[Message]}},
        generate_unique_id_function=custom_generate_unique_id3,
    )
    def post_callback(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @app.post(
        "/",
        response_model=list[Item],
        responses={404: {"model": list[Message]}},
        generate_unique_id_function=custom_generate_unique_id3,
        callbacks=callback_router.routes,
    )
    def post_root(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    @app.post(
        "/tocallback",
        response_model=list[Item],
        responses={404: {"model": list[Message]}},
    )
    def post_with_callback(item1: Item, item2: Item):
        return item1, item2  # pragma: nocover

    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.json() == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "FastAPI", "version": "0.1.0"},
            "paths": {
                "/": {
                    "post": {
                        "summary": "Post Root",
                        "operationId": "baz_post_root",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_baz_post_root"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Baz Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Baz Post Root",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                        "callbacks": {
                            "post_callback": {
                                "/post-callback": {
                                    "post": {
                                        "summary": "Post Callback",
                                        "operationId": "baz_post_callback",
                                        "requestBody": {
                                            "content": {
                                                "application/json": {
                                                    "schema": {
                                                        "$ref": "#/components/schemas/Body_baz_post_callback"
                                                    }
                                                }
                                            },
                                            "required": True,
                                        },
                                        "responses": {
                                            "200": {
                                                "description": "Successful Response",
                                                "content": {
                                                    "application/json": {
                                                        "schema": {
                                                            "title": "Response Baz Post Callback",
                                                            "type": "array",
                                                            "items": {
                                                                "$ref": "#/components/schemas/Item"
                                                            },
                                                        }
                                                    }
                                                },
                                            },
                                            "404": {
                                                "description": "Not Found",
                                                "content": {
                                                    "application/json": {
                                                        "schema": {
                                                            "title": "Response 404 Baz Post Callback",
                                                            "type": "array",
                                                            "items": {
                                                                "$ref": "#/components/schemas/Message"
                                                            },
                                                        }
                                                    }
                                                },
                                            },
                                            "422": {
                                                "description": "Validation Error",
                                                "content": {
                                                    "application/json": {
                                                        "schema": {
                                                            "$ref": "#/components/schemas/HTTPValidationError"
                                                        }
                                                    }
                                                },
                                            },
                                        },
                                    }
                                }
                            }
                        },
                    }
                },
                "/tocallback": {
                    "post": {
                        "summary": "Post With Callback",
                        "operationId": "foo_post_with_callback",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/Body_foo_post_with_callback"
                                    }
                                }
                            },
                            "required": True,
                        },
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response Foo Post With Callback",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Item"
                                            },
                                        }
                                    }
                                },
                            },
                            "404": {
                                "description": "Not Found",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "title": "Response 404 Foo Post With Callback",
                                            "type": "array",
                                            "items": {
                                                "$ref": "#/components/schemas/Message"
                                            },
                                        }
                                    }
                                },
                            },
                            "422": {
                                "description": "Validation Error",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": "#/components/schemas/HTTPValidationError"
                                        }
                                    }
                                },
                            },
                        },
                    }
                },
            },
            "components": {
                "schemas": {
                    "Body_baz_post_callback": {
                        "title": "Body_baz_post_callback",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_baz_post_root": {
                        "title": "Body_baz_post_root",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "Body_foo_post_with_callback": {
                        "title": "Body_foo_post_with_callback",
                        "required": ["item1", "item2"],
                        "type": "object",
                        "properties": {
                            "item1": {"$ref": "#/components/schemas/Item"},
                            "item2": {"$ref": "#/components/schemas/Item"},
                        },
                    },
                    "HTTPValidationError": {
                        "title": "HTTPValidationError",
                        "type": "object",
                        "properties": {
                            "detail": {
                                "title": "Detail",
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ValidationError"
                                },
                            }
                        },
                    },
                    "Item": {
                        "title": "Item",
                        "required": ["name", "price"],
                        "type": "object",
                        "properties": {
                            "name": {"title": "Name", "type": "string"},
                            "price": {"title": "Price", "type": "number"},
                        },
                    },
                    "Message": {
                        "title": "Message",
                        "required": ["title", "description"],
                        "type": "object",
                        "properties": {
                            "title": {"title": "Title", "type": "string"},
                            "description": {"title": "Description", "type": "string"},
                        },
                    },
                    "ValidationError": {
                        "title": "ValidationError",
                        "required": ["loc", "msg", "type"],
                        "type": "object",
                        "properties": {
                            "ctx": {"title": "Context", "type": "object"},
                            "input": {"title": "Input"},
                            "loc": {
                                "title": "Location",
                                "type": "array",
                                "items": {
                                    "anyOf": [{"type": "string"}, {"type": "integer"}]
                                },
                            },
                            "msg": {"title": "Message", "type": "string"},
                            "type": {"title": "Error Type", "type": "string"},
                        },
                    },
                }
            },
        }
    )


def test_warn_duplicate_operation_id():
    def broken_operation_id(route: APIRoute):
        return "foo"

    app = FastAPI(generate_unique_id_function=broken_operation_id)

    @app.post("/")
    def post_root(item1: Item):
        return item1  # pragma: nocover

    @app.post("/second")
    def post_second(item1: Item):
        return item1  # pragma: nocover

    @app.post("/third")
    def post_third(item1: Item):
        return item1  # pragma: nocover

    client = TestClient(app)
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        client.get("/openapi.json")
        assert len(w) >= 2
        duplicate_warnings = [
            warning for warning in w if issubclass(warning.category, UserWarning)
        ]
        assert len(duplicate_warnings) > 0
        assert "Duplicate Operation ID" in str(duplicate_warnings[0].message)


def test_default_operation_ids_include_method_path_and_name():
    app = FastAPI()

    @app.get("/users")
    def list_users():
        return []  # pragma: nocover

    @app.post("/api/v1/items")
    def create_item():
        return {}  # pragma: nocover

    @app.get("/users/{user_id}")
    def read_user(user_id: str):
        return {"user_id": user_id}  # pragma: nocover

    schema = TestClient(app).get("/openapi.json").json()

    assert schema["paths"]["/users"]["get"]["operationId"] == "get_users_list_users"
    assert (
        schema["paths"]["/api/v1/items"]["post"]["operationId"]
        == "post_api_v1_items_create_item"
    )
    assert (
        schema["paths"]["/users/{user_id}"]["get"]["operationId"]
        == "get_users_user_id_read_user"
    )


def test_default_operation_ids_use_router_prefix_and_method_per_operation():
    app = FastAPI()
    api_router = APIRouter(prefix="/api/v1")

    @api_router.get("/users")
    def list_users():
        return []  # pragma: nocover

    def health():
        return {"ok": True}  # pragma: nocover

    api_router.add_api_route("/health", health, methods=["GET", "POST"])
    app.include_router(api_router)

    schema = TestClient(app).get("/openapi.json").json()

    assert (
        schema["paths"]["/api/v1/users"]["get"]["operationId"]
        == "get_api_v1_users_list_users"
    )
    assert (
        schema["paths"]["/api/v1/health"]["get"]["operationId"]
        == "get_api_v1_health_health"
    )
    assert (
        schema["paths"]["/api/v1/health"]["post"]["operationId"]
        == "post_api_v1_health_health"
    )


def test_default_operation_ids_are_sanitized_and_collision_suffixed():
    app = FastAPI()

    def report():
        return {}  # pragma: nocover

    app.add_api_route("/reports/a-b", report, methods=["GET"], name="read_report")
    app.add_api_route("/reports/a_b", report, methods=["GET"], name="read_report")

    schema = TestClient(app).get("/openapi.json").json()

    first_id = schema["paths"]["/reports/a-b"]["get"]["operationId"]
    second_id = schema["paths"]["/reports/a_b"]["get"]["operationId"]
    assert first_id == "get_reports_a_b_read_report"
    assert second_id == "get_reports_a_b_read_report_2"
    assert first_id.replace("_", "").isalnum()
    assert second_id.replace("_", "").isalnum()
