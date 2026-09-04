from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import routes_ask, routes_dashboard, routes_meta
from app.config import get_settings

app = FastAPI(
    title="Logistics Analytics API",
    version="1.0.0",
    description=(
        "Analytics over a read-only logistics dataset. All computation happens "
        "in a whitelisted semantic layer; the AI layer only selects a tool and "
        "fills in its parameters."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(routes_meta.router)
app.include_router(routes_dashboard.router)
app.include_router(routes_ask.router)
