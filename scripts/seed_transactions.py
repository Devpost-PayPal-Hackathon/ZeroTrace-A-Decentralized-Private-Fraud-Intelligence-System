"""
seed_transactions.py  —  ZeroTrace v2
Production-ready seeder: calls /fraud/score per transaction.
Every row gets a real ML score, real ZK proof, real on-chain submission.

Usage (run from zerotrace/backend/):
    python scripts/seed_transactions.py
    python scripts/seed_transactions.py --limit 500 --balanced
    python scripts/seed_transactions.py --limit 200 --chunk 50
    python scripts/seed_transactions.py --limit 100 --fraud-only
    python scripts/seed_transactions.py --clear   # wipe DB first, then seed

Requirements:
    - venv must be active
    - Backend must be running on localhost:8000
    - Hardhat node must be running on localhost:8545
"""

import argparse
import json
import sys
import time
from pathlib import Path

import pandas as pd
import numpy as np
import requests

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent / "backend"
CSV_PATH    = BACKEND_DIR / "ml" / "creditcard.csv"
DB_PATH     = BACKEND_DIR / "zerotrace.db"

API_BASE    = "http://localhost:8000"
SCORE_URL   = f"{API_BASE}/fraud/score"
STATS_URL   = f"{API_BASE}/stats"

# ── Helpers ───────────────────────────────────────────────────────────────────

def check_api():
    """Make sure backend is up before starting."""
    try:
        r = requests.get(f"{API_BASE}/health", timeout=5)
        if r.status_code == 200:
            return True
    except Exception:
        pass
    return False


