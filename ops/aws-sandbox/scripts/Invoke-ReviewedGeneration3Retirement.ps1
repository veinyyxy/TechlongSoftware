# Exact fresh SHA approval for one generation3 retirement only. No successor chaining.
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
function Read-OrdinaryJson([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Every input must be an absolute path.' }
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 600000) { throw 'Bounded ordinary input required.' }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}
$null = Read-OrdinaryJson $Evidence
$review = Read-OrdinaryJson $Manifest
if ($review.stage -cne 'B5-J5g-j20-retirement' -or $review.manifestSha256 -cne $ApprovedManifestSha) { throw 'New exact generation3 retirement approval not supplied. No AWS write.' }
Assert-ReadComparisonApprovalWindow $review.input.reviewedAt $review.input.expiresAt
$proofOutput = [IO.Path]::ChangeExtension($Output, '.inspect.json')
if (-not [IO.Path]::IsPathRooted($Output) -or (Test-Path -LiteralPath $Output) -or (Test-Path -LiteralPath $proofOutput)) { throw 'Both output paths must be new absolute files.' }
$taskNodeBinary = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$entry = Join-Path $PSScriptRoot 's3-b5-arn-probe-read-comparison-generation3-retirement.ts'
& $taskNodeBinary --experimental-strip-types $entry --mode RetireReviewed --evidence $Evidence --output $Output --manifest $Manifest --approved-manifest-sha $ApprovedManifestSha --execution-phrase $review.requiredPhrase --acknowledge-irreversible-deletion --acknowledge-low-cost-not-zero
if ($LASTEXITCODE -ne 0) { throw 'Entry failed closed; never replay Delete. Only independent read-only reconciliation is allowed.' }
& $taskNodeBinary --experimental-strip-types $entry --mode Inspect --evidence $Evidence --output $proofOutput --acknowledge-read-only
if ($LASTEXITCODE -ne 0) { throw 'Independent inspection blocked. Never replay Delete or admit generation4.' }
$proof = Read-OrdinaryJson $proofOutput
if ($proof.outcome -cne 'RETIRED_LOCKED_VERIFIED') { throw 'Retirement unproved; no generation4 admission or deletion replay.' }
Write-Host "Independent proof: $proofOutput"
Write-Host 'Finished retirement only; this never creates a successor or installs any Grant.'
