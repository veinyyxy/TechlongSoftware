[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'ApplyReviewedMigrations', 'RecoverState')]
  [string]$Mode = 'LocalValidate',
  [string]$ReviewPath = '',
  [string]$ReviewSha256 = '',
  [string]$OutputPath = '',
  [string]$ConfirmApplyPhrase = '',
  [switch]$AcknowledgeNeonDatabaseWrite,
  [switch]$AcknowledgeAtomicDdlNoAutomaticDownMigration,
  [switch]$AcknowledgeReadOnlyNeonAccess
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$runner = Join-Path $repoRoot 'scripts\apply-reviewed-author-compensation-migrations.ts'
$validator = Join-Path $PSScriptRoot 'validate-b5-author-compensation-migration-apply.mjs'
$envFile = Join-Path $repoRoot '.env.local'
$confirmation = 'I_CONFIRM_J5GJ7_APPLY_NEON_MIGRATIONS_0009_AND_0010'
$guardVariable = 'TECHLONG_J5GJ7_MIGRATION_APPLY_GUARD_NONCE'
function Resolve-ExternalJson {
  param([string]$Path, [switch]$MustExist)
  if (-not [IO.Path]::IsPathFullyQualified($Path) -or [IO.Path]::GetExtension($Path) -cne '.json') { throw 'Absolute external JSON paths are required.' }
  $resolved = [IO.Path]::GetFullPath($Path)
  $relative = [IO.Path]::GetRelativePath($repoRoot, $resolved)
  if (-not $relative.StartsWith("..$([IO.Path]::DirectorySeparatorChar)") -and $relative -cne '..' -and -not [IO.Path]::IsPathFullyQualified($relative)) { throw 'Evidence must remain outside the repository.' }
  if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($resolved)) -PathType Container)) { throw 'Evidence directory is missing.' }
  if ($MustExist) { if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw 'Review manifest is missing.' } }
  elseif (Test-Path -LiteralPath $resolved) { throw 'Refusing to overwrite existing evidence.' }
  return $resolved
}
$nodeCommand = Get-Command node -ErrorAction Stop
& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) { throw 'Compensation migration local validation failed.' }
if ($Mode -eq 'LocalValidate') {
  if ($ReviewPath -or $ReviewSha256 -or $OutputPath -or $ConfirmApplyPhrase -or $AcknowledgeNeonDatabaseWrite -or $AcknowledgeAtomicDdlNoAutomaticDownMigration -or $AcknowledgeReadOnlyNeonAccess) { throw 'LocalValidate rejects online arguments.' }
  Write-Host 'LOCAL_ONLY_COMPENSATION_MIGRATION_APPLY_DEFAULT_OFF'
  exit 0
}
if ($ReviewSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'An exact review SHA-256 is required.' }
$runnerMode = 'recover-state'
$extraArguments = @()
if ($Mode -eq 'ApplyReviewedMigrations') {
  if (-not $AcknowledgeNeonDatabaseWrite -or -not $AcknowledgeAtomicDdlNoAutomaticDownMigration -or $ConfirmApplyPhrase -cne $confirmation -or $AcknowledgeReadOnlyNeonAccess) { throw 'Apply requires both write acknowledgements and the exact confirmation phrase; it is not a read-only operation.' }
  $runnerMode = 'apply-reviewed'
  $extraArguments = @('--confirm-apply', $confirmation)
} elseif (-not $AcknowledgeReadOnlyNeonAccess -or $AcknowledgeNeonDatabaseWrite -or $AcknowledgeAtomicDdlNoAutomaticDownMigration -or $ConfirmApplyPhrase) { throw 'RecoverState requires read-only acknowledgement and rejects all write acknowledgements.' }
foreach ($variable in @('DATABASE_URL', 'NEON_DATABASE_URL', $guardVariable)) {
  if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($variable))) { throw 'Unreviewed database or guard environment override is set.' }
}
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw 'Untracked .env.local is required.' }
$gitCommand = Get-Command git -ErrorAction Stop
$tracked = & $gitCommand.Source -c "safe.directory=$repoRoot" -C $repoRoot ls-files --error-unmatch -- .env.local 2>$null
if ($LASTEXITCODE -notin @(0,1) -or $LASTEXITCODE -eq 0 -or -not [string]::IsNullOrWhiteSpace(($tracked | Out-String))) { throw '.env.local must not be tracked in Git.' }
$review = Resolve-ExternalJson -Path $ReviewPath -MustExist
$output = Resolve-ExternalJson -Path $OutputPath
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$nonce = [Convert]::ToHexString($bytes).ToLowerInvariant()
try {
  [Environment]::SetEnvironmentVariable($guardVariable, $nonce)
  & $nodeCommand.Source '--experimental-strip-types' "--env-file=$envFile" $runner `
    '--mode' $runnerMode '--review' $review '--review-sha256' $ReviewSha256 '--output' $output `
    '--guard-nonce' $nonce @extraArguments
  if ($LASTEXITCODE -ne 0) { throw 'Compensation migration stopped; preserve evidence and use read-only RecoverState, never automatically replay.' }
} finally { [Environment]::SetEnvironmentVariable($guardVariable, $null) }
Write-Host "COMPENSATION_MIGRATION_COMPLETE_MODE_$Mode"