def build_payload(row: pd.Series) -> dict:
    """Convert a creditcard.csv row into a /fraud/score payload."""
    payload = {}
    for i in range(1, 29):
        col = f"V{i}"
        payload[col] = float(row[col]) if col in row.index else 0.0
    payload["Amount"] = float(row["Amount"]) if "Amount" in row.index else 0.0
    payload["Hour"]   = int(float(row["Time"]) // 3600 % 24) if "Time" in row.index else 0
    return payload


def score_row(payload: dict, retries: int = 3) -> dict | None:
    """POST to /fraud/score with retry on failure."""
    for attempt in range(1, retries + 1):
        try:
            r = requests.post(SCORE_URL, json=payload, timeout=30)
            if r.status_code == 200:
                return r.json()
            else:
                print(f"      ⚠️  HTTP {r.status_code} on attempt {attempt}")
        except requests.exceptions.Timeout:
            print(f"      ⚠️  Timeout on attempt {attempt}")
        except requests.exceptions.ConnectionError:
            print(f"      ⚠️  Connection error on attempt {attempt}")
        if attempt < retries:
            time.sleep(1)
    return None


def clear_db():
    """Wipe all seed data from DB (keeps api-sourced transactions)."""
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    deleted_tx = conn.execute(
        "DELETE FROM transactions WHERE source LIKE 'seed%'"
    ).rowcount
    conn.execute(
        """DELETE FROM zk_proofs WHERE transaction_id NOT IN
           (SELECT id FROM transactions)"""
    )
    conn.commit()
    conn.close()
    print(f"🗑️   Cleared {deleted_tx} seed transactions from DB\n")


def get_db_stats():
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    total  = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    fraud  = conn.execute("SELECT COUNT(*) FROM transactions WHERE is_fraud=1").fetchone()[0]
    proofs = conn.execute("SELECT COUNT(*) FROM zk_proofs").fetchone()[0]
    onchain = conn.execute(
        "SELECT COUNT(*) FROM zk_proofs WHERE onchain_tx_hash IS NOT NULL"
    ).fetchone()[0]
    conn.close()
    return total, fraud, proofs, onchain


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    global API_BASE, SCORE_URL, STATS_URL
    parser = argparse.ArgumentParser(description="ZeroTrace production seeder")
    parser.add_argument("--limit",      type=int,   default=200,
                        help="Total rows to seed (default: 200)")
    parser.add_argument("--chunk",      type=int,   default=100,
                        help="Rows per chunk (default: 100)")
    parser.add_argument("--fraud-only", action="store_true",
                        help="Only seed fraud rows")
    parser.add_argument("--balanced",   action="store_true",
                        help="50/50 fraud vs legit split")
    parser.add_argument("--clear",      action="store_true",
                        help="Clear existing seed data before seeding")
    parser.add_argument("--csv",        default=str(CSV_PATH))
    parser.add_argument("--api",        default=API_BASE,
                        help="API base URL (default: http://localhost:8000)")
    args = parser.parse_args()

    API_BASE  = args.api
    SCORE_URL = f"{API_BASE}/fraud/score"
    STATS_URL = f"{API_BASE}/stats"

    print("═" * 60)
    print("  ZeroTrace — Production Seeder v2")
    print("═" * 60)
    print(f"  CSV    : {args.csv}")
    print(f"  DB     : {DB_PATH}")
    print(f"  API    : {SCORE_URL}")
    print(f"  Limit  : {args.limit}")
    print(f"  Chunk  : {args.chunk}")
    print("═" * 60 + "\n")

    # ── Pre-flight checks ──────────────────────────────────────────────────
    print("⏳  Checking API...")
    if not check_api():
        print("❌  Backend not reachable at", SCORE_URL)
        print("    Make sure uvicorn is running: uvicorn main:app --reload")
        sys.exit(1)
    print("✅  API is up\n")

    # ── Clear if requested ─────────────────────────────────────────────────
    if args.clear:
        clear_db()

    # ── Load CSV ───────────────────────────────────────────────────────────
    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"❌  CSV not found: {csv_path}")
        sys.exit(1)

    print("⏳  Loading CSV...")
    df = pd.read_csv(csv_path)
    print(f"    {len(df):,} rows  |  {int(df['Class'].sum()):,} fraud\n")

    # ── Sample ─────────────────────────────────────────────────────────────
    if args.fraud_only:
        df     = df[df["Class"] == 1]
        sample = df.sample(n=min(args.limit, len(df)), random_state=42)
        print(f"    --fraud-only: {len(sample)} rows selected")
    elif args.balanced:
        half     = args.limit // 2
        fraud_df = df[df["Class"] == 1].sample(
            n=min(half, int(df["Class"].sum())), random_state=42)
        legit_df = df[df["Class"] == 0].sample(
            n=min(half, int((df["Class"] == 0).sum())), random_state=42)
        sample   = pd.concat([fraud_df, legit_df]).sample(frac=1, random_state=42)
        print(f"    --balanced: {len(fraud_df)} fraud + {len(legit_df)} legit selected")
    else:
        sample = df.sample(n=min(args.limit, len(df)), random_state=42)
        print(f"    Random sample: {len(sample)} rows selected")

    total_rows   = len(sample)
    chunk_size   = args.chunk
    total_chunks = (total_rows + chunk_size - 1) // chunk_size

    print(f"    {total_chunks} chunk(s) of {chunk_size}\n")

    # ── Seed in chunks ─────────────────────────────────────────────────────
    success   = 0
    failed    = 0
    fraud_hit = 0
    start     = time.time()

    for chunk_idx in range(total_chunks):
        chunk_start = chunk_idx * chunk_size
        chunk_end   = min(chunk_start + chunk_size, total_rows)
        chunk       = sample.iloc[chunk_start:chunk_end]

        print(f"─" * 60)
        print(f"  Chunk {chunk_idx + 1}/{total_chunks}  "
              f"(rows {chunk_start + 1}–{chunk_end} of {total_rows})")
        print(f"─" * 60)

        chunk_success = 0
        chunk_failed  = 0
        chunk_fraud   = 0

        for i, (_, row) in enumerate(chunk.iterrows(), 1):
            payload  = build_payload(row)
            result   = score_row(payload)
            abs_idx  = chunk_start + i

            if result:
                chunk_success += 1
                is_fraud = result.get("is_fraud", False)
                has_proof = result.get("zk_proof") is not None
                if is_fraud:
                    chunk_fraud += 1

                score_str = f"{result.get('fraud_score', 0):.3f}"
                proof_str = "🔐 ZK+chain" if has_proof else "—"
                fraud_str = "🚨 FRAUD" if is_fraud else "✅ legit"

                print(f"  [{abs_idx:>4}/{total_rows}] "
                      f"score={score_str}  {fraud_str}  {proof_str}")
            else:
                chunk_failed += 1
                print(f"  [{abs_idx:>4}/{total_rows}] ❌ FAILED — skipping")

        success   += chunk_success
        failed    += chunk_failed
        fraud_hit += chunk_fraud

        elapsed = time.time() - start
        rate    = success / elapsed if elapsed > 0 else 0
        eta_s   = (total_rows - success - failed) / rate if rate > 0 else 0
        eta_m   = eta_s / 60

        print(f"\n  Chunk {chunk_idx + 1} done: "
              f"{chunk_success} ok, {chunk_failed} failed, {chunk_fraud} fraud")
        print(f"  Overall: {success}/{total_rows} done  |  "
              f"{rate:.1f} tx/s  |  ETA ~{eta_m:.1f} min\n")

    # ── Final stats ────────────────────────────────────────────────────────
    total_time = time.time() - start
    db_total, db_fraud, db_proofs, db_onchain = get_db_stats()

    print("═" * 60)
    print("  ✅  Seeding complete!")
    print("═" * 60)
    print(f"  Rows attempted  : {total_rows}")
    print(f"  Succeeded       : {success}")
    print(f"  Failed          : {failed}")
    print(f"  Fraud scored    : {fraud_hit}")
    print(f"  Time taken      : {total_time:.1f}s  "
          f"({total_time/60:.1f} min)")
    print(f"\n  DB totals:")
    print(f"    transactions  : {db_total}")
    print(f"    flagged       : {db_fraud}")
    print(f"    zk_proofs     : {db_proofs}")
    print(f"    on-chain      : {db_onchain}")
    print("═" * 60)
    print(f"\n  curl {STATS_URL}  ✅\n")


if __name__ == "__main__":
    np.random.seed(42)
    main()