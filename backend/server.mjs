import "dotenv/config";
import express from "express";
import {
  JsonRpcProvider,
  Contract,
  Wallet,
  NonceManager,
  keccak256,
  toUtf8Bytes
} from "ethers";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const backendDir = path.dirname(filename);
const projectDir = path.resolve(backendDir, "..");

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(backendDir, "public")));

const PORT = Number(process.env.PORT || 3000);
const RPC_URL =
  process.env.RPC_URL || "http://127.0.0.1:8545";

const deployment = JSON.parse(
  readFileSync(
    path.join(projectDir, "deployments", "local.json"),
    "utf8"
  )
);

const artifact = JSON.parse(
  readFileSync(
    path.join(
      projectDir,
      "artifacts",
      "contracts",
      "ChangeShield.sol",
      "ChangeShield.json"
    ),
    "utf8"
  )
);

const configPath = path.join(
  backendDir,
  "data",
  "config.json"
);

const metadataPath = path.join(
  backendDir,
  "data",
  "changes.json"
);

const provider = new JsonRpcProvider(RPC_URL);

const contract = new Contract(
  deployment.contractAddress,
  artifact.abi,
  provider
);

// Load the proposer account and verify its deployment address.
const adminAKey = process.env.ADMIN_A_PRIVATE_KEY;

if (!adminAKey) {
  throw new Error(
    "Add ADMIN_A_PRIVATE_KEY to the root .env file."
  );
}

const adminA = new Wallet(adminAKey, provider);

if (
  adminA.address.toLowerCase() !==
  deployment.adminA.toLowerCase()
) {
  throw new Error(
    "ADMIN_A_PRIVATE_KEY does not match deployment adminA."
  );
}

const adminAWriter = new Contract(
  deployment.contractAddress,
  artifact.abi,
  adminA
);


// Load Administrator B's local signing account.
const adminBKey = process.env.ADMIN_B_PRIVATE_KEY;

if (!adminBKey) {
  throw new Error(
    "Add ADMIN_B_PRIVATE_KEY to the root .env file."
  );
}

const adminB = new Wallet(adminBKey, provider);

if (
  adminB.address.toLowerCase() !==
  deployment.adminB.toLowerCase()
) {
  throw new Error(
    "ADMIN_B_PRIVATE_KEY does not match deployment adminB."
  );
}

const adminBWriter = new Contract(
  deployment.contractAddress,
  artifact.abi,
  adminB
);


// Load the authorized backend executor account.
const executorKey = process.env.EXECUTOR_PRIVATE_KEY;

if (!executorKey) {
  throw new Error(
    "Add EXECUTOR_PRIVATE_KEY to the root .env file."
  );
}

// Create the executor wallet.
const executorWallet = new Wallet(executorKey, provider);

// Verify the wallet address before wrapping it in NonceManager.
if (
  executorWallet.address.toLowerCase() !==
  deployment.backendExecutor.toLowerCase()
) {
  throw new Error(
    "EXECUTOR_PRIVATE_KEY does not match deployment backendExecutor."
  );
}

// Manage transaction nonces for the executor.
const executor = new NonceManager(executorWallet);

// Create the executor's contract connection.
const executorWriter = new Contract(
  deployment.contractAddress,
  artifact.abi,
  executor
);

// Serialize all transactions submitted by the backend executor.
// This prevents automatic expiry, manual expiry, and execution requests
// from attempting to use the same account nonce at the same time.
let executorTransactionQueue = Promise.resolve();

async function submitExecutorTransaction(transactionFactory) {
  const currentTransaction = executorTransactionQueue.then(
    async () => {
      try {
        const tx = await transactionFactory();
        return await tx.wait();
      } catch (error) {
        // Refresh the NonceManager's cached nonce after a failed submission
        // or confirmation so the next queued transaction can recover.
        executor.reset();
        throw error;
      }
    }
  );

  // Keep the queue usable even if this transaction fails.
  executorTransactionQueue = currentTransaction.then(
    () => undefined,
    () => undefined
  );

  return currentTransaction;
}


