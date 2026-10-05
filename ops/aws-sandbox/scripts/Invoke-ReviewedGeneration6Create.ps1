# One exact fresh generation6 Create, recovery, then Source-only install review.
# No installer or Operator/MFA is invoked; display is never action approval.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$RetirementProof,
    [Parameter(Mandatory)][string]$CreateReview,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedReviewSha,
    [Parameter(Mandatory)][string]$Output
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
if ($proof.outcome -cne 'RETIRED_LOCKED_VERIFIED') { throw 'Successful retirement proof required; no generation6 write.' }
$review = Read-Generation6OrdinaryJson $CreateReview
if ($review.stage -cne 'B5-J5g-j23' -or $review.action -cne 'REVIEW_GENERATION6_GRANT_CREATE' -or $review.reviewSha256 -cne $ApprovedReviewSha -or
    $review.requiredPhrase -cne 'I_CONFIRM_J5GJ23_CREATE_GENERATION6_STACK_READ_GRANT_ONLY') { throw 'Separate full generation6 create approval not supplied. No AWS write.' }
Assert-ReadComparisonApprovalWindow $review.issuedAt $review.expiresAt
$recoveryOutput = [IO.Path]::ChangeExtension($Output, '.recover.json')
$executionOutput = [IO.Path]::ChangeExtension($Output, '.execution-review.json')
if (-not [IO.Path]::IsPathRooted($Output) -or $Output -ceq $recoveryOutput -or $Output -ceq $executionOutput) { throw 'Distinct absolute generation6 outputs required.' }
foreach ($taskPath in @($Output, $recoveryOutput, $executionOutput)) {
    if (Test-Path -LiteralPath $taskPath) { throw 'New absolute generation6 outputs required.' }
    if ($taskPath.StartsWith('\\') -or $taskPath.StartsWith('//')) { throw 'Local outputs required.' }
    foreach ($part in ($taskPath -split '[\\/]')) { if ($part -in @('.git', '.aws', '.codex', '.agents', '.aws-sandbox')) { throw 'Output cannot be a protected record.' } }
}
$taskNodeBinary = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$entry = Join-Path $PSScriptRoot 's3-b5-arn-probe-stack-control-generation6-create.ts'
$creationExit = -1
try {
    & $taskNodeBinary --experimental-strip-types $entry --mode CreateReviewed --evidence $Evidence --retirement-proof $RetirementProof --review $CreateReview --output $Output --approved-review-sha256 $ApprovedReviewSha --execution-phrase $review.requiredPhrase --acknowledge-aws-write --acknowledge-named-iam-unexecuted-only --acknowledge-permanent-slot-and-old-records --acknowledge-low-cost-not-zero
    $creationExit = $LASTEXITCODE
} finally {
    # Separate Source-only process on success/uncertain response; never Create again.
    & $taskNodeBinary --experimental-strip-types $entry --mode RecoverCreate --evidence $Evidence --retirement-proof $RetirementProof --review $CreateReview --output $recoveryOutput --acknowledge-read-only
    $recoveryExit = $LASTEXITCODE
}
if ($recoveryExit -ne 0) { throw 'Generation6 independent recovery blocked; preserve slot and never replay Create.' }
$recovered = Read-Generation6OrdinaryJson $recoveryOutput
if ($recovered.outcome -cne 'READY_UNEXECUTED') { throw 'Generation6 creation unproved; no installation or retry.' }
if ($creationExit -ne 0) { Write-Warning 'Create entry failed; independent read-only recovery is the evidence, never retry Create.' }
Write-Host "Independent unexecuted Grant evidence: $recoveryOutput"
$workflowEntry = Join-Path $PSScriptRoot 's3-b5-arn-probe-stack-control-generation6-workflow.ts'
& $taskNodeBinary --experimental-strip-types $workflowEntry --mode Review --evidence $Evidence --retirement-proof $RetirementProof --creation-review $CreateReview --output $executionOutput --acknowledge-read-only
if ($LASTEXITCODE -ne 0) { throw 'Source-only installation review blocked. Grant remains unexecuted; no automatic install/retry.' }
$executionReview = Read-Generation6OrdinaryJson $executionOutput
Write-Host "Execution review (not approved): $executionOutput"
Write-Host "Manifest SHA: $($executionReview.manifest.manifestSha256)"
Write-Host "Grant action SHA: $($executionReview.manifest.actionSha256.grantExecute)"
Write-Host "Reads action SHA: $($executionReview.manifest.actionSha256.operatorReads)"
Write-Host "Revoke action SHA: $($executionReview.manifest.actionSha256.revoke)"
Write-Host "Expires (UTC): $($executionReview.manifest.input.expiresAt)"
Write-Host 'No Grant/child execution or Operator login authorized; use the separate read-control wrapper only after fresh explicit four-SHA approval.'
