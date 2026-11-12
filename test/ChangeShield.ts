
import { expect } from "chai";
import hre from "hardhat";
import { beforeEach, describe, it } from "mocha";

const { ethers } = await hre.network.create();

describe("ChangeShield", function () {
  const configHash = ethers.keccak256(
    ethers.toUtf8Bytes("requireMFA=true")
  );

  const wrongHash = ethers.keccak256(
    ethers.toUtf8Bytes("requireMFA=false")
  );

  const validity = 3600n;

  let admin: any;
  let secondAdmin: any;
  let executor: any;
  let outsider: any;
  let contract: any;

  beforeEach(async function () {
    // Initialize signers inside the async hook.
    [admin, secondAdmin, executor, outsider] =
      await ethers.getSigners();

    // Deploy a fresh contract before every test.
    contract = await ethers.deployContract(
      "ChangeShield",
      [await executor.getAddress()]
    );

    await contract.waitForDeployment();

    // Authorize a second administrator.
    await contract.setAdmin(
      await secondAdmin.getAddress(),
      true
    );
  });

  // TEST 1: Admin can propose a configuration change.
  it("should allow an admin to propose a change", async function () {
    await contract.proposeChange(configHash, validity);

    const proposal = await contract.getChange(0n);

    expect(proposal.proposer).to.equal(
      await admin.getAddress()
    );

    expect(proposal.configHash).to.equal(configHash);
    expect(proposal.status).to.equal(0n);
  });

  // TEST 2: Proposer cannot approve their own proposal.
  it("should prevent self-approval", async function () {
    await contract.proposeChange(configHash, validity);

    await expect(
      contract.approveChange(0n)
    ).to.be.revertedWith("Self approval not allowed");
  });

  // TEST 3: Another authorized admin can approve.
  it("should allow a different admin to approve", async function () {
    await contract.proposeChange(configHash, validity);

    await contract.connect(secondAdmin).approveChange(0n);

    const proposal = await contract.getChange(0n);

    expect(proposal.status).to.equal(1n);

    expect(proposal.approver).to.equal(
      await secondAdmin.getAddress()
    );
  });

  // TEST 4: Unauthorized users cannot create proposals.
  it("should reject unauthorized proposals", async function () {
    await expect(
      contract.connect(outsider).proposeChange(
        configHash,
        validity
      )
    ).to.be.revertedWith("Not an admin");
  });

  // TEST 5: Incorrect configuration hash is rejected.
  // Correct hash allows execution.
  it("should reject a mismatched hash and allow valid execution", async function () {
    await contract.proposeChange(configHash, validity);

    await contract.connect(secondAdmin).approveChange(0n);

    await expect(
      contract.connect(executor).executeChange(
        0n,
        wrongHash
      )
    ).to.be.revertedWith("Configuration hash mismatch");

    await contract.connect(executor).executeChange(
      0n,
      configHash
    );

    const proposal = await contract.getChange(0n);

    expect(proposal.status).to.equal(3n);
    expect(proposal.executedAt).to.be.greaterThan(0n);
  });

  // TEST 6: Unauthorized users cannot approve proposals.
  it("should reject approval from an unauthorized account", async function () {
    await contract.proposeChange(configHash, validity);

    await expect(
      contract.connect(outsider).approveChange(0n)
    ).to.be.revertedWith("Not an admin");
  });

  // TEST 7: Another authorized admin can reject a proposal.
  it("should allow a different admin to reject a proposal", async function () {
    await contract.proposeChange(configHash, validity);

    await contract.connect(secondAdmin).rejectChange(0n);

    const proposal = await contract.getChange(0n);

    expect(proposal.status).to.equal(2n);
  });

  // TEST 8: Unauthorized users cannot execute changes.
  it("should prevent an unauthorized executor from executing a proposal", async function () {
    await contract.proposeChange(configHash, validity);

    await contract.connect(secondAdmin).approveChange(0n);

    await expect(
      contract.connect(outsider).executeChange(
        0n,
        configHash
      )
    ).to.be.revertedWith("Not the executor");
  });

  // TEST 9: An executed proposal cannot be executed again.
  it("should prevent a proposal from being executed twice", async function () {
    await contract.proposeChange(configHash, validity);

    await contract.connect(secondAdmin).approveChange(0n);

    await contract.connect(executor).executeChange(
      0n,
      configHash
    );

    await expect(
      contract.connect(executor).executeChange(
        0n,
        configHash
      )
    ).to.be.revertedWith("Not approved");
  });

  // TEST 10: Overdue proposals can be expired.
  it("should expire a proposal after its deadline", async function () {
    await contract.proposeChange(configHash, 60n);

    // Advance local blockchain time by 61 seconds.
    await ethers.provider.send(
      "evm_increaseTime",
      [61]
    );

    // Mine a new block with the advanced timestamp.
    await ethers.provider.send(
      "evm_mine",
      []
    );

    await contract.expireChange(0n);

    const proposal = await contract.getChange(0n);

    expect(proposal.status).to.equal(4n);
  });
});
