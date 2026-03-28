# Backend (FastAPI)

## Run

1. Create and activate a Python virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and update values.
4. Start server:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints

- `GET /` - service info
- `GET /market/ticks`
- `GET /market/ohlcv`
- `GET /market/benchmark`
- `GET /predictions/trend`
- `GET /predictions/volatility`
- `GET /predictions/regime`
- `GET /predictions/volume`
- `GET /predictions/gap`

## Notes

Prediction routes are scaffolds and should be implemented in later iterations.
