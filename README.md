# ChangeShield
## Blockchain-Based Two-Person Authorization and Audit System for Critical Configuration Changes

### 1. Project Overview

ChangeShield is a blockchain-based security configuration management system designed to prevent unauthorized or unilateral modifications to critical system configurations.

The system introduces a two-person authorization mechanism in which one authorized administrator proposes a configuration change and a different administrator independently approves or rejects it. Only an approved proposal can be executed by the designated backend executor.

The project uses Solidity smart contracts to enforce authorization rules and maintain tamper-evident records of configuration-change activities.

The backend is developed using Node.js, Express.js, and ethers.js, while Hardhat provides the local blockchain development and testing environment.

### 2. Problem Statement

Critical security configurations, such as authentication policies, login-attempt limits, and firewall settings, must be protected against unauthorized modifications.

A system in which one administrator can independently propose and approve a sensitive change creates a risk of misuse or accidental modification.

ChangeShield addresses this problem through:

- Two-person authorization.
- Role-based access restrictions.
- Cryptographic configuration hash verification.
- Time-limited configuration-change proposals.
- Controlled execution of approved changes.
- Blockchain-based audit records.

### 3. System Architecture

The system consists of three main components.

**Smart Contract Layer**
- Written in Solidity.
- Manages administrator permissions.
- Registers configuration-change proposals.
- Enforces separate proposal and approval accounts.
- Validates configuration hashes.
- Controls execution and proposal expiry.
- Emits blockchain events for important operations.

**Backend Layer**
- Developed using Node.js and Express.js.
- Exposes REST API endpoints.
- Connects to the smart contract using ethers.js.
- Validates proposed configuration changes.
- Calculates cryptographic configuration hashes.
- Applies approved changes to the configuration file.
- Retrieves blockchain audit events.

**Storage Layer**
- `config.json`: Stores the current demonstration configuration.
- `changes.json`: Stores proposal descriptions and additional off-chain metadata.
- Hardhat blockchain: Stores proposal records, statuses, hashes, and smart-contract events.

### 4. Technology Stack

| Component | Technology |
|---|---|
| Smart Contracts | Solidity |
| Blockchain Development | Hardhat 3 |
| Backend | Node.js |
| API Framework | Express.js |
| Blockchain Integration | ethers.js |
| Testing | Mocha, Chai, Hardhat |
| Programming Languages | Solidity, JavaScript, TypeScript |
| Configuration Storage | JSON |
| Development Environment | Visual Studio Code |
| API Testing | PowerShell / Postman |

### 5. Project Structure

```text
changeshield/
│
├── contracts/
│   └── ChangeShield.sol
│
├── scripts/
│   └── deploy-changeshield.ts
│
├── test/
│   └── ChangeShield.ts
│
├── deployments/
│   └── local.json
│
├── backend/
│   ├── server.mjs
│   └── data/
│       ├── config.json
│       └── changes.json
│
├── Run-ChangeShield-Demo.ps1
├── package.json
├── package-lock.json
├── hardhat.config.ts
├── tsconfig.json
├── README.md
└── .gitignore
```

Generated folders such as `artifacts`, `cache`, and `node_modules` may also exist locally.

### 6. Core Functionalities

**6.1 Administrator Management**

The smart contract allows authorized administrators to be registered and removed. Sensitive functions are restricted to authorized accounts.

**6.2 Configuration-Change Proposal**

Administrator A submits a proposed configuration change. The backend validates the requested settings and computes a cryptographic hash of the proposed configuration.

**6.3 Independent Approval**

Administrator B reviews the proposal. The smart contract prevents the original proposer from approving their own request.

**6.4 Proposal Rejection**

An authorized administrator other than the proposer can reject a pending proposal.

**6.5 Controlled Execution**

The designated backend executor can execute an approved proposal only when the submitted configuration hash matches the approved hash.

The backend applies the corresponding configuration update after successful blockchain execution.

**6.6 Proposal Expiry**

Proposals have an expiry deadline. The backend's automatic expiry checker identifies overdue proposals and submits expiry transactions. The smart contract independently enforces the deadline.

**6.7 Blockchain Audit History**

The smart contract emits events for important operations, including:

- AdminUpdated
- ExecutorUpdated
- ChangeProposed
- ChangeApproved
- ChangeRejected
- ChangeExpired
- ChangeExecuted

The backend provides an API to retrieve these blockchain events.

### 7. Example Application

The system demonstrates privileged-account security configuration management.

The initial configuration may contain:

```json
{
  "requireMFA": true,
  "maxLoginAttempts": 5,
  "firewallMode": "strict"
}
```

Example situation:

