#!/bin/bash
set -e

echo "Starting Hardhat node..."
cd contracts
npx hardhat node --hostname 0.0.0.0 &
NODE_PID=$!

echo "Waiting for node to be ready..."
sleep 5

echo "Deploying contracts..."
npx hardhat run scripts/deploy_contract.js --network localhost

echo "Starting FastAPI backend..."
cd ../backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port $PORT &

echo "All services running!"
wait $NODE_PID