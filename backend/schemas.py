# backend/schemas.py
# Pydantic v2 schemas — request/response shapes for the API
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── ZK Proof schema ───────────────────────────────────────────────────────────
class ZKProofOut(BaseModel):
    proof: dict | None = None
    public_signals: list | None = None
    verified: bool = False
    error: str | None = None
    onchain_tx_hash: str | None = None
    onchain_block: int | None = None

    model_config = {"from_attributes": True}


# ── /fraud/score ── Request ───────────────────────────────────────────────────
class FraudScoreRequest(BaseModel):
    # Kaggle PCA features
    V1:  float; V2:  float; V3:  float; V4:  float
    V5:  float; V6:  float; V7:  float; V8:  float
    V9:  float; V10: float; V11: float; V12: float
    V13: float; V14: float; V15: float; V16: float
    V17: float; V18: float; V19: float; V20: float
    V21: float; V22: float; V23: float; V24: float
    V25: float; V26: float; V27: float; V28: float

    Amount: float = Field(..., ge=0)
    Hour:   int   = Field(..., ge=0, le=23)


# ── /fraud/score ── Response ──────────────────────────────────────────────────
class FraudScoreResponse(BaseModel):
    transaction_id: uuid.UUID
    fraud_score:    float
    is_fraud:       bool
    risk_factors:   List[str]
    explanation:    str
    confidence:     str
    zk_proof:       Optional[ZKProofOut] = None

    model_config = {"from_attributes": True}


# ── /transactions ── list item ────────────────────────────────────────────────
class TransactionOut(BaseModel):
    id:              uuid.UUID
    created_at:      datetime
    amount:          Optional[float] = None
    fraud_score:     float
    is_fraud:        bool
    confidence:      str
    risk_factors:    Optional[List[str]]
    explanation:     Optional[str]
    source:          str
    zk_proof:        Optional[ZKProofOut] = None
    type:            Optional[str]   = None
    oldbalanceOrg:   Optional[float] = None
    newbalanceOrig:  Optional[float] = None
    oldbalanceDest:  Optional[float] = None
    newbalanceDest:  Optional[float] = None


# ── /transactions ── paginated list ──────────────────────────────────────────
class TransactionListResponse(BaseModel):
    total:        int
    page:         int
    page_size:    int
    transactions: List[TransactionOut]