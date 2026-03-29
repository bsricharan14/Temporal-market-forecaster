import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_FILE = PROJECT_ROOT / "backend" / "sql" / "schema.sql"
DEFAULT_TICK_DIR = PROJECT_ROOT / "tick data"
ENV_FILE = PROJECT_ROOT / "backend" / ".env"
CONTAINER_NAME = "tmf-db"


def run_command(command, *, input_text=None):
    result = subprocess.run(
        command,
        input=input_text,
        text=True,
        capture_output=True,
        shell=False,
    )
    if result.returncode != 0:
        print("Command failed:", " ".join(command), file=sys.stderr)
        if result.stdout:
            print(result.stdout, file=sys.stderr)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        raise RuntimeError("Command execution failed")
    return result


def docker_compose_base_args():
    args = ["docker", "compose"]
    if ENV_FILE.exists():
        args.extend(["--env-file", str(ENV_FILE)])
    return args


def ensure_tools_available():
    if shutil.which("docker") is None:
        raise RuntimeError("Docker CLI not found in PATH")


def ensure_db_container_running():
    args = docker_compose_base_args() + ["ps", "-q", "db"]
    result = run_command(args)
    container_id = result.stdout.strip()
    if not container_id:
        raise RuntimeError(
            "Database container is not running. Start it first with: "
            "docker compose --env-file backend/.env up -d --build"
        )


def run_sql_file_in_container(sql_path):
    sql_content = sql_path.read_text(encoding="utf-8")
    command = [
        "docker",
        "exec",
        "-i",
        CONTAINER_NAME,
        "bash",
        "-lc",
        "PGPASSWORD=$POSTGRES_PASSWORD psql -v ON_ERROR_STOP=1 -h localhost -U $POSTGRES_USER -d $POSTGRES_DB",
    ]
    run_command(command, input_text=sql_content)


def copy_csv_into_container(local_csv_path, remote_csv_path):
    run_command(["docker", "cp", str(local_csv_path), f"{CONTAINER_NAME}:{remote_csv_path}"])


def import_ticks_csv(symbol, remote_csv_path):
    symbol_sql = symbol.replace("'", "''")
    import_sql = f"""
DELETE FROM market_ticks WHERE symbol = '{symbol_sql}';
DELETE FROM market_ticks_plain WHERE symbol = '{symbol_sql}';
COPY market_ticks (time, symbol, price, volume)
FROM '{remote_csv_path}'
WITH (FORMAT csv, HEADER true);
INSERT INTO market_ticks_plain (time, symbol, price, volume)
SELECT time, symbol, price, volume
FROM market_ticks
WHERE symbol = '{symbol_sql}'
ON CONFLICT (symbol, time) DO NOTHING;
CALL refresh_continuous_aggregate('ohlcv_1m', NULL, NULL);
CALL refresh_continuous_aggregate('ohlcv_1h', NULL, NULL);
CALL refresh_continuous_aggregate('ohlcv_1d', NULL, NULL);
"""

    command = [
        "docker",
        "exec",
        "-i",
        CONTAINER_NAME,
        "bash",
        "-lc",
        "PGPASSWORD=$POSTGRES_PASSWORD psql -v ON_ERROR_STOP=1 -h localhost -U $POSTGRES_USER -d $POSTGRES_DB",
    ]
    run_command(command, input_text=import_sql)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create schema and import generated tick CSV into Docker PostgreSQL container."
    )
    parser.add_argument("symbol", help="Symbol to import, for example AAPL")
    parser.add_argument(
        "--csv",
        dest="csv_path",
        default=None,
        help="Optional path to CSV file. Default: tick data/<SYMBOL>_ticks.csv",
    )
    parser.add_argument(
        "--skip-schema",
        action="store_true",
        help="Skip schema.sql execution and only load CSV data.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    symbol = args.symbol.strip().upper()

    if args.csv_path:
        csv_path = Path(args.csv_path).expanduser().resolve()
    else:
        csv_path = (DEFAULT_TICK_DIR / f"{symbol}_ticks.csv").resolve()

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    if not SCHEMA_FILE.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_FILE}")

    ensure_tools_available()
    ensure_db_container_running()

    if not args.skip_schema:
        print(f"Applying schema from {SCHEMA_FILE}...")
        run_sql_file_in_container(SCHEMA_FILE)

    remote_csv_path = f"/tmp/{symbol}_ticks.csv"
    print(f"Copying CSV to container: {csv_path}")
    copy_csv_into_container(csv_path, remote_csv_path)

    print(f"Importing data for symbol {symbol}...")
    import_ticks_csv(symbol, remote_csv_path)

    print("Done. Schema ready and tick data imported successfully.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
