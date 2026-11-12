const $ = (id) => document.getElementById(id);

let currentConfig = {};
let currentChanges = [];
let currentAudit = [];

const PAGE_TITLES = {
  overview: "Overview",
  proposals: "Change Proposals",
  scenarios: "Demo Scenarios",
  audit: "Blockchain Audit",
  architecture: "Architecture"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function showMessage(message, type = "success") {
  const element = $("globalMessage");
  element.textContent = message;
  element.className = `global-message ${type}`;
  element.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showResult(elementId, message, type = "success") {
  const element = $(elementId);
  if (!element) return;

  element.textContent = message;
  element.className = `action-result ${type}`;
  element.classList.remove("hidden");
}

/*
 * Displays a red validation-denied result.
 * The function name is retained to preserve existing callers.
 */
function showValidationSuccess(elementId) {
  const result = $(elementId);
  if (!result) return;

  result.innerHTML = `
    <div class="validation-success">
      <div class="validation-heading">
        <span class="validation-icon">✕</span>
        <strong>Security validation failed — Request denied</strong>
        <span class="validation-badge">BLOCKED</span>
      </div>

      <h4>Change request blocked</h4>

      <p>
        The requested configuration change could not be submitted
        because it contains an unsupported security setting.
      </p>

      <div class="validation-details">
        <div>
          <span>Validation result</span>
          <strong>Rejected</strong>
        </div>
        <div>
          <span>Blockchain proposal</span>
          <strong>Not created</strong>
        </div>
        <div>
          <span>Active configuration</span>
          <strong>Unchanged</strong>
        </div>
      </div>

      <p class="validation-footer">
        No unauthorized configuration change was applied.
      </p>
    </div>
  `;

  result.className = "action-result success";
  result.classList.remove("hidden");
}

function hideResult(elementId) {
  const element = $(elementId);
  if (element) {
    element.classList.add("hidden");
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed with status ${response.status}`
    );
  }

  return data;
}

function navigateTo(section) {
  if (!PAGE_TITLES[section]) return;

  document.querySelectorAll(".page-section").forEach((page) => {
    page.classList.remove("active");
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle(
      "active",
      link.dataset.section === section
    );
  });

  const selectedPage = $(`section-${section}`);
  if (selectedPage) {
    selectedPage.classList.add("active");
  }

  $("pageTitle").textContent = PAGE_TITLES[section];

  if (section === "proposals") {
    renderProposalPreview();
  }

  if (section === "audit") {
    loadAudit();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatDate(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function formatStatus(status) {
  return String(status || "Unknown")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized.includes("execut")) return "success";
  if (normalized.includes("approv")) return "success";
  if (normalized.includes("reject")) return "danger";
  if (normalized.includes("expir")) return "warning";

  return "neutral";
}

function configLabel(key) {
  const labels = {
    requireMFA: "Require MFA",
    maxLoginAttempts: "Maximum login attempts",
    firewallMode: "Firewall mode"
  };

  return labels[key] || key;
}

function configValue(key, value) {
  if (key === "requireMFA") {
    return value ? "Enabled" : "Disabled";
  }

  return String(value);
}

function renderConfig(containerId, config) {
  const container = $(containerId);
  if (!container) return;

  const entries = Object.entries(config || {});

  if (!entries.length) {
    container.innerHTML = '<p class="muted">No configuration available.</p>';
    return;
  }

  container.innerHTML = entries.map(([key, value]) => `
    <div class="config-item">
      <span>${escapeHtml(configLabel(key))}</span>
      <strong>${escapeHtml(configValue(key, value))}</strong>
    </div>
  `).join("");
}

function renderProposalPreview() {
  renderConfig("proposalConfigPreview", currentConfig);
}

function normalizeChanges(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.changes)) return data.changes;
  if (Array.isArray(data.proposals)) return data.proposals;
  if (Array.isArray(data.records)) return data.records;
  return [];
}

function normalizeAudit(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.events)) return data.events;
  return [];
}

function getChangeId(change) {
  return change.id ?? change.proposalId ?? change.changeId ?? "--";
}

function getChangeReason(change) {
  return change.reason ?? change.description ?? "--";
}

function getChangePatch(change) {
  const patch = change.patch ?? change.configuration ?? {};

  if (typeof patch === "string") {
    return patch;
  }

  return Object.entries(patch)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ") || "--";
}

function getChangeStatus(change) {
  return change.status ?? change.state ?? "Unknown";
}

function renderChangesTable(containerId, changes, limit = null) {
  const container = $(containerId);
  if (!container) return;

  const records = limit ? changes.slice(-limit).reverse() : [...changes].reverse();

  if (!records.length) {
    container.innerHTML = '<p class="muted">No proposals found.</p>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Reason</th>
          <th>Configuration change</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((change) => {
          const id = getChangeId(change);
          const status = getChangeStatus(change);

          return `
            <tr>
              <td>#${escapeHtml(id)}</td>
              <td>${escapeHtml(getChangeReason(change))}</td>
              <td>${escapeHtml(getChangePatch(change))}</td>
              <td>
                <span class="status-badge ${statusClass(status)}">
                  ${escapeHtml(formatStatus(status))}
                </span>
              </td>
              <td>${escapeHtml(formatDate(change.createdAt ?? change.created_at))}</td>
              <td>
                ${renderChangeActions(change)}
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  attachChangeActionHandlers(container);
}

function renderChangeActions(change) {
  const id = getChangeId(change);
  const status = String(getChangeStatus(change)).toLowerCase();

  if (status.includes("pending")) {
    return `
      <div class="table-actions">
        <button class="small-button approve-action" data-id="${escapeHtml(id)}">Approve</button>
        <button class="small-button reject-action" data-id="${escapeHtml(id)}">Reject</button>
      </div>
    `;
  }

  if (status.includes("approved")) {
    return `
      <button class="small-button execute-action" data-id="${escapeHtml(id)}">Execute</button>
    `;
  }

  return '<span class="muted">No action</span>';
}

function attachChangeActionHandlers(container) {
  container.querySelectorAll(".approve-action").forEach((button) => {
    button.addEventListener("click", () => {
      approveChange(button.dataset.id);
    });
  });

  container.querySelectorAll(".reject-action").forEach((button) => {
    button.addEventListener("click", () => {
      rejectChange(button.dataset.id);
    });
  });

  container.querySelectorAll(".execute-action").forEach((button) => {
    button.addEventListener("click", () => {
      executeChange(button.dataset.id);
    });
  });
}

async function approveChange(id) {
  if (!confirm(`Approve proposal #${id}?`)) return;

  try {
    await apiRequest(`/api/changes/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage(`Proposal #${id} approved successfully.`);
    await refreshAll();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function rejectChange(id) {
  if (!confirm(`Reject proposal #${id}?`)) return;

  try {
    await apiRequest(`/api/changes/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage(`Proposal #${id} rejected.`);
    await refreshAll();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function executeChange(id) {
  if (!confirm(`Execute approved proposal #${id}?`)) return;

  try {
    await apiRequest(`/api/changes/${id}/execute`, {
      method: "POST",
      body: JSON.stringify({})
    });

    showMessage(`Proposal #${id} executed successfully.`);
    await refreshAll();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function updateProposalFormFields() {
  const setting = $("settingName").value;

  const booleanGroup = $("booleanValueGroup");
  const numberGroup = $("numberValueGroup");
  const firewallGroup = $("firewallValueGroup");
  const invalidGroup = $("invalidValueGroup");
  const submitButton = $("proposalSubmitButton");

  booleanGroup.classList.toggle("hidden", setting !== "requireMFA");
  numberGroup.classList.toggle("hidden", setting !== "maxLoginAttempts");
  firewallGroup.classList.toggle("hidden", setting !== "firewallMode");
  invalidGroup.classList.toggle("hidden", setting !== "invalidSetting");

  if (setting === "invalidSetting") {
    submitButton.textContent = "Submit validation test";
  } else {
    submitButton.textContent = "Submit proposal to blockchain";
  }
}

function getProposalPatch() {
  const setting = $("settingName").value;

  if (setting === "invalidSetting") {
    return {
      disableSecurityMonitoring: true
    };
  }

  if (setting === "requireMFA") {
    return {
      requireMFA: $("booleanValue").value === "true"
    };
  }

  if (setting === "maxLoginAttempts") {
    const value = Number($("numberValue").value);

    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new Error("Maximum login attempts must be an integer between 1 and 20.");
    }

    return {
      maxLoginAttempts: value
    };
  }

  if (setting === "firewallMode") {
    return {
      firewallMode: $("firewallValue").value
    };
  }

  throw new Error("Please select a valid configuration setting.");
}

async function handleProposalSubmit(event) {
  event.preventDefault();

  const reason = $("changeReason").value.trim();
  const validForSeconds = Number($("validity").value);
  const submitButton = $("proposalSubmitButton");
  const isValidationTest = $("settingName").value === "invalidSetting";

  hideResult("proposalResult");

  if (reason.length < 3) {
    showResult(
      "proposalResult",
      "Please enter a reason with at least 3 characters.",
      "error"
    );
    return;
  }

  let patch;

  try {
    patch = getProposalPatch();
  } catch (error) {
    showResult("proposalResult", error.message, "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = isValidationTest
    ? "Checking validation..."
    : "Submitting proposal...";

  try {
    await apiRequest("/api/changes", {
      method: "POST",
      body: JSON.stringify({
        reason,
        validForSeconds,
        patch
      })
    });

    if (isValidationTest) {
      showResult(
        "proposalResult",
        "The unsupported setting was unexpectedly accepted. Please check backend validation.",
        "error"
      );

      await refreshAll();
      return;
    }

    showResult(
      "proposalResult",
      "Proposal submitted successfully. It is now awaiting independent administrator approval.",
      "success"
    );

    $("proposalForm").reset();
    updateProposalFormFields();

    await refreshAll();

  } catch (error) {
    const expectedValidationError =
      error.message.includes(
        "Unsupported configuration key: disableSecurityMonitoring"
      );

    if (isValidationTest && expectedValidationError) {
      showValidationSuccess("proposalResult");

      const evidence = $("scenario4Evidence");

      if (evidence) {
        evidence.textContent =
          "PASS: Unsupported setting rejected before blockchain proposal creation. Active configuration remained unchanged.";
      }

      return;
    }

    showResult(
      "proposalResult",
      error.message,
      "error"
    );

  } finally {
    submitButton.disabled = false;
    updateProposalFormFields();
  }
}

async function runInvalidDemo() {
  const button = $("invalidDemoButton");

  button.disabled = true;
  button.textContent = "Running validation test...";

  hideResult("invalidDemoResult");

  try {
    await apiRequest("/api/changes", {
      method: "POST",
      body: JSON.stringify({
        reason: "Demonstration of backend rejection of an unsupported configuration key",
        validForSeconds: 3600,
        patch: {
          disableSecurityMonitoring: true
        }
      })
    });

    showResult(
      "invalidDemoResult",
      "Unexpected result: the backend accepted an unsupported setting.",
      "error"
    );

  } catch (error) {
    if (
      error.message.includes(
        "Unsupported configuration key: disableSecurityMonitoring"
      )
    ) {
      showValidationSuccess("invalidDemoResult");

      $("scenario4Evidence").textContent =
        "PASS: Unsupported setting rejected before blockchain proposal creation. Active configuration remained unchanged.";

    } else {
      showResult(
        "invalidDemoResult",
        error.message,
        "error"
      );
    }

  } finally {
    button.disabled = false;
    button.textContent = "Run invalid-change demonstration";
    await refreshAll();
  }
}

async function loadHealth() {
  try {
    const data = await apiRequest("/api/health");

    const connected = data.status === "ok" || data.ok === true;

    $("healthStatus").textContent = connected ? "Connected" : "Unavailable";
    $("blockNumber").textContent = `Block: ${data.blockNumber ?? "--"}`;
    $("networkName").textContent = data.network ?? data.name ?? "Local Hardhat";
    $("chainId").textContent = data.chainId ?? "31337";
    $("contractAddress").textContent = data.contractAddress ?? "--";

    $("sidebarNetwork").textContent = connected
      ? "Blockchain online"
      : "Blockchain offline";

    $("networkPill").textContent = connected
      ? "● localhost connected"
      : "● connection unavailable";

    $("sidebarDot").classList.toggle("online", connected);

  } catch (error) {
    $("healthStatus").textContent = "Offline";
    $("sidebarNetwork").textContent = "Blockchain offline";
    $("networkPill").textContent = "● connection unavailable";
    $("blockNumber").textContent = "Block: --";
    $("sidebarDot").classList.remove("online");
  }
}

async function loadConfig() {
  try {
    const data = await apiRequest("/api/config");

    currentConfig = data.config ?? data;

    renderConfig("configDisplay", currentConfig);
    renderProposalPreview();

  } catch (error) {
    $("configDisplay").innerHTML =
      `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

async function loadChanges() {
  try {
    const data = await apiRequest("/api/changes");

    currentChanges = normalizeChanges(data);

    $("totalProposals").textContent = currentChanges.length;

    const executed = currentChanges.filter((change) =>
      String(getChangeStatus(change)).toLowerCase().includes("execut")
    ).length;

    $("executedCount").textContent = executed;

    renderChangesTable("recentProposals", currentChanges, 5);
    renderChangesTable("proposalTable", currentChanges);

    updateScenarioEvidence();

  } catch (error) {
    $("recentProposals").innerHTML =
      `<p class="muted">${escapeHtml(error.message)}</p>`;

    $("proposalTable").innerHTML =
      `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

function updateScenarioEvidence() {
  const findById = (id) => currentChanges.find((change) =>
    String(getChangeId(change)) === String(id)
  );

  const scenario1 = findById(0);
  const scenario2 = findById(1);
  const scenario3 = findById(2);
  const scenario4 = $("scenario4Evidence");

  if (scenario1) {
    $("scenario1Evidence").textContent =
      `Proposal #0: ${formatStatus(getChangeStatus(scenario1))}. ${getChangePatch(scenario1)}.`;
  }

  if (scenario2) {
    $("scenario2Evidence").textContent =
      `Proposal #1: ${formatStatus(getChangeStatus(scenario2))}. Configuration was not applied.`;
  }

  if (scenario3) {
    const expired = currentChanges.filter((change) =>
      String(getChangeStatus(change)).toLowerCase().includes("expir")
    );

    $("scenario3Evidence").textContent =
      `Expired proposals recorded: ${expired.map((change) => `#${getChangeId(change)}`).join(", ") || "None"}.`;
  }

  if (
    scenario4 &&
    !scenario4.textContent.includes("PASS:")
  ) {
    scenario4.textContent =
      "Ready to test: submit an unsupported setting through the proposal form or run the demonstration.";
  }
}

async function loadAudit() {
  try {
    const data = await apiRequest("/api/audit");

    currentAudit = normalizeAudit(data);

    $("auditCount").textContent = currentAudit.length;
    $("auditTotal").textContent = currentAudit.length;

    const latestBlock = currentAudit.reduce((maximum, event) => {
      return Math.max(
        maximum,
        Number(event.blockNumber ?? event.block ?? 0)
      );
    }, 0);

    $("auditLatestBlock").textContent = latestBlock || "--";

    if (!currentAudit.length) {
      $("auditTable").innerHTML =
        '<p class="muted">No blockchain events found.</p>';
      return;
    }

    $("auditTable").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Proposal ID</th>
            <th>Block</th>
            <th>Transaction hash</th>
          </tr>
        </thead>
        <tbody>
          ${[...currentAudit].reverse().map((event) => `
            <tr>
              <td>${escapeHtml(event.event ?? event.name ?? "--")}</td>
              <td>${escapeHtml(event.proposalId ?? event.id ?? "--")}</td>
              <td>${escapeHtml(event.blockNumber ?? event.block ?? "--")}</td>
              <td><code>${escapeHtml(event.transactionHash ?? event.txHash ?? "--")}</code></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

  } catch (error) {
    $("auditTable").innerHTML =
      `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

async function refreshAll() {
  await Promise.all([
    loadHealth(),
    loadConfig(),
    loadChanges(),
    loadAudit()
  ]);
}

function initializeNavigation() {
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.section);
    });
  });

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.go);
    });
  });
}

function initializeButtons() {
  $("refreshButton").addEventListener("click", refreshAll);
  $("proposalRefresh").addEventListener("click", refreshAll);
  $("auditRefresh").addEventListener("click", loadAudit);

  $("invalidDemoButton").addEventListener("click", runInvalidDemo);

  $("settingName").addEventListener(
    "change",
    updateProposalFormFields
  );

  $("proposalForm").addEventListener(
    "submit",
    handleProposalSubmit
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeNavigation();
  initializeButtons();
  updateProposalFormFields();

  await refreshAll();

  // Refresh dashboard data periodically while the page is open.
  setInterval(refreshAll, 15000);
});