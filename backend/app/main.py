import asyncio
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.market import router as market_router
from app.api.routes.predictions import router as predictions_router
from app.api.websockets.stream import router as stream_router
from app.db.connection import close_pool
from app.services.simulation import simulation_manager

# Psycopg async connections on Windows require selector event loop policy.
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

app = FastAPI(title="Temporal Market Forecaster API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market_router)
app.include_router(predictions_router)
app.include_router(stream_router)


@app.on_event("shutdown")
async def shutdown_event():
    await simulation_manager.shutdown()
    await close_pool()


@app.get("/")
async def root():
    return {"message": "Temporal Market Forecaster API"}
