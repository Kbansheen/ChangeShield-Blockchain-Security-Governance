# ChangeShield end-to-end demonstration runner
# Run from the project root while the Hardhat node and Express backend are already running.
# All console output is appended to .\demo-logs\ChangeShield-Demonstration-Log.txt

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ApiBase = 'http://127.0.0.1:3000'
$RpcUrl = 'http://127.0.0.1:8545'
$LogDirectory = Join-Path $ProjectRoot 'demo-logs'
$LogPath = Join-Path $LogDirectory 'ChangeShield-Demonstration-Log.txt'
$TranscriptStarted = $false

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

try {
    Start-Transcript -Path $LogPath -Append -Force | Out-Null
    $TranscriptStarted = $true

    function Write-Section {
        param([Parameter(Mandatory = $true)][string]$Title)
        Write-Host ''
        Write-Host ('=' * 78) -ForegroundColor DarkCyan
        Write-Host $Title -ForegroundColor Cyan
        Write-Host ('=' * 78) -ForegroundColor DarkCyan
    }

    function Write-Subsection {
        param([Parameter(Mandatory = $true)][string]$Title)
        Write-Host ''
        Write-Host ('--- ' + $Title + ' ---') -ForegroundColor Yellow
    }

    function Show-Json {
        param(
            [Parameter(Mandatory = $true)][string]$Title,
            [Parameter(Mandatory = $true)]$Value
        )
        Write-Host $Title -ForegroundColor Green
        $json = $Value | ConvertTo-Json -Depth 20
        Write-Host $json
    }

    function Get-HttpErrorText {
        param($ErrorRecord)
        if ($null -ne $ErrorRecord.ErrorDetails -and
            -not [string]::IsNullOrWhiteSpace($ErrorRecord.ErrorDetails.Message)) {
            return $ErrorRecord.ErrorDetails.Message
        }
        return $ErrorRecord.Exception.Message
    }

    function Invoke-Api {
        param(
            [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
            [Parameter(Mandatory = $true)][string]$Path,
            [Parameter()][object]$Body
        )

        $uri = $ApiBase + $Path
        if ($Method -eq 'GET') {
            return Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 30
        }

        $jsonBody = $Body | ConvertTo-Json -Depth 20
        return Invoke-RestMethod -Method Post -Uri $uri `
            -ContentType 'application/json' -Body $jsonBody -TimeoutSec 60
    }

    function Show-ProposalAudit {
        param([Parameter(Mandatory = $true)][string]$ProposalId)

        Write-Subsection "Per-proposal blockchain audit: proposal #$ProposalId"

        # Prefer the proposal-specific endpoint if it has been added to this backend.
        try {
            $specificAudit = Invoke-Api -Method GET -Path "/api/changes/$ProposalId/audit"
            Show-Json -Title 'Proposal-specific audit response:' -Value $specificAudit
            return
        }
        catch {
            Write-Host 'Proposal-specific audit route is unavailable; filtering the global on-chain audit instead.' -ForegroundColor DarkYellow
        }

        $globalAudit = Invoke-Api -Method GET -Path '/api/audit'
        $matchingEvents = @(
            $globalAudit.events | Where-Object {
                $null -ne $_.args -and
                $null -ne $_.args.id -and
                ([string]$_.args.id -eq $ProposalId)
            }
        )

        $filtered = [PSCustomObject]@{
            proposalId = $ProposalId
            totalEvents = $matchingEvents.Count
            events = $matchingEvents
        }
        Show-Json -Title 'Filtered blockchain events for this proposal:' -Value $filtered
    }

    function Invoke-JsonRpc {
        param(
            [Parameter(Mandatory = $true)][string]$Method,
            [Parameter()][object[]]$Params = @(),
            [Parameter(Mandatory = $true)][int]$Id
        )
        $rpcBody = @{
            jsonrpc = '2.0'
            method = $Method
            params = $Params
            id = $Id
        } | ConvertTo-Json -Depth 10 -Compress

        return Invoke-RestMethod -Method Post -Uri $RpcUrl `
            -ContentType 'application/json' -Body $rpcBody -TimeoutSec 30
    }

    Write-Section 'CHANGESHIELD | AUTOMATED DEMONSTRATION RUN'
    Write-Host "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
    Write-Host "Project folder: $ProjectRoot"
    Write-Host "Log file (append mode): $LogPath"
    Write-Host 'Application: Privileged Account Security Management'
    Write-Host 'Note: This script submits real transactions to your local Hardhat chain and updates config.json in Scenario 1.' -ForegroundColor Yellow

    if (-not (Test-Path (Join-Path $ProjectRoot 'deployments\local.json'))) {
        throw 'deployments\local.json was not found. Run this script from a copy located in the ChangeShield project root.'
    }
    if (-not (Test-Path (Join-Path $ProjectRoot 'backend\data\config.json'))) {
        throw 'backend\data\config.json was not found.'
    }

    Write-Section 'PRE-FLIGHT | CHECK BACKEND, BLOCKCHAIN, AND CURRENT CONFIGURATION'
    $health = Invoke-Api -Method GET -Path '/api/health'
    Show-Json -Title 'Backend health:' -Value $health
    if ($health.status -ne 'ok') {
        throw 'Backend health check did not return status=ok.'
    }

    $configBefore = Invoke-Api -Method GET -Path '/api/config'
    Show-Json -Title 'Configuration before demonstration:' -Value $configBefore

    $currentAttempts = [int]$configBefore.maxLoginAttempts
    if ($currentAttempts -ne 5) {
        throw "This demonstration expects the starting maxLoginAttempts value to be 5, but the current value is $currentAttempts. The script stops rather than silently changing a different baseline. Restore the demo baseline through an approved ChangeShield proposal before running the demonstration again."
    }

    # Fixed case-study baseline: 5 failed attempts -> 3 failed attempts.
    $scenario1Target = 3

    Write-Host "Pre-flight passed. Login-attempt policy will change from $currentAttempts to $scenario1Target in Scenario 1." -ForegroundColor Green

    # -------------------------------------------------------------------------
    # SCENARIO 1: repeated failed logins -> propose, approve, execute
    # -------------------------------------------------------------------------
    Write-Section 'SCENARIO 1 | RESPOND TO REPEATED FAILED PRIVILEGED-ACCOUNT LOGINS'
    Write-Host "Situation: Repeated failed login attempts are observed. Administrator A proposes reducing the limit from $currentAttempts to $scenario1Target. Administrator B must approve before execution."

    $scenario1Body = @{
        reason = "Repeated failed login attempts against privileged accounts; reduce the login-attempt limit from $currentAttempts to $scenario1Target."
        patch = @{ maxLoginAttempts = $scenario1Target }
        validForSeconds = 3600
    }
    $scenario1Created = Invoke-Api -Method POST -Path '/api/changes' -Body $scenario1Body
    Show-Json -Title 'STEP 1A | Administrator A proposal response:' -Value $scenario1Created
    $scenario1Id = [string]$scenario1Created.proposal.id
    if ([string]::IsNullOrWhiteSpace($scenario1Id)) {
        throw 'Scenario 1 proposal response did not contain a proposal ID.'
    }
    Show-ProposalAudit -ProposalId $scenario1Id

    $configAfterProposal = Invoke-Api -Method GET -Path '/api/config'
    Show-Json -Title 'STEP 1B | Configuration after proposal (must remain unchanged):' -Value $configAfterProposal
    if ([int]$configAfterProposal.maxLoginAttempts -ne $currentAttempts) {
        throw 'Configuration changed before approval and execution. Stop the demonstration and inspect the backend.'
    }

    $scenario1Approval = Invoke-Api -Method POST -Path "/api/changes/$scenario1Id/approve"
    Show-Json -Title 'STEP 1C | Administrator B approval response:' -Value $scenario1Approval
    Show-ProposalAudit -ProposalId $scenario1Id

    $scenario1Execution = Invoke-Api -Method POST -Path "/api/changes/$scenario1Id/execute"
    Show-Json -Title 'STEP 1D | Backend executor response:' -Value $scenario1Execution
    Show-ProposalAudit -ProposalId $scenario1Id

    $scenario1Final = Invoke-Api -Method GET -Path '/api/config'
    Show-Json -Title 'STEP 1E | Configuration after execution:' -Value $scenario1Final
    if ([int]$scenario1Final.maxLoginAttempts -ne $scenario1Target) {
        throw 'Scenario 1 execution did not result in the expected config.json value.'
    }

    Write-Subsection 'STEP 1F | Attempt duplicate execution (must be rejected)'
    try {
        $duplicateResult = Invoke-Api -Method POST -Path "/api/changes/$scenario1Id/execute"
        Show-Json -Title 'UNEXPECTED: duplicate execution response:' -Value $duplicateResult
        throw 'Duplicate execution was unexpectedly accepted.'
    }
    catch {
        $duplicateError = Get-HttpErrorText $_
        if ($duplicateError -eq 'Duplicate execution was unexpectedly accepted.') { throw }
        Write-Host 'Expected rejection: duplicate execution was blocked.' -ForegroundColor Green
        Write-Host $duplicateError
    }
    Show-ProposalAudit -ProposalId $scenario1Id

    # -------------------------------------------------------------------------
    # SCENARIO 2: risky firewall policy proposal -> reject
    # -------------------------------------------------------------------------
    Write-Section 'SCENARIO 2 | REJECT A FIREWALL CHANGE THAT COULD DISRUPT LEGITIMATE ACCESS'
    $configBeforeReject = Invoke-Api -Method GET -Path '/api/config'
    $currentFirewall = [string]$configBeforeReject.firewallMode
    if ($currentFirewall -ne 'restricted') {
        $proposedFirewall = 'restricted'
    }
    else {
        $proposedFirewall = 'standard'
    }

    Write-Host "Situation: A proposed firewall policy change to '$proposedFirewall' is considered operationally risky during legitimate access/maintenance. Administrator B rejects it."

    $scenario2Body = @{
        reason = "Review required: proposed firewall mode '$proposedFirewall' could disrupt legitimate privileged or maintenance access."
        patch = @{ firewallMode = $proposedFirewall }
        validForSeconds = 3600
    }
    $scenario2Created = Invoke-Api -Method POST -Path '/api/changes' -Body $scenario2Body
    Show-Json -Title 'STEP 2A | Firewall-change proposal response:' -Value $scenario2Created
    $scenario2Id = [string]$scenario2Created.proposal.id
    Show-ProposalAudit -ProposalId $scenario2Id

    $scenario2Rejected = Invoke-Api -Method POST -Path "/api/changes/$scenario2Id/reject"
    Show-Json -Title 'STEP 2B | Administrator B rejection response:' -Value $scenario2Rejected
    Show-ProposalAudit -ProposalId $scenario2Id

    $configAfterReject = Invoke-Api -Method GET -Path '/api/config'
    Show-Json -Title 'STEP 2C | Configuration after rejection (must be unchanged):' -Value $configAfterReject
    if ([string]$configAfterReject.firewallMode -ne $currentFirewall) {
        throw 'Firewall configuration changed even though the proposal was rejected.'
    }

    # -------------------------------------------------------------------------
    # SCENARIO 3: missed approval deadline -> automatic expiry
    # -------------------------------------------------------------------------
    Write-Section 'SCENARIO 3 | UNREVIEWED SECURITY REQUEST EXPIRES AUTOMATICALLY'
    $expiryTarget = if ($scenario1Target -gt 1) { $scenario1Target - 1 } else { 2 }
    Write-Host "Situation: A further login-policy request (maxLoginAttempts=$expiryTarget) is not reviewed before its 60-second deadline. The background monitor should expire it without a manual /expire call."

    $scenario3Body = @{
        reason = "Time-sensitive privileged-login security request awaiting review; demonstration of automatic expiry."
        patch = @{ maxLoginAttempts = $expiryTarget }
        validForSeconds = 60
    }
    $scenario3Created = Invoke-Api -Method POST -Path '/api/changes' -Body $scenario3Body
    Show-Json -Title 'STEP 3A | Short-lived proposal response:' -Value $scenario3Created
    $scenario3Id = [string]$scenario3Created.proposal.id
    Show-ProposalAudit -ProposalId $scenario3Id

    Write-Subsection 'STEP 3B | Advance local Hardhat time by 70 seconds and mine a block'
    $timeResult = Invoke-JsonRpc -Method 'evm_increaseTime' -Params @(70) -Id 31
    Show-Json -Title 'Hardhat evm_increaseTime result:' -Value $timeResult
    $mineResult = Invoke-JsonRpc -Method 'evm_mine' -Params @() -Id 32
    Show-Json -Title 'Hardhat evm_mine result:' -Value $mineResult

    Write-Host 'Waiting for the backend automatic-expiry monitor (no manual expiry endpoint will be called)...' -ForegroundColor Yellow
    $scenario3Final = $null
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        Start-Sleep -Seconds 5
        $scenario3Final = Invoke-Api -Method GET -Path "/api/changes/$scenario3Id"
        if ($scenario3Final.status -eq 'Expired') { break }
        Write-Host "Check $attempt/12: proposal status is $($scenario3Final.status)."
    }

    Show-Json -Title 'STEP 3C | Automatic-expiry final proposal status:' -Value $scenario3Final
    if ($scenario3Final.status -ne 'Expired') {
        throw 'The proposal did not become Expired within 60 seconds. Check that automatic expiry monitoring is enabled in backend/server.mjs.'
    }
    Show-ProposalAudit -ProposalId $scenario3Id

    $configAfterExpiry = Invoke-Api -Method GET -Path '/api/config'
    Show-Json -Title 'STEP 3D | Configuration after expiry (must remain unchanged):' -Value $configAfterExpiry
    if ([int]$configAfterExpiry.maxLoginAttempts -ne $scenario1Target) {
        throw 'Configuration changed even though the proposal expired without execution.'
    }

    # -------------------------------------------------------------------------
    # SCENARIO 4: invalid configuration -> backend rejects before blockchain tx
    # -------------------------------------------------------------------------
    Write-Section 'SCENARIO 4 | REJECT AN UNSUPPORTED SECURITY SETTING BEFORE BLOCKCHAIN SUBMISSION'
    $changesBeforeInvalid = Invoke-Api -Method GET -Path '/api/changes'
    $countBeforeInvalid = [int]$changesBeforeInvalid.total

    $invalidBody = @{
        reason = 'Attempt to disable security monitoring using an unsupported configuration key.'
        patch = @{ disableSecurityMonitoring = $true }
        validForSeconds = 3600
    }

    try {
        $invalidResponse = Invoke-Api -Method POST -Path '/api/changes' -Body $invalidBody
        Show-Json -Title 'UNEXPECTED: invalid configuration response:' -Value $invalidResponse
        throw 'Unsupported configuration was unexpectedly accepted.'
    }
    catch {
        $invalidError = Get-HttpErrorText $_
        if ($invalidError -eq 'Unsupported configuration was unexpectedly accepted.') { throw }
        Write-Host 'Expected backend validation rejection:' -ForegroundColor Green
        Write-Host $invalidError
    }

    $changesAfterInvalid = Invoke-Api -Method GET -Path '/api/changes'
    $countAfterInvalid = [int]$changesAfterInvalid.total
    Write-Host "Proposal count before invalid request: $countBeforeInvalid"
    Write-Host "Proposal count after invalid request:  $countAfterInvalid"
    if ($countAfterInvalid -ne $countBeforeInvalid) {
        throw 'An unsupported configuration request unexpectedly created a blockchain proposal.'
    }
    Write-Host 'Verified: invalid setting rejected before a ChangeProposed blockchain event was created.' -ForegroundColor Green

    # -------------------------------------------------------------------------
    # FINAL SUMMARY AND GLOBAL AUDIT
    # -------------------------------------------------------------------------
    Write-Section 'FINAL CONFIGURATION'
    $finalConfig = Invoke-Api -Method GET -Path '/api/config'
    Show-Json -Title 'Final backend configuration:' -Value $finalConfig
    $configFilePath = Join-Path $ProjectRoot 'backend\data\config.json'
    $configFileContent = Get-Content -LiteralPath $configFilePath -Raw
    Write-Host 'Actual backend\data\config.json:' -ForegroundColor Green
    Write-Host $configFileContent

    Write-Section 'GLOBAL BLOCKCHAIN AUDIT HISTORY'
    $audit = Invoke-Api -Method GET -Path '/api/audit'
    Write-Host "Total on-chain events currently returned: $($audit.totalEvents)"
    Show-Json -Title 'Global blockchain audit:' -Value $audit

    Write-Section 'DEMONSTRATION SUMMARY'
    Write-Host "Scenario 1 - Security login threshold: Proposal #$scenario1Id; executed; maxLoginAttempts=$scenario1Target" -ForegroundColor Green
    Write-Host "Scenario 2 - Risky firewall change: Proposal #$scenario2Id; rejected; firewall remains $currentFirewall" -ForegroundColor Green
    Write-Host "Scenario 3 - Missed approval deadline: Proposal #$scenario3Id; automatically expired" -ForegroundColor Green
    Write-Host 'Scenario 4 - Unsupported setting: rejected by backend validation; no blockchain proposal created' -ForegroundColor Green
    Write-Host 'Duplicate execution: rejected' -ForegroundColor Green
    Write-Host ''
    Write-Host "Completed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
    Write-Host "All output was appended to: $LogPath" -ForegroundColor Cyan
}
catch {
    Write-Host ''
    Write-Host 'DEMONSTRATION STOPPED' -ForegroundColor Red
    Write-Host (Get-HttpErrorText $_) -ForegroundColor Red
    Write-Host "Review the backend terminal and the appended log: $LogPath" -ForegroundColor Yellow
    throw
}
finally {
    if ($TranscriptStarted) {
        Stop-Transcript | Out-Null
    }
}
