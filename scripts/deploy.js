/**
 * scripts/deploy.js
 *
 * Script deployment TrustFundEscrow sebagai UUPS Proxy ke Polygon / Amoy testnet.
 *
 * Cara pakai:
 *   Testnet : npx hardhat run scripts/deploy.js --network amoy
 *   Mainnet : npx hardhat run scripts/deploy.js --network polygon
 *
 * Pastikan .env sudah terisi:
 *   DEPLOYER_PRIVATE_KEY=0x...
 *   BACKEND_WALLET=0x...
 *   ADMIN_MULTISIG=0x...
 *   XIDR_TOKEN_ADDRESS=0x...      (XIDR asli di Polygon)
 *   POLYGONSCAN_API_KEY=...       (untuk verifikasi otomatis)
 */

const { ethers, upgrades, network } = require("hardhat");

// ── Alamat XIDR resmi di Polygon Mainnet ──────────────────────────────────────
// Sumber: https://www.xfers.com/sg/straitsx-digital-currencies/xidr
const XIDR_MAINNET = "0x3dc9a42fa7afe57be03c58fd7f4411b1e466c508";

async function main() {
  console.log("═".repeat(60));
  console.log("  TrustFund Escrow — Deployment Script");
  console.log("═".repeat(60));
  console.log(`  Network  : ${network.name}`);
  console.log(`  Chain ID : ${network.config.chainId}`);

  // ── Ambil deployer ──────────────────────────────────────────────────────────
  const [deployer] = await ethers.getSigners();
  const deployerBalance = await ethers.provider.getBalance(deployer.address);

  console.log(`\n  Deployer : ${deployer.address}`);
  console.log(`  Balance  : ${ethers.formatEther(deployerBalance)} MATIC`);

  if (deployerBalance === 0n) {
    throw new Error("❌ Deployer wallet tidak memiliki MATIC untuk gas!");
  }

  // ── Resolve alamat berdasarkan network ─────────────────────────────────────
  const isLocalOrTest = ["hardhat", "localhost"].includes(network.name);

  let xidrAddress;

  if (isLocalOrTest) {
    console.log("\n  Deploying MockXIDR for local testing...");

    const MockXIDR = await ethers.getContractFactory("MockXIDR");
    const mock = await MockXIDR.deploy(deployer.address);
    await mock.waitForDeployment();

    xidrAddress = await mock.getAddress();
    console.log(`  Mock XIDR deployed: ${xidrAddress}`);
  } else {
    xidrAddress = process.env.XIDR_TOKEN_ADDRESS || XIDR_MAINNET;
  }

  const backendWallet = process.env.BACKEND_WALLET;
  const adminMultisig = process.env.ADMIN_MULTISIG;

  // Validasi
  if (!xidrAddress)
    throw new Error("❌ XIDR_TOKEN_ADDRESS tidak diset di .env");
  if (!backendWallet) throw new Error("❌ BACKEND_WALLET tidak diset di .env");
  if (!adminMultisig) throw new Error("❌ ADMIN_MULTISIG tidak diset di .env");

  console.log("\n  Config:");
  console.log(`  ├─ XIDR Token    : ${xidrAddress}`);
  console.log(`  ├─ Backend Wallet: ${backendWallet}`);
  console.log(`  └─ Admin Multisig: ${adminMultisig}`);

  // ── Deploy UUPS Proxy ───────────────────────────────────────────────────────
  console.log("\n  Deploying TrustFundEscrow proxy...");

  const TrustFundEscrow = await ethers.getContractFactory("TrustFundEscrow");

  const proxy = await upgrades.deployProxy(
    TrustFundEscrow,
    [xidrAddress, backendWallet, adminMultisig],
    {
      kind: "uups",
      initializer: "initialize",
      // Timeout lebih panjang untuk mainnet yang congested
      timeout: 120_000,
      pollingInterval: 5_000,
    }
  );

  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);

  console.log("\n  ✅ Deployment Berhasil!");
  console.log("  ─".repeat(30));
  console.log(`  Proxy Address      : ${proxyAddress}`);
  console.log(`  Implementation     : ${implAddress}`);
  console.log(`  ERC1967 Admin      : ${adminAddress}`);

  // ── Simpan hasil deployment ke file JSON ───────────────────────────────────
  const fs = require("fs");
  const deploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    proxyAddress,
    implementationAddress: implAddress,
    xidrToken: xidrAddress,
    backendWallet,
    adminMultisig,
  };

  const outDir = "./deployments";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const outFile = `${outDir}/${network.name}-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n  📄 Deployment info disimpan: ${outFile}`);

  // ── Verifikasi di Polygonscan (skip untuk lokal) ───────────────────────────
  if (!isLocalOrTest && process.env.POLYGONSCAN_API_KEY) {
    console.log("\n  Menunggu 5 konfirmasi sebelum verifikasi...");
    // Tunggu beberapa block agar Polygonscan indexing selesai
    await new Promise((resolve) => setTimeout(resolve, 30_000));

    try {
      const { run } = require("hardhat");
      await run("verify:verify", {
        address: implAddress,
        constructorArguments: [],
      });
      console.log("  ✅ Contract terverifikasi di Polygonscan!");
    } catch (e) {
      if (e.message.includes("Already Verified")) {
        console.log("  ℹ️  Contract sudah terverifikasi sebelumnya.");
      } else {
        console.warn(`  ⚠️  Verifikasi gagal: ${e.message}`);
      }
    }
  }

  console.log("\n═".repeat(60));
  console.log("  Deployment selesai.");
  console.log("═".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment gagal:");
    console.error(error);
    process.exit(1);
  });