const statuses = [
  "Pending",
  "Approved",
  "Rejected",
  "Executed",
  "Expired"
];

function readConfig() {
  return JSON.parse(
    readFileSync(configPath, "utf8")
  );
}

function readMetadata() {
  if (!existsSync(metadataPath)) {
    return {};
  }

  return JSON.parse(
    readFileSync(metadataPath, "utf8")
  );
}

function saveMetadata(metadata) {
  writeFileSync(
    metadataPath,
    JSON.stringify(metadata, null, 2) + "\n",
    "utf8"
  );
}

// Sort object keys so equivalent configurations produce the same hash.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }

  return value;
}

function hashConfig(config) {
  const json = JSON.stringify(canonicalize(config));
  return keccak256(toUtf8Bytes(json));
}

// Validate permitted configuration settings.
function applyPatch(current, patch) {
  if (
    patch === null ||
    typeof patch !== "object" ||
    Array.isArray(patch)
  ) {
    throw new Error("patch must be a JSON object.");
  }

  const entries = Object.entries(patch);

  if (entries.length === 0) {
    throw new Error(
      "At least one setting must be changed."
    );
  }

  const updated = { ...current };

  for (const [key, value] of entries) {
    if (key === "requireMFA") {
      if (typeof value !== "boolean") {
        throw new Error(
          "requireMFA must be true or false."
        );
      }

      updated.requireMFA = value;
    } else if (key === "maxLoginAttempts") {
      if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > 20
      ) {
        throw new Error(
          "maxLoginAttempts must be an integer from 1 to 20."
        );
      }

      updated.maxLoginAttempts = value;
    } else if (key === "firewallMode") {
      if (
        !["standard", "strict", "restricted"].includes(value)
      ) {
        throw new Error(
          "firewallMode must be standard, strict, or restricted."
        );
      }

      updated.firewallMode = value;
    } else {
      throw new Error(
        `Unsupported configuration key: ${key}`
      );
    }
  }

  return updated;
}

function formatProposal(id, proposal) {
  const metadata = readMetadata()[id.toString()] || {};

  return {
    id: id.toString(),
    proposer: proposal.proposer,
    approver: proposal.approver,
    configHash: proposal.configHash,
    expiresAt: Number(proposal.expiresAt),
    status: statuses[Number(proposal.status)],
    executedAt: Number(proposal.executedAt),
    reason: metadata.reason ?? null,
    patch: metadata.patch ?? null
  };
}

// Check the local blockchain connection.
app.get("/api/health", async (_req, res) => {
  try {
    const network = await provider.getNetwork();

    const code = await provider.getCode(
      deployment.contractAddress
    );

    if (code === "0x") {
      return res.status(503).json({
        status: "error",
        message:
          "No contract found at the configured address."
      });
    }

    return res.json({
      status: "ok",
      network: deployment.networkName,
      chainId: network.chainId.toString(),
      contractAddress: deployment.contractAddress,
      blockNumber: await provider.getBlockNumber()
    });
  } catch (error) {
    console.error(
      "Health check failed:",
      error.message
    );

    return res.status(503).json({
      status: "error",
      message:
        "Could not connect to the local blockchain."
    });
  }
});

// Read the current configuration.
app.get("/api/config", (_req, res) => {
  try {
    return res.json(readConfig());
  } catch (error) {
    console.error(
      "Config read failed:",
      error.message
    );

    return res.status(500).json({
      error: "Could not read configuration."
    });
  }
});

// List proposals from the blockchain.
app.get("/api/changes", async (_req, res) => {
  try {
    const count = await contract.proposalCount();
    const changes = [];

    for (let id = 0n; id < count; id++) {
      const proposal = await contract.getChange(id);
      changes.push(formatProposal(id, proposal));
    }

    return res.json({
      total: changes.length,
      changes
    });
  } catch (error) {
    console.error(
      "Proposal listing failed:",
      error.message
    );

    return res.status(500).json({
      error: "Could not retrieve proposals."
    });
  }
});

