"""
ZeroTrace — PayPal SDK Capture Router
======================================
Endpoints:
  POST /paypal/create-order
  POST /paypal/capture-order/{order_id}
  GET  /paypal/presets

Flow:
  Frontend PayPal button → createOrder hits /paypal/create-order
  User approves in PayPal popup
  onApprove hits /paypal/capture-order/{order_id} with form values as body
  Backend captures → maps form to PaySim features → fraud score → ZK proof → on-chain → DB

Required .env keys:
  PAYPAL_CLIENT_ID
  PAYPAL_CLIENT_SECRET
  PAYPAL_BASE_URL  (default: https://api-m.sandbox.paypal.com)
"""

from __future__ import annotations
from routes.fraud import suspicious_preset


import logging
import os
import random
import time
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Env ───────────────────────────────────────────────────────────────────────
PAYPAL_CLIENT_ID     = os.getenv("PAYPAL_CLIENT_ID", "")
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET", "")
PAYPAL_BASE_URL      = os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")

# ── Token cache ───────────────────────────────────────────────────────────────
_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


# ═══════════════════════════════════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════════════════════════════════

def _get_access_token() -> str:
    if time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    resp = httpx.post(
        f"{PAYPAL_BASE_URL}/v1/oauth2/token",
        auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
        data={"grant_type": "client_credentials"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"]      = data["access_token"]
    _token_cache["expires_at"] = time.time() + data.get("expires_in", 32400)
    return _token_cache["token"]


def _auth_headers() -> dict:
    return {
        "Authorization": f"Bearer {_get_access_token()}",
        "Content-Type":  "application/json",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Request models
# ═══════════════════════════════════════════════════════════════════════════════

class CreateOrderRequest(BaseModel):
    amount: float = 25.00
    currency: str = "USD"


class CaptureRequest(BaseModel):
    amount: float           = 25.0
    display_amount: float   = 0.0
    type_encoded: float     = 3.0
    oldbalanceOrg: float    = 0.0
    newbalanceOrig: float   = 0.0
    oldbalanceDest: float   = 0.0
    newbalanceDest: float   = 0.0
    errorBalanceOrig: float = 0.0
    errorBalanceDest: float = 0.0
    isFlaggedFraud: float          = 0.0
    pre_normalized: bool           = False
    display_oldbalanceOrg:  float  = 0.0
    display_newbalanceOrig: float  = 0.0
    display_oldbalanceDest: float  = 0.0
    display_newbalanceDest: float  = 0.0

# ═══════════════════════════════════════════════════════════════════════════════
# POST /paypal/create-order
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/create-order")
def create_order(body: CreateOrderRequest):
    """
    Called by frontend PayPal button's createOrder callback.
    Creates a PayPal order and returns the order_id.
    """
    payload = {
        "intent": "CAPTURE",
        "purchase_units": [{
            "amount": {
                "currency_code": body.currency,
                "value": f"{body.amount:.2f}",
            },
            "description": "ZeroTrace fraud-scored payment",
        }],
        "application_context": {
            "brand_name": "ZeroTrace",
            "user_action": "PAY_NOW",
        },
    }
    try:
        resp = httpx.post(
            f"{PAYPAL_BASE_URL}/v2/checkout/orders",
            headers=_auth_headers(),
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        data     = resp.json()
        order_id = data["id"]
        logger.info(f"PayPal order created | order_id={order_id} | amount={body.amount}")
        return {"order_id": order_id}
    except httpx.HTTPStatusError as e:
        logger.error(f"PayPal create-order failed: {e.response.text}")
        raise HTTPException(status_code=502, detail="PayPal create-order failed")


# ═══════════════════════════════════════════════════════════════════════════════
# POST /paypal/capture-order/{order_id}
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/capture-order/{order_id}")
async def capture_order(
    order_id: str,
    body: CaptureRequest = None,
    db: Session = Depends(get_db),
):
    """
    Called by frontend PayPal button's onApprove callback.
    1. Captures the PayPal order
    2. Maps form values → PaySim feature vector
    3. Scores via fraud module
    4. Saves to DB with source='paypal'
    5. Returns fraud result to frontend
    """
    # ── 1. Capture ────────────────────────────────────────────────────────
    try:
        resp = httpx.post(
            f"{PAYPAL_BASE_URL}/v2/checkout/orders/{order_id}/capture",
            headers=_auth_headers(),
            json={},
            timeout=20,
        )
        resp.raise_for_status()
        capture_data = resp.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"PayPal capture failed | order_id={order_id} | {e.response.text}")
        raise HTTPException(status_code=502, detail="PayPal capture failed")

    logger.info(f"PayPal order captured | order_id={order_id} | status={capture_data.get('status')}")

    # ── 2. Import fraud module ────────────────────────────────────────────
    try:
        from routes.fraud import feature_names, score_transaction
    except ImportError as exc:
        logger.error(f"Could not import fraud module: {exc}")
        raise HTTPException(status_code=500, detail="Scoring unavailable")

    # ── 3. Map form values to PaySim model features ───────────────────────
    logger.info(f"Capture body received: {body}")
    if body:
        feature_vector = _map_form_to_features(body, feature_names)
        logger.info(f"Feature vector: {feature_vector}")
        print("DEBUG BODY:", body)          # ← add this
        print("DEBUG VECTOR:", feature_vector) 
    else:
        feature_vector = _map_capture_fallback(capture_data, feature_names)
        logger.warning("No body received — using fallback!")

    # ── 4. Score ──────────────────────────────────────────────────────────
    try:
        result = await score_transaction(tx=feature_vector, db=db)
    except Exception as exc:
        logger.error(f"Fraud scoring failed | order_id={order_id} | {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Scoring failed")

    # ── 5. Patch source to 'paypal' ───────────────────────────────────────
    try:
        from models import Transaction
        tx_uuid = uuid.UUID(result["transaction_id"])
        db_tx   = db.query(Transaction).filter(Transaction.id == tx_uuid).first()
        if db_tx:
            db_tx.source = "paypal"
            db.commit()
    except Exception as exc:
        logger.warning(f"Could not patch source: {exc}")

    logger.info(
        f"Capture scored | order_id={order_id} "
        f"| score={result['fraud_score']} | is_fraud={result['is_fraud']}"
    )

    return {
        "status":         "captured",
        "order_id":       order_id,
        "transaction_id": result["transaction_id"],
        "fraud_score":    result["fraud_score"],
        "is_fraud":       result["is_fraud"],
        "confidence":     result["confidence"],
        "risk_factors":   result.get("risk_factors", []),
        "explanation":    result.get("explanation", ""),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# GET /paypal/presets
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/presets")
def get_presets(cap: float = None):
    """
    Generates a fresh realistic Normal and Suspicious transaction every call
    using the scaler's min/max from real PaySim training data.
    Every button click = different values, all grounded in real distributions.
    Returns both normalized values (for model) and display values (for UI).
    """
    from routes.fraud import scaler

    # scaler has data_min_ and data_max_ for each numerical col
    # order: amount, oldbalanceOrg, newbalanceOrig, oldbalanceDest, newbalanceDest, errorBalanceOrig, errorBalanceDest
    mins = scaler.data_min_
    maxs = scaler.data_max_

    def rand_norm(i, lo=0.0, hi=1.0):
        """Return a normalized value (0-1) within lo-hi fraction of feature i's range."""
        low  = float(mins[i]) + (float(maxs[i]) - float(mins[i])) * lo
        high = float(mins[i]) + (float(maxs[i]) - float(mins[i])) * hi
        raw  = random.uniform(low, high)
        return round((raw - float(mins[i])) / (float(maxs[i]) - float(mins[i]) + 1e-9), 6)

    def denorm(norm_val, i):
        """Convert normalized 0-1 value back to real dollar amount for display."""
        return round(float(mins[i]) + norm_val * (float(maxs[i]) - float(mins[i])), 2)

    def norm(raw_val, i):
        """Convert a raw dollar amount to normalized 0-1 for the model."""
        return round((raw_val - float(mins[i])) / (float(maxs[i]) - float(mins[i]) + 1e-9), 6)

    def rand_digits(min_digits, max_digits):
        """Return a random float amount with digit count randomly chosen in range."""
        digits = random.randint(min_digits, max_digits)
        lo = 10 ** (digits - 1)
        hi = 10 ** digits - 1
        return round(random.uniform(lo, hi), 2)

    # ── Normal — random type, random 2–6 digit amount ────────────────────
    normal_type    = random.choice([0, 2, 3, 4])        # CASH_IN, DEBIT, PAYMENT, TRANSFER
    amt_max = min(float(maxs[0]), cap) if cap else float(maxs[0])
    normal_disp_amt = round(random.uniform(10, amt_max), 2)
    normal_amount  = norm(normal_disp_amt, 0)
    normal_old_bal = rand_norm(1, 0.0, 0.3)
    normal_new_bal = round(max(normal_old_bal - normal_amount, 0.0), 6)
    normal_err     = round(abs(normal_new_bal - (normal_old_bal - normal_amount)), 6)
    normal_old_dest = rand_norm(3, 0.0, 0.3)
    normal_new_dest = rand_norm(4, 0.0, 0.3)

    normal = {
        # normalized — for model
        'amount'          : normal_amount,
        'type_encoded'    : normal_type,
        'oldbalanceOrg'   : normal_old_bal,
        'newbalanceOrig'  : normal_new_bal,
        'oldbalanceDest'  : normal_old_dest,
        'newbalanceDest'  : normal_new_dest,
        'errorBalanceOrig': normal_err,
        'errorBalanceDest': round(random.uniform(0.0, 0.00005), 6),
        'isFlaggedFraud'  : 0,
        # display — real dollar amounts for UI
        'display_amount'        : normal_disp_amt,
        'display_oldbalanceOrg' : denorm(normal_old_bal,  1),
        'display_newbalanceOrig': denorm(normal_new_bal,  2),
        'display_oldbalanceDest': denorm(normal_old_dest, 3),
        'display_newbalanceDest': denorm(normal_new_dest, 4),
    }

    # ── Suspicious — CASH_OUT/TRANSFER, realistic fraud pattern ──────────
    sus_disp_amt      = round(random.uniform(10, amt_max), 2)
    sus_amount        = norm(sus_disp_amt, 0)
    sus_disp_old_bal  = round(sus_disp_amt * random.uniform(1.0, 1.5), 2)  # sender had slightly more
    sus_old_bal       = norm(sus_disp_old_bal, 1)
    sus_disp_old_dest = round(random.uniform(50000, 300000), 2)
    sus_old_dest      = norm(sus_disp_old_dest, 3)
    suspicious = {
        # normalized — for model
        'amount'          : sus_amount,
        'type_encoded'    : random.choice([1, 4]),       # CASH_OUT or TRANSFER
        'oldbalanceOrg'   : sus_old_bal,
        'newbalanceOrig'  : 0.0,                         # account drained
        'oldbalanceDest'  : sus_old_dest,
        'newbalanceDest'  : sus_old_dest,                # receiver balance unchanged — money never arrived
        'errorBalanceOrig': sus_old_bal,
        'errorBalanceDest': round(sus_old_dest + sus_amount, 6),
        'isFlaggedFraud'  : 1,
        # display — real dollar amounts for UI
        'display_amount'        : sus_disp_amt,
        'display_oldbalanceOrg' : sus_disp_old_bal,
        'display_newbalanceOrig': 0.0,
        'display_oldbalanceDest': sus_disp_old_dest,
        'display_newbalanceDest': sus_disp_old_dest,     # receiver balance unchanged
    }

    return {
        "normal":     normal,
        "suspicious": suspicious,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Feature mapping helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _map_form_to_features(body: CaptureRequest, feature_names: list) -> dict:
    """Map Pay form values directly to PaySim model features."""
    pre_norm = body.pre_normalized
    if pre_norm:
        amt     = body.amount
        oldOrg  = body.oldbalanceOrg
        newOrg  = body.newbalanceOrig
        oldDest = body.oldbalanceDest
        newDest = body.newbalanceDest
        errOrig = body.errorBalanceOrig
        errDest = body.errorBalanceDest
    else:
        from routes.fraud import scaler
        mins = scaler.data_min_
        maxs = scaler.data_max_

        def norm(val, i):
            return round((val - float(mins[i])) / (float(maxs[i]) - float(mins[i]) + 1e-9), 6)

        amt     = norm(body.amount,         0)
        oldOrg  = norm(body.oldbalanceOrg,  1)
        newOrg  = norm(body.newbalanceOrig, 2)
        oldDest = norm(body.oldbalanceDest, 3)
        newDest = norm(body.newbalanceDest, 4)
        errOrig = norm(abs(body.newbalanceOrig - (body.oldbalanceOrg - body.amount)), 5)
        errDest = norm(abs(body.newbalanceDest - (body.oldbalanceDest + body.amount)), 6)

    return {
        'amount'          : amt,
        'display_amount'  : body.display_amount or body.amount,
        'type_encoded'    : body.type_encoded,
        'oldbalanceOrg'   : oldOrg,
        'newbalanceOrig'  : newOrg,
        'oldbalanceDest'  : oldDest,
        'newbalanceDest'  : newDest,
        'errorBalanceOrig': errOrig,
        'errorBalanceDest': errDest,
        'isFlaggedFraud'         : body.isFlaggedFraud,
        '_pre_normalized'        : True,
        'display_oldbalanceOrg'  : body.display_oldbalanceOrg,
        'display_newbalanceOrig' : body.display_newbalanceOrig,
        'display_oldbalanceDest' : body.display_oldbalanceDest,
        'display_newbalanceDest' : body.display_newbalanceDest,
    }


def _map_capture_fallback(capture: dict, feature_names: list) -> dict:
    """
    Fallback when no form body is sent.
    Extracts amount from PayPal capture response, zeros everything else.
    """
    units    = capture.get("purchase_units", [{}])
    payments = units[0].get("payments", {}) if units else {}
    captures = payments.get("captures", [{}])
    cap      = captures[0] if captures else {}
    try:
        amount = float(cap.get("amount", {}).get("value", 0))
    except (TypeError, ValueError):
        amount = 0.0
    return {f: amount if f == 'amount' else 0.0 for f in feature_names}