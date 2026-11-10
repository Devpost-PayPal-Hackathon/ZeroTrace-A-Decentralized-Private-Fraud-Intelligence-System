#!/bin/bash
set -e

echo "Starting FastAPI backend..."
cd backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} &
FASTAPI_PID=$!

echo "Starting Hardhat node..."
cd ../contracts
npx hardhat node --hostname 127.0.0.1 &
NODE_PID=$!

echo "Waiting for Hardhat node to be ready..."
sleep 10

echo "Deploying contracts..."
npx hardhat run scripts/deploy_contract.js --network localhost

echo "All services running!"
wait $NODE_PID