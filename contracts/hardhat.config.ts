import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import type { NetworkUserConfig } from "hardhat/types/config";
import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, ".env") });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

const httpNetworks: Record<string, NetworkUserConfig> = SEPOLIA_RPC_URL
    ? {
        sepolia: {
            type: "http" as const,
            url: SEPOLIA_RPC_URL,
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
            chainId: 11155111,
        },
    }
    : {};

export default defineConfig({
    plugins: [hardhatEthers],

    solidity: {
        version: "0.8.19",
        settings: {
            optimizer: { enabled: true, runs: 200 },
        },
    },

    networks: {
        hardhat: {
            type: "edr-simulated" as const,
            chainType: "l1",
        },
    },

    paths: {
        sources: "./sols",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",
    },
});