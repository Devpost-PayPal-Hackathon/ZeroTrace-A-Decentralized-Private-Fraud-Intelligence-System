# ZeroTrace

**Decentralized Private Fraud Intelligence System**

A real-time payment fraud detection system using ML, Zero-Knowledge Proofs, and blockchain attestation, built with integration of the PayPal Developer Platform.

---

## What it does

ZeroTrace scores every payment at the moment of capture. If a transaction is flagged as fraud, it generates a Groth16 zero-knowledge proof of the verdict and submits it on-chain — permanently, without exposing any raw transaction data.

Three problems it solves:
- Fraud scores are opaque — ZeroTrace proves the verdict cryptographically
- Raw data gets shared with detection services — ZeroTrace reveals nothing except the outcome
- Fraud verdicts are mutable — ZeroTrace anchors them on-chain, immutably

---

## Stack

- **ML** — RandomForest classifier, trained on 200k domain-aware simulated transactions
- **ZK Proofs** — Circom 2.0 + snarkjs, Groth16 proving scheme
- **Blockchain** — Solidity smart contracts, Hardhat, local Ethereum node, web3.py
- **Backend** — FastAPI, SQLAlchemy, SQLite
- **Frontend** — React, AG Grid, Recharts
- **Payments** — PayPal JS SDK + PayPal REST API

---

## Project Structure

```
zerotrace/
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── blockchain.py
│   ├── routes/
│   │   ├── fraud.py
│   │   └── paypal.py
│   ├── ml/
│   │   ├── generate_fraud_data.py
│   │   ├── train.py
│   │   ├── analyze.py
│   │   └── model_own.pkl
│   └── zk/
│       ├── fraud_threshold.circom
│       ├── fraud_threshold_final.zkey
│       ├── verification_key.json
│       └── fraud_threshold_js/
├── contracts/
│   ├── sols/
│   │   ├── FraudRegistry.sol
│   │   └── Verifier.sol
│   ├── scripts/
│   │   └── deploy_contract.js
│   └── hardhat.config.ts
├── frontend/
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── TransactionGrid.jsx
│           ├── FraudExplainer.jsx
│           ├── StatsBar.jsx
│           ├── ChartsPanel.jsx
│           └── CSVUpload.jsx
└── scripts/
    └── seed_transactions.py
```

---

## How to run

### 1. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in your PayPal credentials.

```bash
uvicorn main:app --reload
```

### 2. Contracts

```bash
cd contracts
npm install
npx hardhat node
npx hardhat run scripts/deploy_contract.js --network localhost
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Data and Model

The ML model is trained on domain-aware simulated data, not real transaction data. The simulation encodes actual financial invariants — balance consistency rules — so every fraud label is mathematically guaranteed, not statistically approximated.

To regenerate the dataset and retrain:

```bash
cd backend/ml
python generate_fraud_data.py
python train.py
```

---

## ZK Circuit

The Circom circuit proves that a fraud score crossed the 0.75 threshold without revealing the score itself.

To recompile the circuit from scratch:
1. Download circom for your OS from https://github.com/iden3/circom/releases
2. Run `circom fraud_threshold.circom --r1cs --wasm --sym`
3. Run the trusted setup using snarkjs and `pot12_final.ptau`
4. Export `fraud_threshold_final.zkey` and `verification_key.json`

---

## Authors

- **Devpal Singh Anand** — Independent Researcher & Developer
- **Samridhi Gupta** — Independent Contributor

---

## Submission

PayPal AI Hackathon 2026 — Submission Deadline: November 13, 2026
