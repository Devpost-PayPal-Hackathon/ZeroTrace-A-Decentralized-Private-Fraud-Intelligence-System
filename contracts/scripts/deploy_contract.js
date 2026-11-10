import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    // 1. Deploy Verifier
    console.log("1/2  Deploying Verifier.sol...");
    const VerifierFactory = await ethers.getContractFactory("Verifier");
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();
    const verifierAddress = await verifier.getAddress();
    console.log(`     ✅ Verifier deployed: ${verifierAddress}\n`);

    // 2. Deploy FraudRegistry
    console.log("2/2  Deploying FraudRegistry.sol...");
    const RegistryFactory = await ethers.getContractFactory("FraudRegistry");
    const registry = await RegistryFactory.deploy(verifierAddress);
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log(`     ✅ FraudRegistry deployed: ${registryAddress}\n`);

    // 3. Verify deployment
    console.log("Verifying deployment...");
    const [submissions, verified] = await registry.getStats();
    console.log(`     totalSubmissions : ${submissions}`);
    console.log(`     totalVerified    : ${verified}`);
    console.log(`     verifier address : ${await registry.verifier()}`);
    console.log(`     owner            : ${await registry.owner()}\n`);

    // 4. Save addresses to deployment.json
    const deploymentInfo = {
        network: network.name,
        deployedAt: new Date().toISOString(),
        deployer: deployer.address,
        verifierAddress,
        registryAddress,
    };

    const outPath = path.join(__dirname, "..", "deployment.json");
    fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`📄  Saved to: ${outPath}`);

    // 5. Print .env snippet
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