import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEPLOYMENT_FILE = process.env.DEPLOYMENT_PATH ??
    path.join(__dirname, "..", "deployment.json");

async function isDeployed(ethers, address) {
    if (!address) return false;
    const code = await ethers.provider.getCode(address);
    return code !== "0x";
}

async function main() {
    const { ethers } = await network.connect();
    const [deployer] = await ethers.getSigners();

    console.log("═══════════════════════════════════════════════════");
    console.log("  ZeroTrace — Contract Deployment");
    console.log("═══════════════════════════════════════════════════");
    console.log(`  Network  : ${network.name ?? "hardhat (local)"}`);
    console.log(`  Deployer : ${deployer.address}`);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`  Balance  : ${ethers.formatEther(balance)} ETH`);
    console.log("───────────────────────────────────────────────────\n");

    // Load existing deployment if present
    let existing = {};
    if (fs.existsSync(DEPLOYMENT_FILE)) {
        existing = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
        console.log("  Found existing deployment.json — checking contracts...\n");
    }

    // 1. Deploy Verifier (skip if already deployed)
    let verifierAddress = existing.verifierAddress;
    if (await isDeployed(ethers, verifierAddress)) {
        console.log(`1/2  Skipping Verifier (already at ${verifierAddress})`);
    } else {
        console.log("1/2  Deploying Verifier.sol...");
        const VerifierFactory = await ethers.getContractFactory("Verifier");
        const verifier = await VerifierFactory.deploy();
        await verifier.waitForDeployment();
        verifierAddress = await verifier.getAddress();
        console.log(`     ✅ Verifier deployed: ${verifierAddress}\n`);
    }

    // 2. Deploy FraudRegistry (skip if already deployed)
    let registryAddress = existing.registryAddress;
    if (await isDeployed(ethers, registryAddress)) {
        console.log(`2/2  Skipping FraudRegistry (already at ${registryAddress})`);
    } else {
        console.log("2/2  Deploying FraudRegistry.sol...");
        const RegistryFactory = await ethers.getContractFactory("FraudRegistry");
        const registry = await RegistryFactory.deploy(verifierAddress);
        await registry.waitForDeployment();
        registryAddress = await registry.getAddress();
        console.log(`     ✅ FraudRegistry deployed: ${registryAddress}\n`);
    }

    // 3. Save deployment.json
    const deploymentInfo = {
        network: network.name,
        deployedAt: new Date().toISOString(),
        deployer: deployer.address,
        verifierAddress,
        registryAddress,
    };

    fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\n📄  Saved to: ${DEPLOYMENT_FILE}`);

    console.log("\n───────────────────────────────────────────────────");
    console.log("  Add these to backend/.env:");
    console.log("───────────────────────────────────────────────────");
    console.log(`  REGISTRY_ADDRESS=${registryAddress}`);
    console.log(`  VERIFIER_ADDRESS=${verifierAddress}`);
    console.log("───────────────────────────────────────────────────");
    console.log("\n✅  Deployment complete!\n");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});