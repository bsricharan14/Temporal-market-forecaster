from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.simulation import simulation_manager

router = APIRouter()


@router.websocket("/ws/stream")
async def market_stream_all(websocket: WebSocket):
    await websocket.accept()
    snapshots = await simulation_manager.subscribe_all(websocket)
    for snapshot in snapshots:
        await websocket.send_json({"type": "simulation_state", "state": snapshot})

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
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
        pass
    finally:
        await simulation_manager.unsubscribe(normalized_symbol, websocket)
