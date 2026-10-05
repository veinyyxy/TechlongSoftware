# One exact fresh generation5 retirement. No successor chaining or Operator/MFA.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$Manifest,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedManifestSha,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'ReadComparisonApprovalWindow.psm1') -Scope Local -Force -DisableNameChecking
function Read-J23OrdinaryJson([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Absolute input required.' }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 600000) { throw 'Bounded ordinary input required.' }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
$null = Read-J23OrdinaryJson $Evidence
$review = Read-J23OrdinaryJson $Manifest
if ($review.stage -cne 'B5-J5g-j23-retirement' -or $review.manifestSha256 -cne $ApprovedManifestSha -or $review.requiredPhrase -cne 'I_CONFIRM_J5GJ23_RETIRE_EXACT_UNEXECUTED_GENERATION5_GRANT_ONLY') { throw 'New exact generation5 retirement approval not supplied. No AWS write.' }
Assert-ReadComparisonApprovalWindow $review.input.reviewedAt $review.input.expiresAt
$inspectOutput = [IO.Path]::ChangeExtension($Output, '.inspect.json')
if (-not [IO.Path]::IsPathRooted($Output) -or (Test-Path -LiteralPath $Output) -or (Test-Path -LiteralPath $inspectOutput)) { throw 'New absolute outputs required.' }
$taskNodeBinary = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$entry = Join-Path $PSScriptRoot 's3-b5-arn-probe-stack-control-generation5-retirement.ts'
$retirementExit = -1
try {
    & $taskNodeBinary --experimental-strip-types $entry --mode RetireReviewed --evidence $Evidence --output $Output --manifest $Manifest --approved-manifest-sha $ApprovedManifestSha --execution-phrase $review.requiredPhrase --acknowledge-irreversible-deletion --acknowledge-low-cost-not-zero
    $retirementExit = $LASTEXITCODE
} finally {
    # Separate process even on uncertain/lost write response. Inspect never retries Delete.
    & $taskNodeBinary --experimental-strip-types $entry --mode Inspect --evidence $Evidence --output $inspectOutput --acknowledge-read-only
    $inspectionExit = $LASTEXITCODE
}
if ($inspectionExit -ne 0) { throw 'Independent Inspect blocked; never replay Delete or admit generation6.' }
$proof = Read-J23OrdinaryJson $inspectOutput
if ($proof.outcome -cne 'RETIRED_LOCKED_VERIFIED') { throw 'Retirement unproved; no successor/replay.' }
if ($retirementExit -ne 0) { Write-Warning 'Retirement entry failed; independent Inspect is the evidence, never retry Delete.' }
Write-Host "Independent proof: $inspectOutput"
Write-Host 'Finished retirement only; no generation6 registry/resource or Grant is created.'
