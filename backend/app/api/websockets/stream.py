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
            # The frontend does not need to send data, but receiving here lets us detect disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await simulation_manager.unsubscribe(normalized_symbol, websocket)