Repeated failed login attempts are detected against privileged accounts.

Administrator A proposes reducing the maximum permitted login attempts from five to three.

Administrator B independently reviews the request and approves it.

The backend executor applies the approved configuration, and the blockchain records the execution event.

Other demonstration scenarios include:

- Rejection of an unsafe configuration change.
- Automatic expiry of a proposal that misses its approval deadline.
- Rejection of unsupported configuration parameters.
- Prevention of unauthorized and repeated execution attempts.

### 8. Installation and Setup

**Prerequisites**

- Node.js 22.13 or later.
- npm.
- Visual Studio Code.

Clone or extract the project and open its root directory in the terminal.

Install dependencies:

```powershell
npm install
```

Build the smart contracts:

```powershell
npx hardhat build
```

Run automated tests:

```powershell
npx hardhat test
```

### 9. Environment Configuration

Create a `.env` file in the project root.

```dotenv
RPC_URL=http://127.0.0.1:8545
PORT=3000
ADMIN_A_PRIVATE_KEY=LOCAL_HARDHAT_ACCOUNT_0_KEY
ADMIN_B_PRIVATE_KEY=LOCAL_HARDHAT_ACCOUNT_1_KEY
EXECUTOR_PRIVATE_KEY=LOCAL_HARDHAT_ACCOUNT_2_KEY
```

Use the corresponding local Hardhat development account keys.

The keys must match the addresses stored in `deployments/local.json`.

**Security warning:** The default Hardhat development accounts have publicly known private keys. They must only be used for local testing and must never receive real funds or be reused on a live network.

The `.env` file must not be committed to Git or included in project submissions.

### 10. Running the Application

The application requires two long-running services.

**Terminal 1: Start the local blockchain**

From the project root:

```powershell
npx hardhat node
```

Keep this terminal running.

**Terminal 2: Deploy the smart contract**

Open another terminal:

```powershell
npx hardhat run scripts/deploy-changeshield.ts --network localhost
```

This deploys ChangeShield and registers the second administrator. Deployment details are saved to `deployments/local.json`.

**Terminal 3: Start the backend**

```powershell
node .\backend\server.mjs
```

The Express API runs at:

```text
http://127.0.0.1:3000
```

**Important:** Restarting the Hardhat node resets the local blockchain. The smart contract must be deployed again, and the backend must be restarted using the updated deployment information.

### 11. Backend API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Check blockchain connectivity |
| GET | `/api/config` | Retrieve current configuration |
| GET | `/api/changes` | Retrieve all proposals |
| GET | `/api/changes/:id` | Retrieve an individual proposal |
| POST | `/api/changes` | Create a configuration-change proposal |
| POST | `/api/changes/:id/approve` | Approve a pending proposal |
| POST | `/api/changes/:id/reject` | Reject a pending proposal |
| POST | `/api/changes/:id/execute` | Execute an approved proposal |
| POST | `/api/changes/:id/expire` | Expire an overdue proposal |
| GET | `/api/audit` | Retrieve blockchain audit history |

### 12. Automated Testing

The ChangeShield test suite covers:

1. Successful proposal creation.
2. Prevention of self-approval.
3. Approval by a different authorized administrator.
4. Rejection of unauthorized proposals.
5. Configuration hash verification.
6. Unauthorized approval prevention.
7. Proposal rejection.
8. Unauthorized execution prevention.
9. Prevention of repeated execution.
10. Proposal expiry.

Execute:

```powershell
npx hardhat test
```

The latest verified result after removing the Hardhat Counter sample tests was 10 passing ChangeShield Mocha tests.

### 13. Security Considerations and Limitations

- Configuration contents and supplementary metadata are stored off-chain.
- Cryptographic hashes and smart-contract event records are stored on-chain.
- The smart contract enforces authorization based on blockchain account addresses.
- The current implementation uses local development signing keys and is intended for a local demonstration.
- The current backend does not yet provide production-grade independent human authentication for the administrator API operations.
- Blockchain execution records authorization and the executor's transaction; it does not independently establish that an external production server applied the configuration.
- A production deployment would require secure key management, authenticated API access, independent administrator transaction signing, and additional operational safeguards.

### 14. Future Enhancements

- React-based administrator dashboard.
- Wallet-based independent administrator signing.
- Stronger administrator authentication.
- Proposal-specific audit views and transaction receipts.
- Database-backed metadata management.
- Integration with real configuration-management systems.
- Additional security and performance evaluation.

### 15. Project Objective

ChangeShield demonstrates how Solidity smart contracts and blockchain-backed authorization can be used to strengthen the security, accountability, and auditability of critical configuration changes through a two-person approval mechanism.
