# Four explicit action-bound approvals; never auto-approve, retry or reset.
# Revoke-only recovery is separate and cannot log in Operator or execute Grant.
[CmdletBinding(DefaultParameterSetName = 'Execute')]
param(
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$RetirementProof,
    [Parameter(Mandatory)][string]$CreationReview,
    [Parameter(Mandatory)][string]$ExecutionReview,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedManifestSha,
    [Parameter(Mandatory, ParameterSetName = 'Execute')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedGrantSha,
    [Parameter(Mandatory, ParameterSetName = 'Execute')][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedReadsSha,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedRevokeSha,
    [Parameter(Mandatory, ParameterSetName = 'RecoverRevoke')][switch]$RecoverRevoke
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'ReadComparisonApprovalWindow.psm1') -Scope Local -Force -DisableNameChecking
function Read-Generation6OrdinaryJson([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Absolute local generation6 input required.' }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 600000) { throw 'Bounded ordinary generation6 input required.' }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
$null = Read-Generation6OrdinaryJson $Evidence
$proof = Read-Generation6OrdinaryJson $RetirementProof
if ($proof.outcome -cne 'RETIRED_LOCKED_VERIFIED') { throw 'Successful retirement proof required. No client/MFA/write.' }
$creation = Read-Generation6OrdinaryJson $CreationReview
if ($creation.stage -cne 'B5-J5g-j23' -or $creation.action -cne 'REVIEW_GENERATION6_GRANT_CREATE') { throw 'generation6 requires its own exact creation review. No client/MFA/write.' }
$review = Read-Generation6OrdinaryJson $ExecutionReview
$manifest = $review.manifest
if ($null -eq $manifest -or $manifest.stage -cne 'B5-J5g-j23' -or $manifest.action -cne 'REVIEW_GENERATION6_STACK_READ_WORKFLOW' -or
    $manifest.requiredPhrase -cne 'I_CONFIRM_J5GJ23_GENERATION6_STACK_READ_GRANT_TWO_READS_AND_IMMEDIATE_REVOKE' -or
    $manifest.manifestSha256 -cne $ApprovedManifestSha -or $manifest.actionSha256.revoke -cne $ApprovedRevokeSha) {
    throw 'New exact generation6 Manifest/Revoke approval required. No AWS write.'
}
if (-not [IO.Path]::IsPathRooted($Output)) { throw 'New absolute generation6 outputs required.' }
$inspectOutput = [IO.Path]::ChangeExtension($Output, '.inspect.json')
if ($Output -ceq $inspectOutput) { throw 'Run and independent Inspect outputs must differ.' }
foreach ($taskPath in @($Output, $inspectOutput)) {
    if (Test-Path -LiteralPath $taskPath) { throw 'Every output must be new. Never replay a write.' }
    if ($taskPath.StartsWith('\\') -or $taskPath.StartsWith('//')) { throw 'Local outputs required.' }
    foreach ($part in ($taskPath -split '[\\/]')) { if ($part -in @('.git', '.aws', '.codex', '.agents', '.aws-sandbox')) { throw 'Output cannot be a protected record.' } }
}
$common = @('--evidence', $Evidence, '--retirement-proof', $RetirementProof, '--creation-review', $CreationReview, '--manifest', $ExecutionReview)
$arguments = $common + @('--output', $Output, '--approved-manifest-sha', $ApprovedManifestSha, '--approved-revoke-sha', $ApprovedRevokeSha, '--acknowledge-aws-write', '--acknowledge-low-cost-not-zero')
if ($PSCmdlet.ParameterSetName -eq 'RecoverRevoke') {
    $arguments += @('--mode', 'RecoverRevoke', '--execution-phrase', 'I_CONFIRM_J5GJ23_GENERATION6_REVOKE_ONLY')
} else {
    if ($manifest.actionSha256.grantExecute -cne $ApprovedGrantSha -or $manifest.actionSha256.operatorReads -cne $ApprovedReadsSha) { throw 'Explicit Grant/Reads action SHA approval required. No AWS write.' }
    Assert-ReadComparisonApprovalWindow $manifest.input.reviewedAt $manifest.input.expiresAt
    $arguments += @('--mode', 'RunReviewed', '--approved-grant-sha', $ApprovedGrantSha, '--approved-reads-sha', $ApprovedReadsSha, '--execution-phrase', $manifest.requiredPhrase)
}
$taskNodeBinary = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$entry = Join-Path $PSScriptRoot 's3-b5-arn-probe-stack-control-generation6-workflow.ts'
$runExit = -1
try { & $taskNodeBinary --experimental-strip-types $entry @arguments; $runExit = $LASTEXITCODE }
finally {
    # Independent Source-only process; never repeats a write or Operator call.
    & $taskNodeBinary --experimental-strip-types $entry @common --mode Inspect --output $inspectOutput --acknowledge-read-only
    if ($LASTEXITCODE -ne 0) { throw 'Independent Locked Inspect blocked. Preserve records; no write replay.' }
    $inspect = Read-Generation6OrdinaryJson $inspectOutput
    if ($inspect.outcome -cne 'LOCKED_VERIFIED') { throw 'Revoke required; use separate exact revoke-only approval. No automatic recovery.' }
}
if ($runExit -ne 0) { throw 'Run/recovery returned nonzero; independent Locked Inspect is saved. No write retry.' }
