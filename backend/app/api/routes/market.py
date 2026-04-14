import json
import logging
import re
from pathlib import Path
from statistics import median
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.db.connection import get_connection_pool
from app.services.simulation import simulation_manager

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
router = APIRouter(prefix="/market", tags=["market"])
TICK_DATA_DIR = Path(__file__).resolve().parents[4] / "tick data"


def _parse_window_to_interval(window: str | None, window_minutes: int | None) -> str:
    if window is None:
        return f"{window_minutes or 60} minutes"

    value = window.strip().lower()
    match = re.fullmatch(r"(\d+)\s*(m|h|d|minute|minutes|hour|hours|day|days)", value)
    if not match:
        raise HTTPException(
            status_code=400,
            detail="Invalid window format. Use values like '15m', '60 minutes', '1h', or '1 day'.",
        )

    amount = int(match.group(1))
    unit = match.group(2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Window value must be greater than zero.")

    if unit in {"m", "minute", "minutes"}:
        return f"{amount} minutes"
    if unit in {"h", "hour", "hours"}:
        return f"{amount} hours"
    return f"{amount} days"


@router.get("/simulation/symbols")
async def simulation_symbols():
    symbols: list[str] = []
    if TICK_DATA_DIR.exists():
        for file in TICK_DATA_DIR.glob("*_ticks.csv"):
            symbol = file.stem.replace("_ticks", "").strip().upper()
            if symbol:
                symbols.append(symbol)

    symbols = sorted(set(symbols))
    return {"symbols": symbols}


@router.get("/simulation/{symbol}/status")
async def simulation_status(symbol: str):
    return await simulation_manager.get_status(symbol)


@router.get("/simulation/status")
async def simulation_status_all():
    return {"states": await simulation_manager.get_all_statuses()}


@router.post("/simulation/start")
async def start_simulation_all():
    return {"states": await simulation_manager.start_all(restart=False)}


@router.post("/simulation/stop")
async def stop_simulation_all():
    return {"states": await simulation_manager.stop_all()}


@router.post("/simulation/restart")
async def restart_simulation_all():
    return {"states": await simulation_manager.start_all(restart=True)}


@router.post("/simulation/clear")
async def clear_simulation_all():
    return {"states": await simulation_manager.clear_all()}


@router.post("/simulation/speed")
async def set_simulation_speed_all(
    speed: float = Query(default=1.0, ge=0.25, le=20.0),
):
    return {
        "speed_multiplier": speed,
        "states": await simulation_manager.set_speed_all(speed),
    }


@router.post("/simulation/{symbol}/start")
async def start_simulation(symbol: str):
    return await simulation_manager.start(symbol, restart=False)


@router.post("/simulation/{symbol}/stop")
async def stop_simulation(symbol: str):
    return await simulation_manager.stop(symbol)


@router.post("/simulation/{symbol}/restart")
async def restart_simulation(symbol: str):
    return await simulation_manager.start(symbol, restart=True)


@router.post("/simulation/{symbol}/speed")
async def set_simulation_speed(
    symbol: str,
    speed: float = Query(default=1.0, ge=0.25, le=20.0),
):
    return await simulation_manager.set_speed(symbol, speed)


@router.get("/ticks")
async def get_ticks(symbol: str = "AAPL", limit: int = Query(default=200, ge=1, le=5000)):
    pool = await get_connection_pool()
    sql = """
    SELECT time, symbol, price::float8 AS price, volume
    FROM market_ticks
    WHERE symbol = %s
    ORDER BY time DESC
    LIMIT %s
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, (symbol, limit))
            rows = await cur.fetchall()

    rows.reverse()
    return [
        {
            "time": row[0],
            "symbol": row[1],
            "price": row[2],
            "volume": row[3],
        }
        for row in rows
    ]


@router.get("/ohlcv")
async def get_ohlcv(symbol: str = "AAPL", limit: int = Query(default=120, ge=1, le=5000)):
    pool = await get_connection_pool()
    sql = """
    SELECT
        bucket,
        symbol,
        open::float8 AS open,
        high::float8 AS high,
        low::float8 AS low,
        close::float8 AS close,
        volume
    FROM ohlcv_1m
    WHERE symbol = %s
    ORDER BY bucket DESC
    LIMIT %s
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, (symbol, limit))
            rows = await cur.fetchall()

    rows.reverse()
    return [
        {
            "bucket": row[0],
            "symbol": row[1],
            "open": row[2],
            "high": row[3],
            "low": row[4],
            "close": row[5],
            "volume": row[6],
        }
        for row in rows
    ]