// Retrieve one proposal.
app.get("/api/changes/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({
        error: "Proposal ID must be a non-negative integer."
      });
    }

    const id = BigInt(req.params.id);
    const count = await contract.proposalCount();

    if (id >= count) {
      return res.status(404).json({
        error: "Proposal not found."
      });
    }

    const proposal = await contract.getChange(id);

    return res.json(formatProposal(id, proposal));
  } catch (error) {
    console.error(
      "Proposal lookup failed:",
      error.message
    );

    return res.status(500).json({
      error: "Could not retrieve proposal."
    });
  }
});


// Create a proposal without applying the configuration.
app.post("/api/changes", async (req, res) => {
  try {
    const body = req.body ?? {};

    const reason =
      typeof body.reason === "string"
        ? body.reason.trim()
        : "";

    if (reason.length < 3 || reason.length > 500) {
      return res.status(400).json({
        error: "reason must contain 3 to 500 characters."
      });
    }

    const validForSeconds =
      body.validForSeconds ?? 3600;

    if (
      !Number.isInteger(validForSeconds) ||
      validForSeconds < 60 ||
      validForSeconds > 2592000
    ) {
      return res.status(400).json({
        error:
          "validForSeconds must be from 60 to 2592000."
      });
    }

    const currentConfig = readConfig();

    let proposedConfig;

    try {
      proposedConfig = applyPatch(
        currentConfig,
        body.patch
      );
    } catch (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    // Hash the complete proposed configuration.
    const configHash = hashConfig(proposedConfig);
    const baseConfigHash = hashConfig(currentConfig);

    // Submit the blockchain transaction as Administrator A.
    const tx = await adminAWriter.proposeChange(
      configHash,
      BigInt(validForSeconds)
    );

    const receipt = await tx.wait();

    // Extract the new proposal ID from the contract event.
    let proposalId = null;

    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() !==
        deployment.contractAddress.toLowerCase()
      ) {
        continue;
      }

      try {
        const parsed = contract.interface.parseLog({
          topics: log.topics,
          data: log.data
        });

        if (parsed?.name === "ChangeProposed") {
          proposalId = parsed.args.id.toString();
          break;
        }
      } catch {
        // Ignore unrelated log entries.
      }
    }

    if (proposalId === null) {
      throw new Error(
        "Transaction confirmed but proposal ID was not found."
      );
    }

    // Store readable information off-chain.
    const metadata = readMetadata();

    metadata[proposalId] = {
      reason,
      patch: body.patch,
      proposedConfig,
      configHash,
      baseConfigHash,
      transactionHash: tx.hash,
      createdAt: new Date().toISOString(),
      validForSeconds
    };

    saveMetadata(metadata);

    const proposal = await contract.getChange(
      BigInt(proposalId)
    );

    return res.status(201).json({
      message: "Change proposal created successfully.",
      proposal: formatProposal(
        BigInt(proposalId),
        proposal
      ),
      transactionHash: tx.hash
    });
  } catch (error) {
    console.error(
      "Proposal creation failed:",
      error
    );

    return res.status(500).json({
      error:
        "Could not create proposal. Check the backend terminal."
    });
  }
});


// Approve a proposal using Administrator B.
app.post("/api/changes/:id/approve", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({
        error: "Invalid proposal ID."
      });
    }

    const id = BigInt(req.params.id);
    const count = await contract.proposalCount();

    if (id >= count) {
      return res.status(404).json({
        error: "Proposal not found."
      });
    }

    const proposal = await contract.getChange(id);

    if (Number(proposal.status) !== 0) {
      return res.status(409).json({
        error: "Only pending proposals can be approved."
      });
    }

    if (
      proposal.proposer.toLowerCase() ===
      adminB.address.toLowerCase()
    ) {
      return res.status(403).json({
        error: "Proposer cannot approve their own proposal."
      });
    }

    const tx = await adminBWriter.approveChange(id);
    const receipt = await tx.wait();

    const updatedProposal = await contract.getChange(id);

    return res.json({
      message: "Proposal approved successfully.",
      proposal: formatProposal(id, updatedProposal),
      transactionHash: receipt.hash
    });

  } catch (error) {
    console.error("Approval failed:", error);

    return res.status(400).json({
      error:
        error.shortMessage ||
        error.reason ||
        "Approval transaction failed."
    });
  }
});


