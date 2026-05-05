const { ethers, upgrades, network } = require("hardhat");
const fs = require("fs");

const XIDR_MAINNET = "0x3dc9a42fa7afe57be03c58fd7f4411b1e466c508";

async function main() {
  console.log("═".repeat(60));
  console.log("TrustFund Escrow — Deployment");
  console.log("═".repeat(60));

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network   : ${network.name}`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Balance   : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error("❌ Wallet tidak ada balance untuk gas");
  }

  const isLocal = ["hardhat", "localhost"].includes(network.name);

  let xidrAddress;

  if (isLocal) {
    console.log("\nDeploying MockXIDR...");
    const Mock = await ethers.getContractFactory("MockXIDR");
    const mock = await Mock.deploy(deployer.address);
    await mock.waitForDeployment();

    xidrAddress = await mock.getAddress();
    console.log("MockXIDR:", xidrAddress);
  } else {
    xidrAddress = process.env.XIDR_TOKEN_ADDRESS || XIDR_MAINNET;
  }

  const backendWallet = process.env.BACKEND_WALLET;
  const admin = process.env.ADMIN_MULTISIG;

  if (!backendWallet) throw new Error("❌ BACKEND_WALLET belum diset");
  if (!admin) throw new Error("❌ ADMIN_MULTISIG belum diset");

  console.log("\nConfig:");
  console.log("XIDR       :", xidrAddress);
  console.log("Backend    :", backendWallet);
  console.log("Admin      :", admin);

  console.log("\nDeploying proxy...");

  const Escrow = await ethers.getContractFactory("TrustFundEscrow");

  const proxy = await upgrades.deployProxy(
    Escrow,
    [xidrAddress, backendWallet, admin],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );

  await proxy.waitForDeployment();
  await proxy.deploymentTransaction().wait();

  const proxyAddress = await proxy.getAddress();
  const impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\n✅ DEPLOY SUCCESS");
  console.log("Proxy :", proxyAddress);
  console.log("Impl  :", impl);

  const data = {
    network: network.name,
    proxy: proxyAddress,
    implementation: impl,
    xidr: xidrAddress,
    backendWallet,
    admin,
    deployedAt: new Date().toISOString(),
  };

  if (!fs.existsSync("./deployments")) fs.mkdirSync("./deployments");

  const file = `./deployments/${network.name}-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  console.log("\nSaved:", file);

  // VERIFY
  if (!isLocal && process.env.POLYGONSCAN_API_KEY) {
    console.log("\nVerifying... wait 30s");
    await new Promise((r) => setTimeout(r, 30000));

    try {
      await hre.run("verify:verify", {
        address: impl,
        constructorArguments: [],
      });
      console.log("✅ Verified");
    } catch (e) {
      console.log("⚠️ Verify failed:", e.message);
    }
  }

  console.log("\nDONE 🚀");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
