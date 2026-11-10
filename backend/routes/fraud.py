# backend/routes/fraud.py
import os
import uuid
import pickle
import json
import subprocess
import tempfile
import logging

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Transaction, ZKProof
from schemas import TransactionListResponse, TransactionOut, ZKProofOut

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
ZK_DIR      = os.path.join(os.path.dirname(__file__), '..', 'zk')
ZKEY_PATH   = os.path.join(ZK_DIR, 'fraud_threshold_final.zkey')
WASM_PATH   = os.path.join(ZK_DIR, 'fraud_threshold_js', 'fraud_threshold.wasm')
WITNESS_GEN = os.path.join(ZK_DIR, 'fraud_threshold_js', 'generate_witness.js')
VKEY_PATH   = os.path.join(ZK_DIR, 'verification_key.json')

# ── Load model once at startup ────────────────────────────────────────────────
ML_DIR     = os.path.join(os.path.dirname(__file__), '..', 'ml')
MODEL_PATH = os.path.join(ML_DIR, 'model_own.pkl')

with open(MODEL_PATH, 'rb') as f:
    bundle = pickle.load(f)

model             = bundle['model']
feature_names     = bundle['feature_names']
scaler            = bundle['scaler']
numerical_cols    = bundle['numerical_cols']
normal_preset     = bundle['normal_preset']
suspicious_preset = bundle['suspicious_preset']

print(f"✅ model_own.pkl loaded | Features: {feature_names}")
print(f"numerical_cols order: {numerical_cols}")

# ── Feature labels ────────────────────────────────────────────────────────────
FEATURE_LABELS = {
    'amount'          : 'unusually high transaction amount',
    'type_encoded'    : 'high-risk transaction type (TRANSFER or CASH_OUT)',
    'oldbalanceOrg'   : 'sender account had suspicious pre-transaction balance',
    'newbalanceOrig'  : 'sender account was drained after transaction',
    'oldbalanceDest'  : 'recipient account had suspicious pre-transaction balance',
    'newbalanceDest'  : 'recipient balance did not change after receiving funds',
    'errorBalanceOrig': 'sender balance mismatch — transaction does not add up',
    'errorBalanceDest': 'recipient balance mismatch — funds not reflected correctly',
    'isFlaggedFraud'  : 'transaction flagged by payment system as suspicious',
}

def get_label(feature: str) -> str:
    return FEATURE_LABELS.get(feature, f'anomaly detected in signal {feature}')


# ── ZK proof ──────────────────────────────────────────────────────────────────
def generate_zk_proof(fraud_score: float, threshold: float = 0.75):
    try:
        score_int     = int(fraud_score * 100)
        threshold_int = int(threshold * 100)

        with tempfile.TemporaryDirectory() as tmpdir:
            input_path   = os.path.join(tmpdir, 'input.json')
            witness_path = os.path.join(tmpdir, 'witness.wtns')
            proof_path   = os.path.join(tmpdir, 'proof.json')
            public_path  = os.path.join(tmpdir, 'public.json')

            with open(input_path, 'w') as f:
                json.dump({"fraud_score": score_int, "threshold": threshold_int}, f)

            subprocess.run(
                ['node', WITNESS_GEN, WASM_PATH, input_path, witness_path],
                check=True, capture_output=True
            )
            subprocess.run(
                ['snarkjs', 'groth16', 'prove', ZKEY_PATH, witness_path, proof_path, public_path],
                check=True, capture_output=True, shell=True
            )

            result = subprocess.run(
                ['snarkjs', 'groth16', 'verify', VKEY_PATH, public_path, proof_path],
                capture_output=True, text=True, shell=True
            )

            with open(proof_path) as f:
                proof = json.load(f)
            with open(public_path) as f:
                public_signals = json.load(f)

            return {
                'proof':          proof,
                'public_signals': public_signals,
                'verified':       'OK' in result.stdout,
                'error':          None,
            }

    except Exception as e:
        return {
            'proof':          None,
            'public_signals': None,
            'verified':       False,
            'error':          str(e),
        }


