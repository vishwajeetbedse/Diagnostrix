"""Diagnostix CDSS — application entry point.

    python -m backend.app.main          (from the project folder)

Serves the API under /api/v1, interactive API docs at /docs, and the built
React frontend (frontend/dist) for every other path.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api.routes import router
from .config import Settings, settings as default_settings
from .container import Container

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s")


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or default_settings

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.container = container or Container(settings)
        await app.state.container.startup()
        yield
        await app.state.container.shutdown()

    app = FastAPI(
        title="Diagnostix CDSS API",
        version=__version__,
        description="Medication order verification: deterministic rules engine, global interaction data (DDInter), "
                    "FDA label evidence and FAERS real-world signals, with a grounded local AI rationale layer.",
        lifespan=lifespan,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.include_router(router)

    dist = settings.frontend_dist
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        file = (dist / path).resolve()
        if path and file.is_file() and dist.resolve() in file.parents:
            return FileResponse(file)
        index = dist / "index.html"
        if index.exists():
            return FileResponse(index)
        return JSONResponse({"detail": "Frontend not built. Run: cd frontend && npm install && npm run build"}, status_code=503)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    print(f"\n  Diagnostix CDSS {__version__}  →  http://localhost:{default_settings.port}")
    print(f"  API docs        →  http://localhost:{default_settings.port}/docs")
    print(f"  Data sources    :  {default_settings.sources}\n")
    uvicorn.run(app, host="127.0.0.1", port=default_settings.port, log_level="info")
