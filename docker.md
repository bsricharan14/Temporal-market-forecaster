# Temporal Market Forecaster 📈
**Team:** The Null Pointers

This repository contains the full stack architecture for our DBMS Term Project. We are utilizing PostgreSQL augmented with TimescaleDB for temporal data processing and PostgresML for in-database predictive analytics.

---

## 🛠️ Local Database Setup Guide

To ensure all team members can work in parallel without stepping on each other's toes, we are using Docker. This creates an isolated, identical database on everyone's local machine. **You do not need to install PostgreSQL on your computer to run this.**

### Prerequisites
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) or Docker Engine (Linux).
2. Ensure the Docker application is open and running in the background.

### Step 1: Configure Environment Variables
Before building the database, you must set up your local credentials.
1. Navigate to the `backend/` folder.
2. Make a copy of the `.env.example` file and rename the copy to exactly `.env`.
3. Open `.env` and ensure the database variables are set (e.g., `DB_USER=user`, `DB_NAME=market_db`, `DB_PASSWORD=password`).

### Step 2: Start the Database Container
Open your terminal at the root of the project repository and run:

```bash
docker compose --env-file ./backend/.env up -d