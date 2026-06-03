from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from inline_snapshot import snapshot


def test_get_openapi_no_params():
    app = FastAPI()

    @app.get("/items/")
    def read_items():
        return [{"name": "Foo"}]

    openapi_schema = get_openapi(
        title="Custom Title",
        version="1.0.0",
        routes=app.routes,
    )
    assert openapi_schema == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "Custom Title", "version": "1.0.0"},
            "paths": {
                "/items/": {
                    "get": {
                        "summary": "Read Items",
                        "operationId": "read_items_items__get",
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {"application/json": {"schema": {}}},
                            }
                        },
                    }
                }
            },
        }
    )


def test_get_openapi_with_servers():
    app = FastAPI()

    @app.get("/items/")
    def read_items():
        return [{"name": "Foo"}]

    openapi_schema = get_openapi(
        title="Custom Title",
        version="1.0.0",
        routes=app.routes,
        servers=[{"url": "https://example.com", "description": "Test Server"}],
    )
    assert openapi_schema == snapshot(
        {
            "openapi": "3.1.0",
            "info": {"title": "Custom Title", "version": "1.0.0"},
            "servers": [{"url": "https://example.com", "description": "Test Server"}],
            "paths": {
                "/items/": {
                    "get": {
                        "summary": "Read Items",
                        "operationId": "read_items_items__get",
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {"application/json": {"schema": {}}},
                            }
                        },
                    }
                }
            },
        }
    )


def test_get_openapi_with_contact():
    app = FastAPI()

    @app.get("/items/")
    def read_items():
        return [{"name": "Foo"}]

    openapi_schema = get_openapi(
        title="Custom Title",
        version="1.0.0",
        routes=app.routes,
        contact={"name": "test", "url": "https://test.com", "email": "test@test.com"},
    )
    assert openapi_schema == snapshot(
        {
            "openapi": "3.1.0",
            "info": {
                "title": "Custom Title",
                "contact": {
                    "name": "test",
                    "url": "https://test.com/",
                    "email": "test@test.com",
                },
                "version": "1.0.0",
            },
            "paths": {
                "/items/": {
                    "get": {
                        "summary": "Read Items",
                        "operationId": "read_items_items__get",
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {"application/json": {"schema": {}}},
                            }
                        },
                    }
                }
            },
        }
    )


def test_get_openapi_with_license():
    app = FastAPI()

    @app.get("/items/")
    def read_items():
        return [{"name": "Foo"}]

    openapi_schema = get_openapi(
        title="Custom Title",
        version="1.0.0",
        routes=app.routes,
        license_info={"name": "MIT", "url": "https://license.com"},
    )
    assert openapi_schema == snapshot(
        {
            "openapi": "3.1.0",
            "info": {
                "title": "Custom Title",
                "license": {"name": "MIT", "url": "https://license.com/"},
                "version": "1.0.0",
            },
            "paths": {
                "/items/": {
                    "get": {
                        "summary": "Read Items",
                        "operationId": "read_items_items__get",
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {"application/json": {"schema": {}}},
                            }
                        },
                    }
                }
            },
        }
    )


def test_get_openapi_with_all_params():
    app = FastAPI()

    @app.get("/items/")
    def read_items():
        return [{"name": "Foo"}]

    openapi_schema = get_openapi(
        title="Custom Title",
        version="1.0.0",
        routes=app.routes,
        servers=[{"url": "https://example.com", "description": "Test Server"}],
        contact={"name": "test", "url": "https://test.com", "email": "test@test.com"},
        license_info={"name": "MIT", "url": "https://license.com"},
    )
    assert openapi_schema == snapshot(
        {
            "openapi": "3.1.0",
            "info": {
                "title": "Custom Title",
                "contact": {
                    "name": "test",
                    "url": "https://test.com/",
                    "email": "test@test.com",
                },
                "license": {"name": "MIT", "url": "https://license.com/"},
                "version": "1.0.0",
            },
            "servers": [{"url": "https://example.com", "description": "Test Server"}],
            "paths": {
                "/items/": {
                    "get": {
                        "summary": "Read Items",
                        "operationId": "read_items_items__get",
                        "responses": {
                            "200": {
                                "description": "Successful Response",
                                "content": {"application/json": {"schema": {}}},
                            }
                        },
                    }
                }
            },
        }
    )
