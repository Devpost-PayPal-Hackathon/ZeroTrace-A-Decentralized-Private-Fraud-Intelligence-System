# backend/blockchain.py
# Connects to FraudRegistry.sol and submits ZK proofs on-chain.
# For local dev: uses Hardhat EDR node (localhost:8545).
# For prod: swap RPC_URL + PRIVATE_KEY in .env for Sepolia.

import os
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEPLOYMENT_PATH = Path(__file__).parent.parent / "contracts" / "deployment.json"
ABI_PATH        = Path(__file__).parent.parent / "contracts" / "artifacts" / "sols" / "FraudRegistry.sol" / "FraudRegistry.json"

def _load_deployment():
    if not DEPLOYMENT_PATH.exists():
        logger.warning("deployment.json not found — blockchain disabled")
        return None, None
    with open(DEPLOYMENT_PATH) as f:
        d = json.load(f)
    return d.get("registryAddress"), d.get("network")

def _load_abi():
    if not ABI_PATH.exists():
        logger.warning("FraudRegistry ABI not found — blockchain disabled")
        return None
    with open(ABI_PATH) as f:
        artifact = json.load(f)
    return artifact.get("abi")

# ── Web3 setup ───────────────────────────────────────────────────────────────
try:
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware

    RPC_URL     = os.getenv("ETH_RPC_URL", "http://127.0.0.1:8545")
    PRIVATE_KEY = os.getenv("DEPLOYER_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

    REGISTRY_ADDRESS, DEPLOY_NETWORK = _load_deployment()
    REGISTRY_ABI = _load_abi()

    if REGISTRY_ADDRESS and REGISTRY_ABI and w3.is_connected():
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(REGISTRY_ADDRESS),
            abi=REGISTRY_ABI,
        )
        account            = w3.eth.account.from_key(PRIVATE_KEY)
        BLOCKCHAIN_ENABLED = True
        logger.info(f"Blockchain enabled — registry at {REGISTRY_ADDRESS}")
    else:
        contract = None
        account  = None
        BLOCKCHAIN_ENABLED = False
        logger.warning("Blockchain disabled — contract or node not available")

except Exception as e:
    w3 = None
    contract = None
    account  = None
    BLOCKCHAIN_ENABLED = False
    logger.warning(f"Blockchain disabled — {e}")


# ── Public API ───────────────────────────────────────────────────────────────

def submit_proof(
    transaction_id: str,
    proof_hash: str,        # hex string — converted to bytes32
    zk_proof: dict,         # {proof: {pi_a, pi_b, pi_c}, public_signals: [...]}
    threshold: int = 75,
) -> dict:
    """
    Submit a ZK proof to FraudRegistry.sol.
    Returns { onchain_tx_hash, onchain_block } or { error }.
    """
    if not BLOCKCHAIN_ENABLED:
        return {"error": "blockchain disabled"}

    try:
        # ── bytes32 txHash ────────────────────────────────────────────────────
        tx_hash_bytes = bytes.fromhex(
            proof_hash.replace("0x", "").ljust(64, "0")[:64]
        )

        # ── Groth16 proof components ──────────────────────────────────────────
        proof  = zk_proof.get("proof") or {}
        pi_a   = proof.get("pi_a", ["0", "0"])[:2]
        pi_b   = proof.get("pi_b", [["0", "0"], ["0", "0"]])[:2]
        pi_c   = proof.get("pi_c", ["0", "0"])[:2]
        sigs   = zk_proof.get("public_signals", ["1", str(threshold)])[:2]

        a   = [int(pi_a[0]), int(pi_a[1])]
        b   = [
            [int(pi_b[0][0]), int(pi_b[0][1])],
            [int(pi_b[1][0]), int(pi_b[1][1])],
        ]
        c   = [int(pi_c[0]), int(pi_c[1])]
        inp = [int(sigs[0]), int(sigs[1])]

        # ── Build + send tx ───────────────────────────────────────────────────
        nonce = w3.eth.get_transaction_count(account.address)
        tx    = contract.functions.submitFraudProof(
            tx_hash_bytes,
            transaction_id,
            threshold,
            a, b, c, inp,
        ).build_transaction({
            "from":     account.address,
            "nonce":    nonce,
            "gas":      500_000,
            "gasPrice": w3.eth.gas_price,
        })

        signed  = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)

        return {
            "onchain_tx_hash": tx_hash.hex(),
            "onchain_block":   receipt.blockNumber,
            "error":           None,
        }

    except Exception as e:
        logger.error(f"submit_proof failed: {e}")
        return {"error": str(e)}


def query_wallet(wallet_hash: str) -> dict:
    """Query whether a txHash is flagged on-chain."""
    if not BLOCKCHAIN_ENABLED:
        return {"flagged": False, "error": "blockchain disabled"}

    try:
        hash_bytes = bytes.fromhex(
            wallet_hash.replace("0x", "").ljust(64, "0")[:64]
        )
        is_flagged = contract.functions.isFlagged(hash_bytes).call()

        result = {"flagged": is_flagged, "error": None}

        if is_flagged:
            rec = contract.functions.getFraudRecord(hash_bytes).call()
            result["transaction_id"] = rec[6]
            result["submitter"]      = rec[1]
            result["timestamp"]      = rec[2]
            result["block_number"]   = rec[3]
            result["zk_verified"]    = rec[4]

        return result

    except Exception as e:
        logger.error(f"query_wallet failed: {e}")
        return {"flagged": False, "error": str(e)}