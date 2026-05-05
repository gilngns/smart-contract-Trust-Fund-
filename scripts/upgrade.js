const { ethers, upgrades, network } = require("hardhat");

async function main() {
  console.log("═".repeat(60));
  console.log("  TrustFund Escrow — Upgrade Script");
  console.log("═".repeat(60));
  console.log(`  Network  : ${network.name}`);

  const proxyAddress = process.env.PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error("❌ Set PROXY_ADDRESS di environment variable!");
  }

  const [upgrader] = await ethers.getSigners();
  console.log(`  Upgrader : ${upgrader.address}`);
  console.log(`  Proxy    : ${proxyAddress}`);

  const oldImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`\n  Old Implementation: ${oldImpl}`);

  console.log("\n  Memvalidasi storage layout compatibility...");
  const TrustFundEscrowV2 = await ethers.getContractFactory("TrustFundEscrow"); 
  await upgrades.validateUpgrade(proxyAddress, TrustFundEscrowV2, {
    kind: "uups",
  });
  console.log("  ✅ Storage layout valid, tidak ada collision.");

  console.log("\n  Mengupgrade contract...");
  const upgraded = await upgrades.upgradeProxy(
    proxyAddress,
    TrustFundEscrowV2,
    {
      kind: "uups",
      timeout: 120_000,
    }
  );

  await upgraded.waitForDeployment();

  const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\n  ✅ Upgrade Berhasil!");
  console.log("  ─".repeat(30));
  console.log(`  Proxy Address     : ${proxyAddress}`);
  console.log(`  Old Implementation: ${oldImpl}`);
  console.log(`  New Implementation: ${newImpl}`);

  const fs = require("fs");
  const upgradeInfo = {
    network: network.name,
    upgradedAt: new Date().toISOString(),
    upgrader: upgrader.address,
    proxyAddress,
    oldImplementation: oldImpl,
    newImplementation: newImpl,
  };

  const outDir = "./deployments";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const outFile = `${outDir}/upgrade-${network.name}-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(upgradeInfo, null, 2));
  console.log(`\n  📄 Upgrade info disimpan: ${outFile}`);

  console.log("\n═".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Upgrade gagal:");
    console.error(error);
    process.exit(1);
  });
