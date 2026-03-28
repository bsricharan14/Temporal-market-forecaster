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
docker compose --env-file ./backend/.env exec db psql -U user -d market_db
```

Verify extensions:

```bash
docker compose --env-file ./backend/.env exec db psql -U user -d market_db -c "\dx"
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

## 3) Backend Setup (FastAPI)

From backend directory:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
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