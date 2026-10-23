from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import get_settings
from app.database.mongodb import connect_database, create_indexes
from app.routers import admin, auth, drivers, rides
from app.routers.auth import limiter

logger = logging.getLogger(__name__)


def create_app(database=None, client_factory=connect_database) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if database is None:
            app.state.mongo_client = None
            try:
                client, active_database = client_factory()
                app.state.mongo_client = client
                app.state.database = active_database
            except Exception:
                app.state.database = None
                logger.exception("MongoDB is unavailable; API started in degraded mode")
        else:
            app.state.mongo_client = None
            app.state.database = database
            create_indexes(database)
        yield
        if app.state.mongo_client is not None:
            app.state.mongo_client.close()

    application = FastAPI(title="RishiRide Driver Management API", version="1.0.0", lifespan=lifespan)
    application.state.limiter = limiter
    application.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    application.add_middleware(
        CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    application.include_router(auth.router)
    application.include_router(drivers.router)
    application.include_router(rides.router)
    application.include_router(admin.router)

    @application.get("/health", tags=["health"])
    def health():
        if application.state.database is None:
            return JSONResponse(status_code=503, content={"status": "degraded", "database": "unavailable"})
        return {"status": "ok"}

    @application.exception_handler(Exception)
    async def safe_unexpected_error(request: Request, error: Exception):
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    return application


app = create_app()