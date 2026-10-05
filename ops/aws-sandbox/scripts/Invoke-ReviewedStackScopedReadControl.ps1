# Separate explicit Create and Grant/reads/Revoke approvals. No default SHA,
# automatic write approval, reset, successor or retry. MFA is terminal-only.
[CmdletBinding(DefaultParameterSetName = 'Create')]
param(
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$CreationReview,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory, ParameterSetName = 'Create')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedCreationReviewSha,
    [Parameter(Mandatory, ParameterSetName = 'Execute')]
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][string]$ExecutionReview,
    [Parameter(Mandatory, ParameterSetName = 'Execute')]
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedManifestSha,
    [Parameter(Mandatory, ParameterSetName = 'Execute')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedGrantSha,
    [Parameter(Mandatory, ParameterSetName = 'Execute')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedReadsSha,
    [Parameter(Mandatory, ParameterSetName = 'Execute')]
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedRevokeSha,
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][switch]$RecoverRevoke
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'ReadComparisonApprovalWindow.psm1') -Scope Local -Force -DisableNameChecking
function Read-OrdinaryJson([string]$Path, [long]$MaxBytes = 600000) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Every input must be absolute.' }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt $MaxBytes) { throw 'Bounded ordinary input required.' }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
$null = Read-OrdinaryJson $Evidence
$creation = Read-OrdinaryJson $CreationReview 2000000
if ($creation.stage -cne 'B5-J5g-j22' -or $creation.action -cne 'REVIEW_GENERATION5_STACK_SCOPED_GRANT_CREATE') { throw 'J22 requires its own exact creation review. No client/MFA/write.' }
if (-not [IO.Path]::IsPathRooted($Output)) { throw 'Output must be absolute.' }
$recoverOutput = [IO.Path]::ChangeExtension($Output, '.recover.json')
$executionOutput = [IO.Path]::ChangeExtension($Output, '.execution-review.json')
$inspectOutput = [IO.Path]::ChangeExtension($Output, '.inspect.json')
$requiredOutputs = @($Output)
if ($PSCmdlet.ParameterSetName -eq 'Create') { $requiredOutputs += @($recoverOutput, $executionOutput) } else { $requiredOutputs += $inspectOutput }
foreach ($path in $requiredOutputs) {
    if (Test-Path -LiteralPath $path) { throw 'Every output must be new. Never replay a write.' }
    foreach ($part in ($path -split '[\\/]')) { if ($part -in @('.git', '.aws', '.codex', '.agents', '.aws-sandbox')) { throw 'Output cannot be a protected record.' } }
}
$taskNodeBinary = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$createEntry = Join-Path $PSScriptRoot 's3-b5-arn-probe-stack-scoped-read-control-create.ts'
$workflowEntry = Join-Path $PSScriptRoot 's3-b5-arn-probe-stack-scoped-read-control-workflow.ts'
$common = @('--evidence', $Evidence)
if ($PSCmdlet.ParameterSetName -eq 'Create') {
    if ($creation.reviewSha256 -cne $ApprovedCreationReviewSha) { throw 'Explicit new complete creation SHA approval required. No AWS write.' }
    Assert-ReadComparisonApprovalWindow $creation.issuedAt $creation.expiresAt
    & $taskNodeBinary --experimental-strip-types $createEntry @common --mode CreateReviewed --review $CreationReview --output $Output --approved-review-sha256 $ApprovedCreationReviewSha --execution-phrase $creation.requiredPhrase --acknowledge-aws-write --acknowledge-named-iam-unexecuted-only --acknowledge-permanent-slot-and-old-records --acknowledge-low-cost-not-zero
    # Lost/failed Create is followed only by a separate read. Never retry Create.
    & $taskNodeBinary --experimental-strip-types $createEntry @common --mode RecoverCreate --review $CreationReview --output $recoverOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Independent Create recovery blocked; use a new read-only output, never replay Create.' }
    $recovered = Read-OrdinaryJson $recoverOutput
    if ($recovered.outcome -cne 'READY_UNEXECUTED') { throw 'Ready Grant unproved. No installation review or retry.' }
    & $taskNodeBinary --experimental-strip-types $workflowEntry @common --mode Review --creation-review $CreationReview --output $executionOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Source-only execution review blocked. Grant was not installed by this wrapper.' }
    $review = Read-OrdinaryJson $executionOutput 2000000
    Write-Host "Execution review (not approved): $executionOutput"
    Write-Host "Manifest SHA: $($review.manifest.manifestSha256)"
    Write-Host "Grant action SHA: $($review.manifest.actionSha256.grantExecute)"
    Write-Host "Reads action SHA: $($review.manifest.actionSha256.operatorReads)"
    Write-Host "Revoke action SHA: $($review.manifest.actionSha256.revoke)"
    Write-Host "Expires: $($review.manifest.input.expiresAt)"
    # Display only: execution requires the human to separately supply all SHAs.
    Write-Host 'After separate review/approval, use Execute parameter set with explicit Manifest/Grant/Reads/Revoke SHA values. This wrapper does not install automatically.'
} else {
    $review = Read-OrdinaryJson $ExecutionReview 2000000
    $manifest = $review.manifest
    if ($null -eq $manifest -or $manifest.stage -cne 'B5-J5g-j22' -or $manifest.action -cne 'REVIEW_STACK_SCOPED_READ_WORKFLOW' -or $manifest.manifestSha256 -cne $ApprovedManifestSha -or $manifest.actionSha256.revoke -cne $ApprovedRevokeSha) { throw 'New exact J22 manifest/Revoke approval required. No AWS write.' }
    $arguments = $common + @('--creation-review', $CreationReview, '--manifest', $ExecutionReview, '--output', $Output, '--approved-manifest-sha', $ApprovedManifestSha, '--approved-revoke-sha', $ApprovedRevokeSha, '--acknowledge-aws-write', '--acknowledge-low-cost-not-zero')
    if ($PSCmdlet.ParameterSetName -eq 'RecoverRevoke') {
        $arguments += @('--mode', 'RecoverRevoke', '--execution-phrase', 'I_CONFIRM_J5GJ22_REVOKE_ONLY')
    } else {
        if ($manifest.actionSha256.grantExecute -cne $ApprovedGrantSha -or $manifest.actionSha256.operatorReads -cne $ApprovedReadsSha) { throw 'Explicit Grant/Reads action SHA approval required. No AWS write.' }
        Assert-ReadComparisonApprovalWindow $manifest.input.reviewedAt $manifest.input.expiresAt
        $arguments += @('--mode', 'RunReviewed', '--approved-grant-sha', $ApprovedGrantSha, '--approved-reads-sha', $ApprovedReadsSha, '--execution-phrase', $manifest.requiredPhrase)
    }
    $runExit = 1
    try { & $taskNodeBinary --experimental-strip-types $workflowEntry @arguments; $runExit = $LASTEXITCODE }
    finally {
        # Independent process/read; never repeats Grant/Operator/Revoke writes.
        & $taskNodeBinary --experimental-strip-types $workflowEntry @common --mode Inspect --creation-review $CreationReview --manifest $ExecutionReview --output $inspectOutput --acknowledge-read-only
        if ($LASTEXITCODE -ne 0) { throw 'Independent Locked Inspect blocked. Preserve records; no write replay.' }
        $inspect = Read-OrdinaryJson $inspectOutput
        if ($inspect.outcome -cne 'LOCKED_VERIFIED') { throw 'Revoke required; use separate exact revoke-only approval. No automatic recovery.' }
    }
    if ($runExit -ne 0) { throw 'Run/recovery returned nonzero; independent Locked Inspect is saved. No write retry.' }
}
