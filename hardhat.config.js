require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

// ============================================================
//  Validasi environment variables wajib
// ============================================================
const requireEnv = (key) => {
  const val = process.env[key];
  if (!val) {
    // Hanya warning saat development lokal, bukan error fatal
    // supaya `npx hardhat test` tetap bisa jalan tanpa .env lengkap
    console.warn(`⚠️  ENV WARNING: ${key} is not set`);
    return "";
  }
  return val;
};

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "0".repeat(64);
const POLYGONSCAN_KEY = process.env.POLYGONSCAN_API_KEY || "";
const POLYGON_RPC = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
const AMOY_RPC =
  process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // ============================================================
  //  Solidity Compiler
  // ============================================================
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200, // 200 = sweet spot antara deploy cost vs call cost
      },
      viaIR: true, // Aktifkan IR pipeline untuk optimasi lebih dalam
      evmVersion: "paris", // Polygon mendukung hingga paris EVM
    },
  },

  // ============================================================
  //  Networks
  // ============================================================
  networks: {
    // ── Lokal (default untuk `npx hardhat test`) ──────────────
    hardhat: {
      chainId: 31337,
      // Simulasi Polygon mainnet state (opsional, aktifkan jika butuh forking)
      // forking: {
      //   url: POLYGON_RPC,
      //   blockNumber: 55000000,
      // },
    },

    // ── Polygon Amoy Testnet ──────────────────────────────────
    amoy: {
      url: AMOY_RPC,
      chainId: 80002,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gasPrice: "auto",
    },

    // ── Polygon Mainnet ───────────────────────────────────────
    polygon: {
      url: POLYGON_RPC,
      chainId: 137,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gasPrice: "auto",
      // Gas limit eksplisit untuk safety
      gas: 5_000_000,
    },
  },

  // ============================================================
  //  Etherscan / Polygonscan (untuk verifikasi contract)
  // ============================================================
  etherscan: {
    apiKey: {
      polygon: POLYGONSCAN_KEY,
      polygonAmoy: POLYGONSCAN_KEY,
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },

  // ============================================================
  //  Gas Reporter (aktif saat RUN_GAS_REPORTER=true)
  // ============================================================
  gasReporter: {
    enabled: process.env.RUN_GAS_REPORTER === "true",
    currency: "USD",
    coinmarketcap: process.env.CMC_API_KEY || "",
    token: "MATIC",
    gasPriceApi:
      "https://api.polygonscan.com/api?module=proxy&action=eth_gasPrice",
    outputFile: "gas-report.txt",
    noColors: true,
  },

  // ============================================================
  //  Coverage (npx hardhat coverage)
  // ============================================================
  // Dihandle otomatis oleh hardhat-toolbox

  // ============================================================
  //  Paths
  // ============================================================
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