// Execute an approved configuration change.
app.post("/api/changes/:id/execute", async (req, res) => {
  const idText = req.params.id;

  try {
    if (!/^\d+$/.test(idText)) {
      return res.status(400).json({
        error: "Invalid proposal ID."
      });
    }

    const id = BigInt(idText);
    const count = await contract.proposalCount();

    if (id >= count) {
      return res.status(404).json({
        error: "Proposal not found."
      });
    }

    const proposal = await contract.getChange(id);

    if (Number(proposal.status) !== 1) {
      return res.status(409).json({
        error: "Proposal must be approved before execution."
      });
    }

    const metadata = readMetadata()[idText];

    if (
      !metadata ||
      !metadata.proposedConfig ||
      !metadata.configHash ||
      !metadata.baseConfigHash
    ) {
      return res.status(409).json({
        error: "Required proposal metadata is missing."
      });
    }

    if (
      metadata.configHash.toLowerCase() !==
      proposal.configHash.toLowerCase()
    ) {
      return res.status(409).json({
        error: "Stored configuration hash does not match the blockchain."
      });
    }

    const recomputedHash = hashConfig(
      metadata.proposedConfig
    );

    if (
      recomputedHash.toLowerCase() !==
      proposal.configHash.toLowerCase()
    ) {
      return res.status(409).json({
        error: "Proposed configuration has been modified."
      });
    }

    const currentConfig = readConfig();
    const currentHash = hashConfig(currentConfig);

    if (
      currentHash.toLowerCase() !==
      metadata.baseConfigHash.toLowerCase()
    ) {
      return res.status(409).json({
        error: "Current configuration has changed since proposal creation. Create a new proposal."
      });
    }

    const tempPath = `${configPath}.pending`;

    writeFileSync(
      tempPath,
      JSON.stringify(metadata.proposedConfig, null, 2) + "\n",
      "utf8"
    );

    let receipt;

    try {
      receipt = await submitExecutorTransaction(() =>
        executorWriter.executeChange(
          id,
          proposal.configHash
        )
      );
    } catch (error) {
      if (existsSync(tempPath)) {
        // Leave the staged file available for inspection.
        // It has not replaced the actual configuration.
      }

      throw error;
    }

    try {
      renameSync(tempPath, configPath);
    } catch (error) {
      console.error(
        "Blockchain execution succeeded, but config replacement failed:",
        error
      );

      return res.status(500).json({
        error: "Blockchain execution succeeded, but configuration replacement failed. The staged file remains at " + tempPath + ". Do not retry execution; reconcile the configuration manually."
      });
    }

    const updatedProposal = await contract.getChange(id);

    return res.json({
      message: "Configuration change executed successfully.",
      proposal: formatProposal(id, updatedProposal),
      updatedConfiguration: readConfig(),
      transactionHash: receipt.hash
    });

  } catch (error) {
    console.error("Execution failed:", error);

    return res.status(400).json({
      error:
        error.shortMessage ||
        error.reason ||
        "Configuration execution failed. Check the backend terminal."
    });
  }
});


