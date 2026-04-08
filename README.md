# Temporal Market Forecaster

A full-stack starter with:

- Frontend: React + Vite
- Backend: FastAPI
- Database container: PostgreSQL + TimescaleDB (with optional PostgresML)

## Project Structure

- frontend - UI application
- backend - API service
- docker/init - database init SQL (extensions)

## Prerequisites

1. Python 3.10+
2. Node.js 18+
3. npm
4. Docker Desktop (or Docker Engine)

## Quick Start

1. Create backend environment file.
2. Start database with Docker.
3. Start backend API.
4. Start frontend app.

## 1) Backend Environment File

Create backend/.env from backend/.env.example.

Bash:

```bash
cp backend/.env.example backend/.env
```

PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

Set values in backend/.env:

- DB_NAME
- DB_USER
- DB_PASSWORD
- DB_PORT

## 2) Docker Database Setup (TimescaleDB)

Build and start:

```bash
docker compose --env-file ./backend/.env up -d --build
```

Check status:

```bash
docker compose --env-file ./backend/.env ps
```

View logs:

```bash
docker compose --env-file ./backend/.env logs -f db
```

Open psql inside container:

```bash
docker compose --env-file ./backend/.env exec db bash -c 'PGPASSWORD=$POSTGRES_PASSWORD exec psql -h localhost -U $POSTGRES_USER -d $POSTGRES_DB'
```

Verify extensions:

```bash
docker compose --env-file ./backend/.env exec db bash -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U $POSTGRES_USER -d $POSTGRES_DB -c "\\dx"'
```

Stop containers:

```bash
docker compose --env-file ./backend/.env down
```

Reset database completely (removes volume/data):

```bash
docker compose --env-file ./backend/.env down -v
docker compose --env-file ./backend/.env up -d --build
```

## 2.1) Create Schema and Import Tick CSV

Generate CSV (symbol-based filename in tick data folder):

```bash
python "tick data/generate_ticks.py" AAPL --rows 250000
```

Apply schema and import into the running Docker Postgres container:

```bash
python backend/scripts/load_ticks_to_db.py AAPL
```

Note:

- `backend/sql/schema.sql` is now also auto-applied when the DB container starts.
- The Charts page `Start` button can ingest from `tick data/<SYMBOL>_ticks.csv` directly at runtime.
- Use this script when you want to preload all rows immediately.

Optional: load from a custom CSV path or skip schema re-apply.

```bash
python backend/scripts/load_ticks_to_db.py TSLA --csv "tick data/TSLA_ticks.csv"
python backend/scripts/load_ticks_to_db.py TSLA --skip-schema
```

Schema SQL location:

- backend/sql/schema.sql

## 3) Backend Setup (FastAPI)

From backend directory:

Create a virtual environment (recommended and standard practice):

```bash
python -m venv .venv
```

Activate it:

PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Bash:

```bash
source .venv/bin/activate
```

Install dependencies and run API:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

If you prefer not to activate the environment, run directly with its Python executable:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend URL:

http://localhost:8000

## 4) Frontend Setup (React + Vite)

From frontend directory:

```bash
npm install
npm run dev
```

Frontend URL:

http://localhost:5173

## Docker Files Used

- docker-compose.yml - DB service definition
- Dockerfile - TimescaleDB base image
- docker/init/01_extensions.sql - creates timescaledb and conditionally creates pgml if available

## Notes

- The frontend currently renders demo market data.
- Backend routes are scaffolded and ready for incremental integration.
- Vite proxy forwards /api to http://localhost:8000 in development.