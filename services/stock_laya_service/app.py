import os
import threading

import laya
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_ID = os.getenv("STOCK_LAYA_MODEL_ID", "Smit1105/stock-laya-qstate")
HF_TOKEN = os.getenv("HF_TOKEN") or None
DEVICE = os.getenv("STOCK_LAYA_DEVICE") or None

app = FastAPI(title="Stock-Laya Q-State Service", version="1.0")
_agent = None
_lock = threading.Lock()


class DecisionRequest(BaseModel):
    state: dict
    questions: dict


def agent():
    global _agent
    if _agent is None:
        with _lock:
            if _agent is None:
                _agent = laya.load(MODEL_ID, device=DEVICE, token=HF_TOKEN)
    return _agent


@app.get("/health")
def health():
    return {
        "status": "OK",
        "model": MODEL_ID,
        "loaded": _agent is not None,
        "device": DEVICE or "auto",
    }


@app.post("/predict")
def predict(req: DecisionRequest):
    try:
        return agent().predict(req.state, req.questions)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
