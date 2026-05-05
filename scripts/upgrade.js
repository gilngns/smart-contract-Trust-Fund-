const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("═".repeat(60));
  console.log("Upgrade TrustFundEscrow");
  console.log("═".repeat(60));

  const proxyAddress = process.env.PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error("❌ PROXY_ADDRESS belum diset");
  }

  const [upgrader] = await ethers.getSigners();

  console.log("Network :", network.name);
  console.log("Upgrader:", upgrader.address);
  console.log("Proxy   :", proxyAddress);

  const oldImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Old Impl:", oldImpl);

  const Escrow = await ethers.getContractFactory("TrustFundEscrow");

  console.log("\nValidating upgrade...");
  await upgrades.validateUpgrade(proxyAddress, Escrow, {
    kind: "uups",
  });

  console.log("Upgrading...");

  const upgraded = await upgrades.upgradeProxy(proxyAddress, Escrow, {
    kind: "uups",
  });

  await upgraded.waitForDeployment();
  await upgraded.deploymentTransaction().wait();

  const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\n✅ UPGRADE SUCCESS");
  console.log("Proxy :", proxyAddress);
  console.log("Old   :", oldImpl);
  console.log("New   :", newImpl);

  const data = {
    network: network.name,
    proxy: proxyAddress,
    oldImplementation: oldImpl,
    newImplementation: newImpl,
    upgradedAt: new Date().toISOString(),
  };

  if (!fs.existsSync("./deployments")) fs.mkdirSync("./deployments");

  const file = `./deployments/upgrade-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  console.log("\nSaved:", file);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
