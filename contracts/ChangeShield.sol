
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ChangeShield {
    enum Status {
        Pending,
        Approved,
        Rejected,
        Executed,
        Expired
    }

    struct Proposal {
        address proposer;
        address approver;
        bytes32 configHash;
        uint64 expiresAt;
        Status status;
        uint64 executedAt;
    }

    mapping(address => bool) public admins;
    uint256 public adminCount;

    address public executor;
    uint256 public proposalCount;

    mapping(uint256 => Proposal) private proposals;

    uint64 public constant MAX_VALIDITY = 30 days;

    event AdminUpdated(address indexed account, bool enabled);
    event ExecutorUpdated(address indexed newExecutor);

    event ChangeProposed(
        uint256 indexed id,
        address indexed proposer,
        bytes32 configHash,
        uint64 expiresAt
    );

    event ChangeApproved(
        uint256 indexed id,
        address indexed approver
    );

    event ChangeRejected(
        uint256 indexed id,
        address indexed rejecter
    );

    event ChangeExpired(uint256 indexed id);

    event ChangeExecuted(
        uint256 indexed id,
        address indexed executor,
        bytes32 appliedConfigHash,
        uint64 executedAt
    );

    modifier onlyAdmin() {
        require(admins[msg.sender], "Not an admin");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "Not the executor");
        _;
    }

    constructor(address executorAddress) {
        require(
            executorAddress != address(0),
            "Invalid executor"
        );

        admins[msg.sender] = true;
        adminCount = 1;
        executor = executorAddress;
    }

    function setAdmin(
        address account,
        bool enabled
    ) external onlyAdmin {
        require(account != address(0), "Invalid address");
        require(admins[account] != enabled, "No change");

        if (enabled) {
            admins[account] = true;
            adminCount++;
        } else {
            require(adminCount > 1, "Cannot remove last admin");
            admins[account] = false;
            adminCount--;
        }

        emit AdminUpdated(account, enabled);
    }

    function setExecutor(
        address newExecutor
    ) external onlyAdmin {
        require(newExecutor != address(0), "Invalid executor");

        executor = newExecutor;
        emit ExecutorUpdated(newExecutor);
    }

    function proposeChange(
        bytes32 configHash,
        uint64 validForSeconds
    ) external onlyAdmin returns (uint256 id) {
        require(configHash != bytes32(0), "Empty config hash");

        require(
            validForSeconds > 0 &&
            validForSeconds <= MAX_VALIDITY,
            "Invalid validity"
        );

        id = proposalCount++;

        proposals[id] = Proposal({
            proposer: msg.sender,
            approver: address(0),
            configHash: configHash,
            expiresAt: uint64(
                block.timestamp + validForSeconds
            ),
            status: Status.Pending,
            executedAt: 0
        });

        emit ChangeProposed(
            id,
            msg.sender,
            configHash,
            proposals[id].expiresAt
        );
    }

    function approveChange(
        uint256 id
    ) external onlyAdmin {
        Proposal storage p = proposals[id];

        require(p.proposer != address(0), "Proposal not found");
        require(p.status == Status.Pending, "Not pending");
        require(
            block.timestamp <= p.expiresAt,
            "Proposal expired"
        );
        require(
            msg.sender != p.proposer,
            "Self approval not allowed"
        );

        p.approver = msg.sender;
        p.status = Status.Approved;

        emit ChangeApproved(id, msg.sender);
    }

    function rejectChange(
        uint256 id
    ) external onlyAdmin {
        Proposal storage p = proposals[id];

        require(p.proposer != address(0), "Proposal not found");
        require(p.status == Status.Pending, "Not pending");
        require(
            block.timestamp <= p.expiresAt,
            "Proposal expired"
        );
        require(
            msg.sender != p.proposer,
            "Proposer cannot reject own request"
        );

        p.status = Status.Rejected;

        emit ChangeRejected(id, msg.sender);
    }

    function expireChange(uint256 id) external {
        Proposal storage p = proposals[id];

        require(p.proposer != address(0), "Proposal not found");
        require(
            p.status == Status.Pending ||
            p.status == Status.Approved,
            "Cannot expire"
        );
        require(
            block.timestamp > p.expiresAt,
            "Not expired"
        );

        p.status = Status.Expired;

        emit ChangeExpired(id);
    }

    function executeChange(
        uint256 id,
        bytes32 appliedConfigHash
    ) external onlyExecutor {
        Proposal storage p = proposals[id];

        require(p.proposer != address(0), "Proposal not found");
        require(p.status == Status.Approved, "Not approved");
        require(
            block.timestamp <= p.expiresAt,
            "Proposal expired"
        );
        require(
            appliedConfigHash == p.configHash,
            "Configuration hash mismatch"
        );

        p.status = Status.Executed;
        p.executedAt = uint64(block.timestamp);

        emit ChangeExecuted(
            id,
            msg.sender,
            appliedConfigHash,
            p.executedAt
        );
    }

    function getChange(
        uint256 id
    )
        external
        view
        returns (
            address proposer,
            address approver,
            bytes32 configHash,
            uint64 expiresAt,
            Status status,
            uint64 executedAt
        )
    {
        Proposal storage p = proposals[id];

        require(p.proposer != address(0), "Proposal not found");

        return (
            p.proposer,
            p.approver,
            p.configHash,
            p.expiresAt,
            p.status,
            p.executedAt
        );
    }
}
