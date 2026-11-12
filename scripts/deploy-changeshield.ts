
import { network } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const { ethers, networkName } = await network.create();

async function main() {
  const [adminA, adminB, backendExecutor] =
    await ethers.getSigners();

  if (!adminA || !adminB || !backendExecutor) {
    throw new Error("Could not load the required accounts.");
  }

  console.log(`Deploying ChangeShield to ${networkName}...`);

  // Deploy the contract with a dedicated backend executor.
  const contract = await ethers.deployContract(
    "ChangeShield",
    [await backendExecutor.getAddress()]
  );

  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();

  // Account A is the initial administrator.
  // Account B becomes the second administrator.
  const adminTx = await contract.setAdmin(
    await adminB.getAddress(),
    true
  );

  await adminTx.wait();

  const networkInfo = await ethers.provider.getNetwork();

  // Save deployment details for the backend.
  const deploymentInfo = {
    networkName,
    chainId: networkInfo.chainId.toString(),
    contractAddress,
    adminA: await adminA.getAddress(),
    adminB: await adminB.getAddress(),
    backendExecutor: await backendExecutor.getAddress()
  };

  const deploymentDirectory = resolve("deployments");
  mkdirSync(deploymentDirectory, { recursive: true });

  writeFileSync(
    resolve(deploymentDirectory, "local.json"),
    JSON.stringify(deploymentInfo, null, 2) + "\n"
  );

  console.log("\nChangeShield deployed successfully!");
  console.log("Contract address:", contractAddress);
  console.log("Admin A:", deploymentInfo.adminA);
  console.log("Admin B:", deploymentInfo.adminB);
  console.log("Backend executor:", deploymentInfo.backendExecutor);
  console.log("Deployment info saved to deployments/local.json");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
