from fastapi import APIRouter
from app.services import ml_service

router = APIRouter(prefix="/predictions", tags=["predictions"])

@router.post("/train")
async def train_all_models():
    res_trend = await ml_service.train_trend_model()
    res_vol = await ml_service.train_volatility_model()
    res_regime = await ml_service.train_regime_model()
    res_vol_surge = await ml_service.train_volume_surge_model()
    res_gap = await ml_service.train_gap_predictor_model()
    
    return {
        "trend": res_trend,
        "volatility": res_vol,
        "regime": res_regime,
        "volume_surge": res_vol_surge,
        "gap_predictor": res_gap
    }

@router.get("/trend/{symbol}")
async def predict_trend(symbol: str):
    return await ml_service.predict_trend(symbol)

@router.get("/volatility/{symbol}")
async def predict_volatility(symbol: str):
    return await ml_service.predict_volatility(symbol)

@router.get("/regime/{symbol}")
async def identify_regime(symbol: str):
    return await ml_service.predict_regime(symbol)

@router.get("/volume/{symbol}")
async def predict_volume(symbol: str):
    return await ml_service.predict_volume(symbol)

@router.get("/gap/{symbol}")
async def predict_gap(symbol: str):
    return await ml_service.predict_gap(symbol)

@router.get("/all/{symbol}")
async def predict_all(symbol: str):
    preds = [
        await ml_service.predict_trend(symbol),
        await ml_service.predict_volatility(symbol),
        await ml_service.predict_regime(symbol),
        await ml_service.predict_volume(symbol),
        await ml_service.predict_gap(symbol)
    ]
    return {"predictions": preds}