@router.get("/benchmark")
async def benchmark(
    symbol: str = "AAPL",
    window: str | None = Query(default=None, min_length=1),
    window_minutes: int | None = Query(default=None, ge=1, le=1440),
    runs: int = Query(default=3, ge=1, le=10),
):
    pool = await get_connection_pool()
    normalized_symbol = symbol.strip().upper()
    if not normalized_symbol:
        raise HTTPException(status_code=400, detail="Symbol is required")

    interval = _parse_window_to_interval(window, window_minutes)
    logger.info("Benchmark request: symbol=%s interval=%s runs=%s", symbol, interval, runs)

    def _normalize_explain_payload(payload: Any) -> Any:
        if isinstance(payload, (list, tuple)) and payload:
            return _normalize_explain_payload(payload[0])
        if isinstance(payload, str):
            return json.loads(payload)
        return payload

    def _find_value(payload: Any, key: str) -> Any:
        if isinstance(payload, dict):
            if key in payload:
                return payload[key]
            for value in payload.values():
                found = _find_value(value, key)
                if found is not None:
                    return found
        elif isinstance(payload, list):
            for item in payload:
                found = _find_value(item, key)
                if found is not None:
                    return found
        return None

    async def explain_query(cur, sql: str, params: tuple):
        explain_sql = f"EXPLAIN (ANALYZE, FORMAT JSON) {sql.strip()}"
        logger.debug("Benchmark query explain: %s | params=%s", explain_sql, params)
        await cur.execute(explain_sql, params)
        rows = await cur.fetchall()
        payload = _normalize_explain_payload(rows[0] if rows else None)
        execution_time = _find_value(payload, "Execution Time")
        actual_rows = _find_value(payload, "Actual Rows")

        if execution_time is None:
            logger.error("Failed to parse execution time from EXPLAIN payload: %s", payload)
            raise RuntimeError("Unable to parse execution time from EXPLAIN output")

        logger.info("Query executed in %.3f ms, rows=%s", execution_time, actual_rows)
        return float(execution_time), int(actual_rows or 0)

    async def fetch_reference_time(cur, symbol: str):
        await cur.execute(
            """
            SELECT GREATEST(
                COALESCE((SELECT MAX(time) FROM market_ticks WHERE symbol = %s), 'epoch'),
                COALESCE((SELECT MAX(time) FROM market_ticks_plain WHERE symbol = %s), 'epoch')
            )
            """,
            (symbol, symbol),
        )
        result = await cur.fetchone()
        latest_time = result[0] if result else None

        if latest_time is not None:
            return latest_time

        await cur.execute("SELECT NOW()")
        result = await cur.fetchone()
        return result[0] if result else None

    async def query_stats(cur, sql: str, params: tuple):
        latencies: list[float] = []
        row_count = 0

        for attempt in range(1, runs + 1):
            elapsed_ms, actual_rows = await explain_query(cur, sql, params)
            logger.info("Benchmark run %d/%d: %.3f ms", attempt, runs, elapsed_ms)
            latencies.append(round(elapsed_ms, 3))
            row_count = actual_rows or row_count

        return {
            "rows": row_count,
            "avg_ms": round(sum(latencies) / len(latencies), 3),
            "median_ms": round(median(latencies), 3),
            "min_ms": round(min(latencies), 3),
            "max_ms": round(max(latencies), 3),
            "runs": latencies,
        }

    async with simulation_manager.maintenance_lock:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                # Avoid benchmark endpoint hanging indefinitely on expensive plans.
                await cur.execute("SET LOCAL statement_timeout = '10000ms'")
                reference_time = await fetch_reference_time(cur, normalized_symbol)
                logger.info("Benchmark reference time for symbol=%s: %s", normalized_symbol, reference_time)

                benchmark_cases = [
                    {
                        "id": "latest_tick_lookup",
                        "label": "Latest Tick Lookup",
                        "plain_sql": """
                            SELECT time, symbol, price::float8 AS price, volume
                            FROM market_ticks_plain
                            WHERE symbol = %s
                            ORDER BY time DESC
                            LIMIT 1
                        """,
                        "hypertable_sql": """
                            SELECT time, symbol, price::float8 AS price, volume
                            FROM market_ticks
                            WHERE symbol = %s
                            ORDER BY time DESC
                            LIMIT 1
                        """,
                        "cagg_sql": None,
                        "params": (normalized_symbol,),
                    },
                    {
                        "id": "window_scan",
                        "label": "Window Range Scan",
                        "plain_sql": """
                            SELECT time, symbol, price::float8 AS price, volume
                            FROM market_ticks_plain
                            WHERE symbol = %s
                              AND time >= %s - %s::interval
                            ORDER BY time DESC
                        """,
                        "hypertable_sql": """
                            SELECT time, symbol, price::float8 AS price, volume
                            FROM market_ticks
                            WHERE symbol = %s
                              AND time >= %s - %s::interval
                            ORDER BY time DESC
                        """,
                        "cagg_sql": None,
                        "params": (normalized_symbol, reference_time, interval),
                    },
                    {
                        "id": "ohlcv_1m",
                        "label": "1m OHLC Aggregate",
                        "plain_sql": """
                            SELECT
                                time_bucket(INTERVAL '1 minute', time) AS bucket,
                                first(price, time) AS open,
                                max(price) AS high,
                                min(price) AS low,
                                last(price, time) AS close,
                                sum(volume) AS volume
                            FROM market_ticks_plain
                            WHERE symbol = %s
                              AND time >= %s - %s::interval
                            GROUP BY bucket
                            ORDER BY bucket DESC
                        """,
                        "hypertable_sql": """
                            SELECT
                                time_bucket(INTERVAL '1 minute', time) AS bucket,
                                first(price, time) AS open,
                                max(price) AS high,
                                min(price) AS low,
                                last(price, time) AS close,
                                sum(volume) AS volume
                            FROM market_ticks
                            WHERE symbol = %s
                              AND time >= %s - %s::interval
                            GROUP BY bucket
                            ORDER BY bucket DESC
                        """,
                        "cagg_sql": """
                            SELECT bucket, open, high, low, close, volume
                            FROM ohlcv_1m
                            WHERE symbol = %s
                              AND bucket >= %s - %s::interval
                            ORDER BY bucket DESC
                        """,
                        "params": (normalized_symbol, reference_time, interval),
                    },
                ]

                case_results: list[dict] = []
                for benchmark_case in benchmark_cases:
                    plain_stats = await query_stats(cur, benchmark_case["plain_sql"], benchmark_case["params"])
                    hypertable_stats = await query_stats(cur, benchmark_case["hypertable_sql"], benchmark_case["params"])
                    cagg_stats = None
                    if benchmark_case["cagg_sql"]:
                        cagg_stats = await query_stats(cur, benchmark_case["cagg_sql"], benchmark_case["params"])

                    hypertable_speedup = (
                        round(plain_stats["median_ms"] / hypertable_stats["median_ms"], 2)
                        if hypertable_stats["median_ms"] > 0
                        else None
                    )
                    cagg_speedup = (
                        round(plain_stats["median_ms"] / cagg_stats["median_ms"], 2)
                        if cagg_stats and cagg_stats["median_ms"] > 0
                        else None
                    )

                    case_results.append(
                        {
                            "id": benchmark_case["id"],
                            "label": benchmark_case["label"],
                            "plain": plain_stats,
                            "hypertable": hypertable_stats,
                            "continuous_aggregate": cagg_stats,
                            "speedup": {
                                "hypertable_vs_plain": hypertable_speedup,
                                "cagg_vs_plain": cagg_speedup,
                            },
                        }
                    )

    hypertable_speedups = [
        result["speedup"]["hypertable_vs_plain"]
        for result in case_results
        if result["speedup"]["hypertable_vs_plain"] is not None
    ]
    cagg_speedups = [
        result["speedup"]["cagg_vs_plain"]
        for result in case_results
        if result["speedup"]["cagg_vs_plain"] is not None
    ]

    avg_hypertable_speedup = round(sum(hypertable_speedups) / len(hypertable_speedups), 2) if hypertable_speedups else None
    avg_cagg_speedup = round(sum(cagg_speedups) / len(cagg_speedups), 2) if cagg_speedups else None

    best_hypertable_case = max(
        (result for result in case_results if result["speedup"]["hypertable_vs_plain"] is not None),
        key=lambda result: result["speedup"]["hypertable_vs_plain"],
        default=None,
    )

    aggregate_case = next((case for case in case_results if case["id"] == "ohlcv_1m"), None)
    legacy_plain_ms = aggregate_case["plain"]["avg_ms"] if aggregate_case else None
    legacy_hypertable_ms = aggregate_case["hypertable"]["avg_ms"] if aggregate_case else None
    legacy_cagg_ms = (
        aggregate_case["continuous_aggregate"]["avg_ms"]
        if aggregate_case and aggregate_case["continuous_aggregate"]
        else None
    )
    legacy_plain_rows = aggregate_case["plain"]["rows"] if aggregate_case else 0
    legacy_hypertable_rows = aggregate_case["hypertable"]["rows"] if aggregate_case else 0
    legacy_cagg_rows = (
        aggregate_case["continuous_aggregate"]["rows"]
        if aggregate_case and aggregate_case["continuous_aggregate"]
        else 0
    )

    legacy_speedup_vs_plain = (
        round(legacy_plain_ms / legacy_hypertable_ms, 2)
        if legacy_plain_ms and legacy_hypertable_ms and legacy_hypertable_ms > 0
        else None
    )
    legacy_speedup_cagg_vs_plain = (
        round(legacy_plain_ms / legacy_cagg_ms, 2)
        if legacy_plain_ms and legacy_cagg_ms and legacy_cagg_ms > 0
        else None
    )

    return {
        "symbol": normalized_symbol,
        "window": interval,
        "runs": runs,
        "cases": case_results,
        "summary": {
            "avg_hypertable_speedup": avg_hypertable_speedup,
            "avg_cagg_speedup": avg_cagg_speedup,
            "best_hypertable_case": {
                "id": best_hypertable_case["id"],
                "label": best_hypertable_case["label"],
                "speedup": best_hypertable_case["speedup"]["hypertable_vs_plain"],
            }
            if best_hypertable_case
            else None,
        },
        # Legacy fields preserved for compatibility with older UI clients.
        "rows": {
            "plain": legacy_plain_rows,
            "hypertable": legacy_hypertable_rows,
            "continuous_aggregate": legacy_cagg_rows,
        },
        "latency_ms": {
            "plain": legacy_plain_ms,
            "hypertable": legacy_hypertable_ms,
            "continuous_aggregate": legacy_cagg_ms,
        },
        "speedup": {
            "hypertable_vs_plain": legacy_speedup_vs_plain,
            "cagg_vs_plain": legacy_speedup_cagg_vs_plain,
        },
    }
