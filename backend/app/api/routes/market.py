from time import perf_counter

from fastapi import APIRouter, Query

from app.db.connection import get_connection_pool
from app.services.simulation import simulation_manager

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/simulation/{symbol}/status")
async def simulation_status(symbol: str):
    return await simulation_manager.get_status(symbol)


@router.post("/simulation/{symbol}/start")
async def start_simulation(symbol: str):
    return await simulation_manager.start(symbol, restart=False)


@router.post("/simulation/{symbol}/stop")
async def stop_simulation(symbol: str):
    return await simulation_manager.stop(symbol)


@router.post("/simulation/{symbol}/restart")
async def restart_simulation(symbol: str):
    return await simulation_manager.start(symbol, restart=True)


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
async def benchmark(symbol: str = "AAPL", window_minutes: int = Query(default=60, ge=1, le=1440)):
    pool = await get_connection_pool()

    hypertable_sql = """
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
    """

    plain_sql = """
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
    """

    cagg_sql = """
    SELECT bucket, open, high, low, close, volume
    FROM ohlcv_1m
    WHERE symbol = %s
      AND bucket >= NOW() - (%s * INTERVAL '1 minute')
    ORDER BY bucket DESC
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            start = perf_counter()
            await cur.execute(plain_sql, (symbol, window_minutes))
            plain_rows = await cur.fetchall()
            plain_ms = round((perf_counter() - start) * 1000, 3)

            start = perf_counter()
            await cur.execute(hypertable_sql, (symbol, window_minutes))
            hypertable_rows = await cur.fetchall()
            hypertable_ms = round((perf_counter() - start) * 1000, 3)

            start = perf_counter()
            await cur.execute(cagg_sql, (symbol, window_minutes))
            cagg_rows = await cur.fetchall()
            cagg_ms = round((perf_counter() - start) * 1000, 3)

    speedup_vs_plain = round(plain_ms / hypertable_ms, 2) if hypertable_ms > 0 else None
    speedup_cagg_vs_plain = round(plain_ms / cagg_ms, 2) if cagg_ms > 0 else None

    return {
        "symbol": symbol,
        "window_minutes": window_minutes,
        "rows": {
            "plain": len(plain_rows),
            "hypertable": len(hypertable_rows),
            "continuous_aggregate": len(cagg_rows),
        },
        "latency_ms": {
            "plain": plain_ms,
            "hypertable": hypertable_ms,
            "continuous_aggregate": cagg_ms,
        },
        "speedup": {
            "hypertable_vs_plain": speedup_vs_plain,
            "cagg_vs_plain": speedup_cagg_vs_plain,
        },
    }
