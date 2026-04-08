-- docker/init/02_schema.sql

-- Master table for trading pairs
CREATE TABLE IF NOT EXISTS symbols (
    symbol TEXT PRIMARY KEY
);

-- Table for raw tick data
CREATE TABLE IF NOT EXISTS market_ticks (
    time TIMESTAMPTZ NOT NULL,
    symbol TEXT REFERENCES symbols(symbol),
    price DOUBLE PRECISION NOT NULL,
    volume DOUBLE PRECISION NOT NULL
);

-- Convert standard PostgreSQL table into a TimescaleDB Hypertable partitioned by time
SELECT create_hypertable('market_ticks', by_range('time'));