// Reject a pending proposal using Administrator B.
app.post("/api/changes/:id/reject", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({
        error: "Invalid proposal ID."
      });
    }

    const id = BigInt(req.params.id);
    const count = await contract.proposalCount();

    if (id >= count) {
      return res.status(404).json({
        error: "Proposal not found."
      });
    }

    const proposal = await contract.getChange(id);

    if (Number(proposal.status) !== 0) {
      return res.status(409).json({
        error: "Only pending proposals can be rejected."
      });
    }

    const tx = await adminBWriter.rejectChange(id);
    const receipt = await tx.wait();

    const updatedProposal = await contract.getChange(id);

    return res.json({
      message: "Proposal rejected successfully.",
      proposal: formatProposal(id, updatedProposal),
      transactionHash: receipt.hash
    });

  } catch (error) {
    console.error("Rejection failed:", error);

    return res.status(400).json({
      error:
        error.shortMessage ||
        error.reason ||
        "Proposal rejection failed."
    });
  }
});


// Manually expire a proposal after its deadline.
app.post("/api/changes/:id/expire", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({
        error: "Invalid proposal ID."
      });
    }

    const id = BigInt(req.params.id);
    const count = await contract.proposalCount();

    if (id >= count) {
      return res.status(404).json({
        error: "Proposal not found."
      });
    }

    const proposal = await contract.getChange(id);
    const status = Number(proposal.status);

    // 0 = Pending, 1 = Approved
    if (status !== 0 && status !== 1) {
      return res.status(409).json({
        error: "Only pending or approved proposals can expire."
      });
    }

    const latestBlock = await provider.getBlock("latest");

    if (!latestBlock) {
      throw new Error("Could not read latest block.");
    }

    if (
      latestBlock.timestamp <= Number(proposal.expiresAt)
    ) {
      return res.status(409).json({
        error: "Proposal deadline has not passed yet."
      });
    }

    const receipt = await submitExecutorTransaction(() =>
      executorWriter.expireChange(id)
    );

    const updatedProposal = await contract.getChange(id);

    return res.json({
      message: "Proposal expired successfully.",
      proposal: formatProposal(id, updatedProposal),
      transactionHash: receipt.hash
    });

  } catch (error) {
    console.error("Expiry operation failed:", error);

    return res.status(400).json({
      error:
        error.shortMessage ||
        error.reason ||
        "Could not expire proposal."
    });
  }
});


// Automatic expiry monitoring.
// Checks all proposals every 15 seconds.

let expirySweepRunning = false;

