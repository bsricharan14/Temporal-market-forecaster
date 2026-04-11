from time import perf_counter
from pathlib import Path
from statistics import median

from fastapi import APIRouter, Query

from app.db.connection import get_connection_pool
from app.services.simulation import simulation_manager

router = APIRouter(prefix="/market", tags=["market"])
TICK_DATA_DIR = Path(__file__).resolve().parents[4] / "tick data"


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
    window_minutes: int = Query(default=60, ge=1, le=1440),
    runs: int = Query(default=3, ge=1, le=10),
):
    pool = await get_connection_pool()

    async def timed_query(cur, sql: str, params: tuple):
        run_latencies: list[float] = []
        row_count = 0

        for _ in range(runs):
            start = perf_counter()
            await cur.execute(sql, params)
            rows = await cur.fetchall()
            elapsed_ms = (perf_counter() - start) * 1000
            run_latencies.append(elapsed_ms)
            row_count = len(rows)

        avg_ms = sum(run_latencies) / len(run_latencies)
        median_ms = median(run_latencies)
        min_ms = min(run_latencies)
        max_ms = max(run_latencies)

        return {
            "rows": row_count,
            "avg_ms": round(avg_ms, 3),
            "median_ms": round(median_ms, 3),
            "min_ms": round(min_ms, 3),
            "max_ms": round(max_ms, 3),
            "runs": [round(value, 3) for value in run_latencies],
        }

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
            "params": (symbol,),
        },
        {
            "id": "window_scan",
            "label": "Window Range Scan",
            "plain_sql": """
                SELECT time, symbol, price::float8 AS price, volume
                FROM market_ticks_plain
                WHERE symbol = %s
                  AND time >= NOW() - (%s * INTERVAL '1 minute')
                ORDER BY time DESC
            """,
            "hypertable_sql": """
                SELECT time, symbol, price::float8 AS price, volume
                FROM market_ticks
                WHERE symbol = %s
                  AND time >= NOW() - (%s * INTERVAL '1 minute')
                ORDER BY time DESC
            """,
            "cagg_sql": None,
            "params": (symbol, window_minutes),
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
                  AND time >= NOW() - (%s * INTERVAL '1 minute')
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
                  AND time >= NOW() - (%s * INTERVAL '1 minute')
                GROUP BY bucket
                ORDER BY bucket DESC
            """,
            "cagg_sql": """
                SELECT bucket, open, high, low, close, volume
                FROM ohlcv_1m
                WHERE symbol = %s
                  AND bucket >= NOW() - (%s * INTERVAL '1 minute')
                ORDER BY bucket DESC
            """,
            "params": (symbol, window_minutes),
        },
    ]

    case_results: list[dict] = []
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            for benchmark_case in benchmark_cases:
                plain_stats = await timed_query(cur, benchmark_case["plain_sql"], benchmark_case["params"])
                hypertable_stats = await timed_query(cur, benchmark_case["hypertable_sql"], benchmark_case["params"])
                cagg_stats = None
                if benchmark_case["cagg_sql"]:
                    cagg_stats = await timed_query(cur, benchmark_case["cagg_sql"], benchmark_case["params"])

                hypertable_speedup = None
                cagg_speedup = None
                if hypertable_stats["median_ms"] > 0:
                    hypertable_speedup = round(plain_stats["median_ms"] / hypertable_stats["median_ms"], 2)
                if cagg_stats and cagg_stats["median_ms"] > 0:
                    cagg_speedup = round(plain_stats["median_ms"] / cagg_stats["median_ms"], 2)

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
        "symbol": symbol,
        "window_minutes": window_minutes,
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