# ═══════════════════════════════════════════════════════════════════════════════
# POST /fraud/score
# ═══════════════════════════════════════════════════════════════════════════════
@router.post("/score")
async def score_transaction(
    tx: dict,
    db: Session = Depends(get_db),
):
    # ── ML scoring ────────────────────────────────────────────────────────
    row    = {f: float(tx.get(f, 0)) for f in feature_names}
    df_row = pd.DataFrame([row])

    # Only normalize if values are raw (not already normalized)
    # Pre-normalized values from presets are already 0-1, skip scaling
    if not tx.get('_pre_normalized', False):
        df_row[numerical_cols] = scaler.transform(df_row[numerical_cols])

    score    = float(model.predict_proba(df_row)[0][1])
    is_fraud = score > 0.75

    weighted = [
        (name, imp * abs(row[name]))
        for name, imp in zip(feature_names, model.feature_importances_)
    ]
    top3         = [name for name, _ in sorted(weighted, key=lambda x: -x[1])[:3]]
    risk_factors = top3

    if is_fraud:
        parts       = [get_label(f) for f in top3]
        explanation = 'Flagged because ' + ', '.join(parts) + '.'
    else:
        explanation = 'Transaction appears legitimate based on current risk signals.'

    confidence = 'high' if score > 0.85 else 'medium' if score > 0.60 else 'low'

    zk_result = None
    if is_fraud:
        zk_result = generate_zk_proof(score)

    # ── Save to DB ────────────────────────────────────────────────────────
    tx_id = uuid.uuid4()

    db_tx = Transaction(
        id           = tx_id,
        features     = {
            **row,
            'display_amount' : tx.get('display_amount', 0),
            'type'           : tx.get('type') or {0:'CASH_IN',1:'CASH_OUT',2:'DEBIT',3:'PAYMENT',4:'TRANSFER'}.get(int(tx.get('type_encoded', 3))),
            'oldbalanceOrg'  : tx.get('display_oldbalanceOrg') or tx.get('oldbalanceOrg'),
            'newbalanceOrig' : tx.get('display_newbalanceOrig') or tx.get('newbalanceOrig'),
            'oldbalanceDest' : tx.get('display_oldbalanceDest') or tx.get('oldbalanceDest'),
            'newbalanceDest' : tx.get('display_newbalanceDest') or tx.get('newbalanceDest'),
        },
        fraud_score  = score,
        is_fraud     = is_fraud,
        confidence   = confidence,
        risk_factors = risk_factors,
        explanation  = explanation,
        source       = 'api',
    )
    db.add(db_tx)
    db.flush()

    db_zk = None
    if zk_result:
        db_zk = ZKProof(
            transaction_id = tx_id,
            proof_json     = zk_result.get('proof') or {},
            public_signals = zk_result.get('public_signals') or [],
            verified       = zk_result.get('verified', False),
            threshold      = 75,
            error          = zk_result.get('error'),
        )
        db.add(db_zk)

    db.commit()

    # ── Submit ZK proof hash to blockchain ────────────────────────────────
    if zk_result and zk_result.get('verified') and db_zk:
        try:
            from blockchain import submit_proof
            import hashlib

            proof_str  = json.dumps(zk_result.get('proof') or {}, sort_keys=True)
            proof_hash = '0x' + hashlib.sha256(proof_str.encode()).hexdigest()

            bc = submit_proof(
                transaction_id = str(tx_id),
                proof_hash     = proof_hash,
                zk_proof       = zk_result,
                threshold      = 75,
            )

            if not bc.get('error'):
                db_zk.onchain_tx_hash = bc['onchain_tx_hash']
                db_zk.onchain_block   = bc['onchain_block']
                db.commit()
                logger.info(f"Proof submitted on-chain: {bc['onchain_tx_hash']}")
            else:
                logger.warning(f"Blockchain submit failed: {bc['error']}")

        except Exception as e:
            logger.warning(f"Blockchain submit skipped: {e}")

    # ── Return ────────────────────────────────────────────────────────────
    return {
        'transaction_id': str(tx_id),
        'fraud_score':    round(score, 4),
        'is_fraud':       is_fraud,
        'risk_factors':   risk_factors,
        'explanation':    explanation,
        'confidence':     confidence,
        'zk_proof':       zk_result,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# GET /fraud/transactions  — paginated list
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/transactions", response_model=TransactionListResponse)
def list_transactions(
    page:       int  = 1,
    page_size:  int  = 50,
    fraud_only: bool = False,
    db: Session = Depends(get_db),
):
    page_size = min(page_size, 10000)
    offset    = (page - 1) * page_size

    query = db.query(Transaction)
    if fraud_only:
        query = query.filter(Transaction.is_fraud == True)

    total = query.count()
    rows  = (
        query
        .order_by(Transaction.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    out = []
    for t in rows:
        zk_out = None
        if t.zk_proof:
            zk_out = ZKProofOut(
                proof           = t.zk_proof.proof_json,
                public_signals  = t.zk_proof.public_signals,
                verified        = t.zk_proof.verified,
                error           = t.zk_proof.error,
                onchain_tx_hash = t.zk_proof.onchain_tx_hash,
                onchain_block   = t.zk_proof.onchain_block,
            )
        out.append(TransactionOut(
            id             = t.id,
            created_at     = t.created_at,
            amount         = (t.features or {}).get('display_amount') or (t.features or {}).get('amount'),
            fraud_score    = t.fraud_score,
            is_fraud       = t.is_fraud,
            confidence     = t.confidence,
            risk_factors   = t.risk_factors,
            explanation    = t.explanation,
            source         = t.source,
            zk_proof       = zk_out,
            type           = (t.features or {}).get('type'),
            oldbalanceOrg  = (t.features or {}).get('oldbalanceOrg'),
            newbalanceOrig = (t.features or {}).get('newbalanceOrig'),
            oldbalanceDest = (t.features or {}).get('oldbalanceDest'),
            newbalanceDest = (t.features or {}).get('newbalanceDest'),
        ))

    return TransactionListResponse(
        total        = total,
        page         = page,
        page_size    = page_size,
        transactions = out,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# GET /fraud/transactions/{transaction_id}  — single record
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/transactions/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    t = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")

    zk_out = None
    if t.zk_proof:
        zk_out = ZKProofOut(
            proof          = t.zk_proof.proof_json,
            public_signals = t.zk_proof.public_signals,
            verified       = t.zk_proof.verified,
            error          = t.zk_proof.error,
        )

    return TransactionOut(
        id             = t.id,
        created_at     = t.created_at,
        amount         = (t.features or {}).get('display_amount') or (t.features or {}).get('amount'),
        fraud_score    = t.fraud_score,
        is_fraud       = t.is_fraud,
        confidence     = t.confidence,
        risk_factors   = t.risk_factors,
        explanation    = t.explanation,
        source         = t.source,
        zk_proof       = zk_out,
        type           = (t.features or {}).get('type'),
        oldbalanceOrg  = (t.features or {}).get('oldbalanceOrg'),
        newbalanceOrig = (t.features or {}).get('newbalanceOrig'),
        oldbalanceDest = (t.features or {}).get('oldbalanceDest'),
        newbalanceDest = (t.features or {}).get('newbalanceDest'),
    )


# ── Delete single transaction ─────────────────────────────────────────────────
@router.delete("/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    t = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(t)
    db.commit()
    return {"deleted": str(transaction_id)}


# ── Delete all transactions ───────────────────────────────────────────────────
@router.delete("/transactions")
def delete_all_transactions(
    db: Session = Depends(get_db),
):
    db.query(ZKProof).delete()
    db.query(Transaction).delete()
    db.commit()
    return {"deleted": "all"}


# ── Explain endpoint ──────────────────────────────────────────────────────────
@router.get("/explain/{tx_id}")
async def explain_transaction(tx_id: str):
    return {"tx_id": tx_id, "explanation": "Not yet scored"}