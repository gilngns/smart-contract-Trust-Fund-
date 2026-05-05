const { ethers, network } = require("hardhat");

async function main() {
  console.log("Deploy MockXIDR");
  console.log("Network:", network.name);

  const [deployer] = await ethers.getSigners();

  const Mock = await ethers.getContractFactory("MockXIDR");
  const mock = await Mock.deploy(deployer.address);

  await mock.waitForDeployment();

  console.log("✅ MockXIDR deployed:", await mock.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
