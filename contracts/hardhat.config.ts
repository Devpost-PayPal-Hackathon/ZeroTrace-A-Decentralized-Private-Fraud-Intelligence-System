import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";

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
            accounts: {
                mnemonic: process.env.HARDHAT_MNEMONIC ??
                    "test test test test test test test test test test test junk",
                count: 20,
            },
        },
        localhost: {
            type: "http" as const,
            chainId: 31337,
            url: process.env.RPC_URL ?? "http://127.0.0.1:8545",
        },
    },

    paths: {
        sources: "./sols",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",
    },
});