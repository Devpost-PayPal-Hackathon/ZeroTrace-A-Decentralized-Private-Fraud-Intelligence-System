# backend/main.py
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import paypal, fraud
import uvicorn

from database import engine, Base, SessionLocal
import models   # noqa: F401

Base.metadata.create_all(bind=engine)

app = FastAPI(title="ZeroTrace API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(paypal.router, prefix="/paypal", tags=["PayPal"])
app.include_router(fraud.router,  prefix="/fraud",   tags=["Fraud"])


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok", "service": "ZeroTrace"}


@app.get("/stats")
def stats():
    db = SessionLocal()
    try:
        total    = db.query(models.Transaction).count()
        flagged  = db.query(models.Transaction).filter(
                       models.Transaction.is_fraud == True
                   ).count()
        onchain  = db.query(models.ZKProof).filter(
                       models.ZKProof.onchain_tx_hash != None
                   ).count()
        fraud_rate = round((flagged / total * 100), 2) if total > 0 else 0.0

        return {
            "total_transactions": total,
            "flagged":            flagged,
            "fraud_rate":         fraud_rate,
            "proofs_submitted":   onchain,
        }
    finally:
        db.close()


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)