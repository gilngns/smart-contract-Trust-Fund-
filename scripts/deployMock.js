const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying MockXIDR...");

  const Mock = await ethers.getContractFactory("MockXIDR");
  const mock = await Mock.deploy(deployer.address);

  await mock.waitForDeployment();

  console.log("✅ MockXIDR:", await mock.getAddress());
}

main();
