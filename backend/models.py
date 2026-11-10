# backend/models.py
# SQLAlchemy ORM models — two tables:
#   1. transactions  — every scored transaction
#   2. zk_proofs     — ZK proof record linked to a transaction
# ─────────────────────────────────────────────────────────────────────────────

import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Float, Boolean, Integer,
    DateTime, Text, ForeignKey, JSON
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from database import Base


# ── 1. transactions ───────────────────────────────────────────────────────────
class Transaction(Base):
    __tablename__ = "transactions"

    # Primary key — UUID so it's safe to generate client-side too
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # ── Timing ────────────────────────────────────────────────────────────────
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # ── Raw Kaggle PCA features (V1–V28) ─────────────────────────────────────
    # Stored as a JSON dict so the schema survives feature-engineering changes
    # without a migration.  Keys: "V1" … "V28", "Amount", "Hour"
    features = Column(JSON, nullable=False)

    # ── ML scoring results ────────────────────────────────────────────────────
    fraud_score   = Column(Float,   nullable=False)          # 0.0 – 1.0
    is_fraud      = Column(Boolean, nullable=False)
    confidence    = Column(String(16), nullable=False)       # "low" / "medium" / "high"
    risk_factors  = Column(JSON,    nullable=True)           # ["V14", "V17", "V12"]
    explanation   = Column(Text,    nullable=True)

    # ── Source metadata ───────────────────────────────────────────────────────
    source        = Column(String(32), default="api", nullable=False)
    # "api"      = direct POST to /fraud/score
    # "paypal"   = came through PayPal webhook (Week 2)
    # "seeder"   = synthetic seed script

    # ── Relationship to ZK proof ──────────────────────────────────────────────
    # One transaction → at most one ZK proof record
    zk_proof = relationship(
        "ZKProof",
        back_populates="transaction",
        uselist=False,       # one-to-one
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return (
            f"<Transaction id={self.id} "
            f"fraud_score={self.fraud_score:.4f} "
            f"is_fraud={self.is_fraud}>"
        )


# ── 2. zk_proofs ──────────────────────────────────────────────────────────────
class ZKProof(Base):
    __tablename__ = "zk_proofs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )

    # ── Foreign key back to transactions ─────────────────────────────────────
    transaction_id = Column(
        UUID(as_uuid=True),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,         # enforce one-to-one at DB level
        index=True,
    )

    transaction = relationship("Transaction", back_populates="zk_proof")

    # ── Timing ────────────────────────────────────────────────────────────────
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # ── Proof data ────────────────────────────────────────────────────────────
    # Full Groth16 proof object as returned by snarkjs
    # { "pi_a": [...], "pi_b": [[...],[...],[...]], "pi_c": [...],
    #   "protocol": "groth16", "curve": "bn128" }
    proof_json     = Column(JSON, nullable=False)

    # Public signals array — e.g. ["1", "75"]
    public_signals = Column(JSON, nullable=False)

    # Whether snarkjs verified the proof locally
    verified       = Column(Boolean, nullable=False, default=False)

    # Score threshold used (integer, e.g. 75 = 0.75 × 100)
    threshold      = Column(Integer, nullable=False, default=75)

    # ── On-chain fields (filled in Week 2 after Sepolia deploy) ───────────────
    # Ethereum transaction hash after the proof is submitted on-chain
    onchain_tx_hash    = Column(String(66), nullable=True)   # "0x..." (66 chars)

    # Block number where it was confirmed
    onchain_block      = Column(Integer, nullable=True)

    # Sepolia contract address it was submitted to
    contract_address   = Column(String(42), nullable=True)   # "0x..." (42 chars)

    # Any error during proof generation or chain submission
    error              = Column(Text, nullable=True)

    def __repr__(self):
        return (
            f"<ZKProof id={self.id} "
            f"tx={self.transaction_id} "
            f"verified={self.verified} "
            f"onchain={self.onchain_tx_hash is not None}>"
        )