import asyncio
import csv
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from app.db.connection import get_connection_pool

PROJECT_ROOT = Path(__file__).resolve().parents[3]
TICK_DATA_DIR = PROJECT_ROOT / "tick data"


@dataclass
class SymbolSimulationState:
    symbol: str
    source_ticks: list[dict[str, Any]] = field(default_factory=list)
    index: int = 0
    running: bool = False
    clients: set[WebSocket] = field(default_factory=set)
    task: asyncio.Task | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    loaded_from_csv: bool = False
    last_price: float | None = None
    speed_multiplier: float = 1.0


class SimulationManager:
    def __init__(self):
        self._states: dict[str, SymbolSimulationState] = {}
        self._states_lock = asyncio.Lock()
        self._all_symbol_clients: set[WebSocket] = set()

    def _discover_symbols(self) -> list[str]:
        symbols: set[str] = set()
        if TICK_DATA_DIR.exists():
            for file in TICK_DATA_DIR.glob("*_ticks.csv"):
                symbol = file.stem.replace("_ticks", "").strip().upper()
                if symbol:
                    symbols.add(symbol)

        return sorted(symbols)

    async def _all_known_symbols(self) -> list[str]:
        async with self._states_lock:
            known = set(self._states.keys())

        known.update(self._discover_symbols())
        return sorted(known)

    async def _get_state(self, symbol: str) -> SymbolSimulationState:
        normalized = symbol.strip().upper()
        async with self._states_lock:
            if normalized not in self._states:
                self._states[normalized] = SymbolSimulationState(symbol=normalized)
            return self._states[normalized]

    def _csv_path_for_symbol(self, symbol: str) -> Path:
        return TICK_DATA_DIR / f"{symbol}_ticks.csv"

    def _load_ticks_from_csv(self, symbol: str) -> list[dict[str, Any]]:
        csv_path = self._csv_path_for_symbol(symbol)
        if not csv_path.exists():
            return []

        ticks: list[dict[str, Any]] = []
        with csv_path.open(mode="r", newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                try:
                    ticks.append(
                        {
                            "time": datetime.strptime(row["time"], "%Y-%m-%d %H:%M:%S.%f"),
                            "symbol": row["symbol"].strip().upper(),
                            "price": float(row["price"]),
                            "volume": int(float(row["volume"])),
                        }
                    )
                except (KeyError, ValueError):
                    continue

        return ticks

    async def _ensure_source_ticks(self, state: SymbolSimulationState, force_reload: bool = False) -> None:
        if state.loaded_from_csv and not force_reload:
            return

        state.source_ticks = self._load_ticks_from_csv(state.symbol)
        state.loaded_from_csv = True
        if force_reload:
            state.index = 0

    async def _clear_symbol_data(self, symbol: str) -> None:
        pool = await get_connection_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM market_ticks WHERE symbol = %s", (symbol,))
                await cur.execute("DELETE FROM market_ticks_plain WHERE symbol = %s", (symbol,))

    async def _clear_all_tick_data(self) -> None:
        pool = await get_connection_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("TRUNCATE TABLE market_ticks")
                await cur.execute("TRUNCATE TABLE market_ticks_plain")

    async def _insert_tick(self, tick: dict[str, Any]) -> None:
        pool = await get_connection_pool()
        args = (tick["time"], tick["symbol"], tick["price"], tick["volume"])
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO market_ticks (time, symbol, price, volume)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (symbol, time) DO NOTHING
                    """,
                    args,
                )
                await cur.execute(
                    """
                    INSERT INTO market_ticks_plain (time, symbol, price, volume)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (symbol, time) DO NOTHING
                    """,
                    args,
                )

    def _snapshot(self, state: SymbolSimulationState) -> dict[str, Any]:
        status = "running" if state.running else "stopped"
        if not state.source_ticks:
            status = "missing_source"
        elif not state.running and state.index >= len(state.source_ticks):
            status = "completed"

        next_tick = state.source_ticks[state.index] if state.index < len(state.source_ticks) else None

        return {
            "symbol": state.symbol,
            "status": status,
            "position": state.index,
            "total_ticks": len(state.source_ticks),
            "next_tick_time": next_tick["time"].isoformat() if next_tick else None,
            "last_price": state.last_price,
            "speed_multiplier": state.speed_multiplier,
        }

    async def _broadcast(self, state: SymbolSimulationState, payload: dict[str, Any]) -> None:
        dead_clients: list[WebSocket] = []
        for client in state.clients:
            try:
                await client.send_json(payload)
            except Exception:
                dead_clients.append(client)

        for client in dead_clients:
            state.clients.discard(client)

        await self._broadcast_all_clients(payload)

    async def _broadcast_all_clients(self, payload: dict[str, Any]) -> None:
        dead_clients: list[WebSocket] = []
        for client in self._all_symbol_clients:
            try:
                await client.send_json(payload)
            except Exception:
                dead_clients.append(client)

        for client in dead_clients:
            self._all_symbol_clients.discard(client)

    async def subscribe(self, symbol: str, websocket: WebSocket) -> dict[str, Any]:
        state = await self._get_state(symbol)
        async with state.lock:
            state.clients.add(websocket)
            await self._ensure_source_ticks(state)
            snapshot = self._snapshot(state)

        await websocket.send_json({"type": "simulation_state", "state": snapshot})
        return snapshot

    async def unsubscribe(self, symbol: str, websocket: WebSocket) -> None:
        state = await self._get_state(symbol)
        async with state.lock:
            state.clients.discard(websocket)

    async def subscribe_all(self, websocket: WebSocket) -> list[dict[str, Any]]:
        self._all_symbol_clients.add(websocket)
        snapshots: list[dict[str, Any]] = []
        for symbol in self._discover_symbols():
            state = await self._get_state(symbol)
            async with state.lock:
                await self._ensure_source_ticks(state)
                snapshots.append(self._snapshot(state))

        return snapshots

    async def unsubscribe_all(self, websocket: WebSocket) -> None:
        self._all_symbol_clients.discard(websocket)

    async def get_all_statuses(self) -> list[dict[str, Any]]:
        snapshots: list[dict[str, Any]] = []
        for symbol in await self._all_known_symbols():
            state = await self._get_state(symbol)
            async with state.lock:
                await self._ensure_source_ticks(state)
                snapshots.append(self._snapshot(state))

        return snapshots

    async def get_status(self, symbol: str) -> dict[str, Any]:
        state = await self._get_state(symbol)
        async with state.lock:
            await self._ensure_source_ticks(state)
            return self._snapshot(state)

    async def start(self, symbol: str, *, restart: bool = False) -> dict[str, Any]:
        state = await self._get_state(symbol)
        async with state.lock:
            await self._ensure_source_ticks(state, force_reload=restart)
            if restart:
                await self._clear_all_tick_data()
                state.index = 0
                state.last_price = None

            if not state.source_ticks:
                return self._snapshot(state)

            state.running = True
            if state.task is None or state.task.done():
                state.task = asyncio.create_task(self._run_simulation(state))

            snapshot = self._snapshot(state)

        await self._broadcast(state, {"type": "simulation_state", "state": snapshot})
        return snapshot

    async def start_all(self, *, restart: bool = False) -> list[dict[str, Any]]:
        symbols = await self._all_known_symbols()
        if restart:
            await self._clear_all_tick_data()

        snapshots: list[dict[str, Any]] = []
        for symbol in symbols:
            state = await self._get_state(symbol)
            async with state.lock:
                await self._ensure_source_ticks(state, force_reload=restart)
                if restart:
                    if state.task is not None and not state.task.done():
                        state.task.cancel()
                    state.task = None
                    state.index = 0
                    state.last_price = None

                if not state.source_ticks:
                    snapshot = self._snapshot(state)
                    snapshots.append(snapshot)
                    continue

                state.running = True
                if state.task is None or state.task.done():
                    state.task = asyncio.create_task(self._run_simulation(state))

                snapshot = self._snapshot(state)
                snapshots.append(snapshot)

            await self._broadcast(state, {"type": "simulation_state", "state": snapshot})

        return snapshots

    async def set_speed(self, symbol: str, speed_multiplier: float) -> dict[str, Any]:
        state = await self._get_state(symbol)
        async with state.lock:
            state.speed_multiplier = max(0.1, min(speed_multiplier, 50.0))
            snapshot = self._snapshot(state)

        await self._broadcast(state, {"type": "simulation_state", "state": snapshot})
        return snapshot

    async def set_speed_all(self, speed_multiplier: float) -> list[dict[str, Any]]:
        symbols = await self._all_known_symbols()
        next_speed = max(0.1, min(speed_multiplier, 50.0))
        snapshots: list[dict[str, Any]] = []

        for symbol in symbols:
            state = await self._get_state(symbol)
            async with state.lock:
                await self._ensure_source_ticks(state)
                state.speed_multiplier = next_speed
                snapshot = self._snapshot(state)
                snapshots.append(snapshot)

            await self._broadcast(state, {"type": "simulation_state", "state": snapshot})

        return snapshots

    async def stop(self, symbol: str) -> dict[str, Any]:
        state = await self._get_state(symbol)
        async with state.lock:
            state.running = False
            snapshot = self._snapshot(state)

        await self._broadcast(state, {"type": "simulation_state", "state": snapshot})
        return snapshot

    async def stop_all(self) -> list[dict[str, Any]]:
        symbols = await self._all_known_symbols()
        snapshots: list[dict[str, Any]] = []

        for symbol in symbols:
            state = await self._get_state(symbol)
            async with state.lock:
                await self._ensure_source_ticks(state)
                state.running = False
                snapshot = self._snapshot(state)
                snapshots.append(snapshot)

            await self._broadcast(state, {"type": "simulation_state", "state": snapshot})

        return snapshots

    async def _run_simulation(self, state: SymbolSimulationState) -> None:
        try:
            while True:
                tick_to_insert = None
                tick_payload = None
                status_payload = None
                sleep_duration = 0

                async with state.lock:
                    if not state.running:
                        break

                    if state.index >= len(state.source_ticks):
                        state.running = False
                        status_payload = {
                            "type": "simulation_state",
                            "state": self._snapshot(state),
                        }
                    else:
                        current_tick = state.source_ticks[state.index]
                        state.last_price = current_tick["price"]
                        tick_to_insert = current_tick
                        tick_payload = {
                            "type": "tick",
                            "tick": {
                                "time": current_tick["time"].isoformat(),
                                "symbol": current_tick["symbol"],
                                "price": current_tick["price"],
                                "volume": current_tick["volume"],
                            },
                            "position": state.index + 1,
                            "total_ticks": len(state.source_ticks),
                        }
                        
                        # Calculate sleep duration based on time difference between ticks
                        if state.index + 1 < len(state.source_ticks):
                            next_tick = state.source_ticks[state.index + 1]
                            time_diff = (next_tick["time"] - current_tick["time"]).total_seconds()
                            sleep_duration = max(0.001, time_diff / state.speed_multiplier)  # Minimum 1ms to avoid spinning
                        
                        state.index += 1

                if status_payload is not None:
                    await self._broadcast(state, status_payload)
                    break

                if tick_to_insert is not None:
                    await self._insert_tick(tick_to_insert)

                if tick_payload is not None:
                    await self._broadcast(state, tick_payload)

                if sleep_duration > 0:
                    await asyncio.sleep(sleep_duration)
        finally:
            async with state.lock:
                state.task = None


simulation_manager = SimulationManager()