async function sweepExpiredProposals() {
  if (expirySweepRunning) return;

  expirySweepRunning = true;

  try {
    const network = await provider.getNetwork();
    const rpcHost = new URL(RPC_URL).hostname;

    // Clock synchronisation is restricted to a local Hardhat node.
    const isLocalHardhat =
      network.chainId === 31337n &&
      ["127.0.0.1", "localhost", "::1"].includes(rpcHost);

    const count = await contract.proposalCount();

    let latestBlock = await provider.getBlock("latest");

    if (!latestBlock) {
      return;
    }

    const metadata = readMetadata();

    for (let id = 0n; id < count; id++) {
      const proposal = await contract.getChange(id);
      const status = Number(proposal.status);

      // Only Pending (0) and Approved (1) proposals can expire.
      if (status !== 0 && status !== 1) {
        continue;
      }

      const expiresAt = Number(proposal.expiresAt);

      let deadlinePassed =
        latestBlock.timestamp > expiresAt;

      if (isLocalHardhat) {
        const proposalMetadata = metadata[id.toString()] || {};
        const createdAtMs = Date.parse(proposalMetadata.createdAt || "");

        let validForSeconds = Number(
          proposalMetadata.validForSeconds
        );

        // Older proposals did not store validForSeconds.
        // Recover it from the proposal transaction's block timestamp.
        if (
          (!Number.isFinite(validForSeconds) || validForSeconds <= 0) &&
          proposalMetadata.transactionHash &&
          Number.isFinite(createdAtMs)
        ) {
          const creationReceipt = await provider.getTransactionReceipt(
            proposalMetadata.transactionHash
          );

          if (creationReceipt) {
            const creationBlock = await provider.getBlock(
              creationReceipt.blockNumber
            );

            if (creationBlock) {
              validForSeconds =
                expiresAt - creationBlock.timestamp;
            }
          }
        }

        // Use elapsed real time from proposal creation, not the absolute
        // computer clock, because a local chain may have a clock offset.
        if (
          Number.isFinite(createdAtMs) &&
          Number.isFinite(validForSeconds) &&
          validForSeconds > 0
        ) {
          const realDeadline =
            Math.floor(createdAtMs / 1000) + validForSeconds;

          deadlinePassed =
            Math.floor(Date.now() / 1000) > realDeadline;
        } else if (!deadlinePassed) {
          console.warn(
            `[Automatic Expiry] Could not determine real-time deadline for proposal ${id}; leaving it unchanged.`
          );
          continue;
        }
      }

      if (!deadlinePassed) {
        continue;
      }

      try {
        // On local Hardhat, mine a block just beyond this proposal's
        // on-chain deadline. The contract still validates block.timestamp.
        if (
          isLocalHardhat &&
          latestBlock.timestamp <= expiresAt
        ) {
          await provider.send(
            "evm_setNextBlockTimestamp",
            [expiresAt + 1]
          );

          await provider.send("evm_mine", []);

          latestBlock = await provider.getBlock("latest");

          if (!latestBlock) {
            throw new Error("Could not retrieve the updated block.");
          }
        }

        // Never submit the expiry transaction unless the chain itself
        // now considers the proposal expired.
        if (latestBlock.timestamp <= expiresAt) {
          continue;
        }

        await submitExecutorTransaction(() =>
          executorWriter.expireChange(id)
        );

        console.log(
          `[Automatic Expiry] Proposal ${id} expired successfully.`
        );

      } catch (error) {
        console.error(
          `[Automatic Expiry] Proposal ${id} failed:`,
          error.shortMessage || error.message
        );
      }
    }

  } catch (error) {
    console.error(
      "Automatic expiry scan failed:",
      error.message
    );

  } finally {
    expirySweepRunning = false;
  }
}

// Run once when the backend starts.
void sweepExpiredProposals();

// Repeat the expiry check every 15 seconds.
setInterval(() => {
  void sweepExpiredProposals();
}, 15000);


// Retrieve blockchain audit history.
app.get("/api/audit", async (_req, res) => {
  try {
    const latestBlock = await provider.getBlockNumber();

    const logs = await provider.getLogs({
      address: deployment.contractAddress,
      fromBlock: 0,
      toBlock: latestBlock
    });

    const metadata = readMetadata();

    const events = [];

    for (const log of logs) {
      const parsed = contract.interface.parseLog({
        topics: log.topics,
        data: log.data
      });

      if (!parsed) continue;

      const args = {};

      parsed.fragment.inputs.forEach((input, index) => {
        const value = parsed.args[index];

        args[input.name || `arg${index}`] =
          typeof value === "bigint"
            ? value.toString()
            : value;
      });

      const proposalId =
        args.id !== undefined
          ? String(args.id)
          : null;

      const proposalMetadata =
        proposalId !== null
          ? metadata[proposalId]
          : null;

      events.push({
        event: parsed.name,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index,
        args,
        reason: proposalMetadata?.reason ?? null,
        patch: proposalMetadata?.patch ?? null
      });
    }

    events.sort((a, b) =>
      a.blockNumber - b.blockNumber ||
      a.logIndex - b.logIndex
    );

    return res.json({
      totalEvents: events.length,
      events
    });

  } catch (error) {
    console.error("Audit retrieval failed:", error);

    return res.status(500).json({
      error: "Could not retrieve blockchain audit history."
    });
  }
});


// Start the API server.
app.listen(PORT, "127.0.0.1", () => {
  console.log(
    `ChangeShield API running on http://127.0.0.1:${PORT}`
  );
  console.log(
    `Contract: ${deployment.contractAddress}`
  );
  console.log(`Blockchain RPC: ${RPC_URL}`);
  console.log(`Proposer: ${adminA.address}`);
});