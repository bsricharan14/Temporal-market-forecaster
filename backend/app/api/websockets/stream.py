from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging

from app.services.simulation import simulation_manager

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/stream")
async def market_stream_all(websocket: WebSocket):
    await websocket.accept()
    snapshots = await simulation_manager.subscribe_all(websocket)
    for snapshot in snapshots:
        try:
            await websocket.send_json({"type": "simulation_state", "state": snapshot})
        except Exception as e:
            logger.debug(f"Failed to send initial snapshot: {type(e).__name__}")
            break

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        logger.debug("WebSocket disconnected: stream_all")
    except Exception as e:
        logger.debug(f"WebSocket error in stream_all: {type(e).__name__}")
    finally:
        await simulation_manager.unsubscribe_all(websocket)


@router.websocket("/ws/stream/{symbol}")
async def market_stream(websocket: WebSocket, symbol: str):
    await websocket.accept()
    normalized_symbol = symbol.strip().upper()
    await simulation_manager.subscribe(normalized_symbol, websocket)
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        logger.debug(f"WebSocket disconnected: stream/{symbol}")
    except Exception as e:
        logger.debug(f"WebSocket error in stream/{symbol}: {type(e).__name__}")
    finally:
        await simulation_manager.unsubscribe(normalized_symbol, websocket)
