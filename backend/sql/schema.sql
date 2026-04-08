-- Core schema for Temporal Market Forecaster
-- Safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pgml CASCADE;

CREATE TABLE IF NOT EXISTS market_ticks (
    time TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    price NUMERIC(14, 4) NOT NULL,
    volume BIGINT NOT NULL,
    CONSTRAINT market_ticks_pk PRIMARY KEY (symbol, time)
);

SELECT create_hypertable('market_ticks', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_market_ticks_time_desc ON market_ticks (time DESC);
CREATE INDEX IF NOT EXISTS idx_market_ticks_symbol_time_desc ON market_ticks (symbol, time DESC);

CREATE TABLE IF NOT EXISTS market_ticks_plain (
    time TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    price NUMERIC(14, 4) NOT NULL,
    volume BIGINT NOT NULL,
    CONSTRAINT market_ticks_plain_pk PRIMARY KEY (symbol, time)
);

CREATE INDEX IF NOT EXISTS idx_market_ticks_plain_time_desc ON market_ticks_plain (time DESC);
CREATE INDEX IF NOT EXISTS idx_market_ticks_plain_symbol_time_desc ON market_ticks_plain (symbol, time DESC);

DROP MATERIALIZED VIEW IF EXISTS ohlcv_1m;
CREATE MATERIALIZED VIEW ohlcv_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 minute', time) AS bucket,
    symbol,
    first(price, time)::NUMERIC(14, 4) AS open,
    max(price)::NUMERIC(14, 4) AS high,
    min(price)::NUMERIC(14, 4) AS low,
    last(price, time)::NUMERIC(14, 4) AS close,
    sum(volume)::BIGINT AS volume
FROM market_ticks
GROUP BY bucket, symbol
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_ohlcv_1m_symbol_bucket_desc ON ohlcv_1m (symbol, bucket DESC);

SELECT add_continuous_aggregate_policy(
    'ohlcv_1m',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
)
WHERE NOT EXISTS (
    SELECT 1
    FROM timescaledb_information.jobs
    WHERE hypertable_name = 'ohlcv_1m'
);

-- 1-Hour Continuous Aggregate (for Volatility, Volume Surge, and Trend models)
DROP MATERIALIZED VIEW IF EXISTS ohlcv_1h CASCADE;
CREATE MATERIALIZED VIEW ohlcv_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 hour', time) AS bucket,
    symbol,
    first(price, time)::NUMERIC(14, 4) AS open,
    max(price)::NUMERIC(14, 4) AS high,
    min(price)::NUMERIC(14, 4) AS low,
    last(price, time)::NUMERIC(14, 4) AS close,
    sum(volume)::BIGINT AS volume
FROM market_ticks
GROUP BY bucket, symbol
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_ohlcv_1h_symbol_bucket_desc ON ohlcv_1h (symbol, bucket DESC);

SELECT add_continuous_aggregate_policy(
    'ohlcv_1h',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
)
WHERE NOT EXISTS (
    SELECT 1
    FROM timescaledb_information.jobs
    WHERE hypertable_name = 'ohlcv_1h'
);

-- 1-Day Continuous Aggregate (for Next-Day Gap prediction)
DROP MATERIALIZED VIEW IF EXISTS ohlcv_1d CASCADE;
CREATE MATERIALIZED VIEW ohlcv_1d
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 day', time) AS bucket,
    symbol,
    first(price, time)::NUMERIC(14, 4) AS open,
    max(price)::NUMERIC(14, 4) AS high,
    min(price)::NUMERIC(14, 4) AS low,
    last(price, time)::NUMERIC(14, 4) AS close,
    sum(volume)::BIGINT AS volume
FROM market_ticks
GROUP BY bucket, symbol
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_ohlcv_1d_symbol_bucket_desc ON ohlcv_1d (symbol, bucket DESC);

SELECT add_continuous_aggregate_policy(
    'ohlcv_1d',
    start_offset => INTERVAL '365 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day'
)
WHERE NOT EXISTS (
    SELECT 1
    FROM timescaledb_information.jobs
    WHERE hypertable_name = 'ohlcv_1d'
);

-- =========================================
-- In-Database ML Target Engineering Views
-- =========================================

-- View for Hourly ML Models (Next-Candle Trend, Volatility Range, Volume Surge)
CREATE OR REPLACE VIEW ml_features_hourly AS
SELECT
    bucket, symbol, open, high, low, close, volume,
    (high - low) AS current_spread,
    LEAD(CASE WHEN close > open THEN 1 ELSE 0 END) OVER (PARTITION BY symbol ORDER BY bucket) AS target_next_trend_bullish,
    LEAD(high - low) OVER (PARTITION BY symbol ORDER BY bucket) AS target_next_spread,
    LEAD(volume) OVER (PARTITION BY symbol ORDER BY bucket) AS target_next_volume
FROM ohlcv_1h;

-- View for Next-Day Opening Gap Predictor
CREATE OR REPLACE VIEW ml_features_daily AS
SELECT
    bucket, symbol, open, high, low, close, volume,
    LEAD(open) OVER (PARTITION BY symbol ORDER BY bucket) AS next_day_open,
    CASE 
        WHEN LEAD(open) OVER (PARTITION BY symbol ORDER BY bucket) > close THEN 'GAP_UP'
        WHEN LEAD(open) OVER (PARTITION BY symbol ORDER BY bucket) < close THEN 'GAP_DOWN'
        ELSE 'FLAT'
    END AS target_gap_direction
FROM ohlcv_1d;
