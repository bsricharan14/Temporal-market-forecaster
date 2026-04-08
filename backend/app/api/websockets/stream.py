from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.simulation import simulation_manager

router = APIRouter()


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
