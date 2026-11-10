#!/bin/bash
set -e

echo "Starting Hardhat node..."
cd contracts
npx hardhat node --hostname 127.0.0.1 &
NODE_PID=$!

echo "Waiting for node to be ready..."
sleep 5

echo "Deploying contracts..."
npx hardhat run scripts/deploy_contract.js --network localhost

echo "Starting FastAPI backend..."
cd ../backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port $PORT

wait $NODE_PID