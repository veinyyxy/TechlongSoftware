[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'ApplyReviewedMigrations', 'RecoverAppliedState')]
  [string]$Mode = 'LocalValidate',
  [string]$ReviewPath = '',
  [string]$ReviewSha256 = '',
  [string]$OutputPath = '',
  [string]$ConfirmApplyPhrase = '',
  [switch]$AcknowledgeNeonDatabaseWrite,
  [switch]$AcknowledgeAtomicDdlNoAutomaticDownMigration
)

$ErrorActionPreference = 'Stop'
$confirmationPhrase = 'I_CONFIRM_J5GE2_APPLY_NEON_MIGRATIONS_0005_TO_0008'
$guardEnvironmentVariable = 'TECHLONG_J5GE2_POSTGRES_GUARD_NONCE'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-postgres-migration-apply.mjs'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$runner = Join-Path $repoRoot 'scripts\apply-reviewed-shared-cell-postgres-cutover.ts'
$envFile = Join-Path $repoRoot '.env.local'

function Assert-LocalFile {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label was not found at $Path."
  }
}

function Resolve-ExternalJsonPath {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Label,
    [switch]$MustExist,
    [switch]$MustNotExist
  )
  if (-not [IO.Path]::IsPathFullyQualified($Path)) {
    throw "$Label must be an absolute path."
  }
  if ([IO.Path]::GetExtension($Path) -cne '.json') {
    throw "$Label must use the .json extension."
  }
  $fullPath = [IO.Path]::GetFullPath($Path)
  $relative = [IO.Path]::GetRelativePath($repoRoot, $fullPath)
  if (
    -not $relative.StartsWith("..$([IO.Path]::DirectorySeparatorChar)") -and
    $relative -cne '..' -and
    -not [IO.Path]::IsPathFullyQualified($relative)
  ) {
    throw "$Label must be outside the repository."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "$Label does not exist."
  }
  if ($MustNotExist -and (Test-Path -LiteralPath $fullPath)) {
    throw "$Label already exists; refusing to overwrite it."
  }
  $directory = [IO.Path]::GetDirectoryName($fullPath)
  if (
    [string]::IsNullOrWhiteSpace($directory) -or
    -not (Test-Path -LiteralPath $directory -PathType Container)
  ) {
    throw "$Label directory does not exist."
  }
  return $fullPath
}

function Assert-NoDatabaseEnvironmentOverride {
  if (
    -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('DATABASE_URL')) -or
    -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('NEON_DATABASE_URL'))
  ) {
    throw 'Refusing an online migration operation while a database URL environment override is set.'
  }
}

function Assert-UntrackedEnvironmentFile {
  Assert-LocalFile -Path $envFile -Label 'Untracked local environment file'
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCommand) {
    throw 'Git was not found.'
  }
  $trackedEnv = & $gitCommand.Source -c "safe.directory=$repoRoot" -C $repoRoot `
    ls-files --error-unmatch -- .env.local 2>$null
  $gitExitCode = $LASTEXITCODE
  if ($gitExitCode -notin @(0, 1)) {
    throw 'Unable to verify that .env.local is excluded from Git.'
  }
  if (
    $gitExitCode -eq 0 -or
    -not [string]::IsNullOrWhiteSpace(($trackedEnv | Out-String))
  ) {
    throw 'Refusing the online migration operation because .env.local is tracked by Git.'
  }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'Node.js was not found.'
}
Assert-LocalFile -Path $validator -Label 'J5g-e2 local validator'
Assert-LocalFile -Path $runner -Label 'J5g-e2 reviewed migration runner'

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'J5g-e2 Shared Cell PostgreSQL migration validation failed.'
}

if ($Mode -eq 'LocalValidate') {
  if (
    -not [string]::IsNullOrWhiteSpace($ReviewPath) -or
    -not [string]::IsNullOrWhiteSpace($ReviewSha256) -or
    -not [string]::IsNullOrWhiteSpace($OutputPath) -or
    -not [string]::IsNullOrWhiteSpace($ConfirmApplyPhrase) -or
    $AcknowledgeNeonDatabaseWrite -or
    $AcknowledgeAtomicDdlNoAutomaticDownMigration
  ) {
    throw 'LocalValidate does not accept online operation arguments.'
  }
  Write-Host 'LOCAL_ONLY_SHARED_CELL_POSTGRES_MIGRATION_APPLY_DEFAULT_OFF'
  Write-Host 'No database or cloud API was called.'
  exit 0
}

Assert-NoDatabaseEnvironmentOverride
Assert-UntrackedEnvironmentFile
if ($ReviewSha256 -cnotmatch '^[a-f0-9]{64}$') {
  throw 'ReviewSha256 must be an exact lowercase SHA-256.'
}
$resolvedReview = Resolve-ExternalJsonPath `
  -Path $ReviewPath `
  -Label 'ReviewPath' `
  -MustExist
$resolvedOutput = Resolve-ExternalJsonPath `
  -Path $OutputPath `
  -Label 'OutputPath' `
  -MustNotExist

$runnerMode = 'recover-applied-state'
$runnerArguments = @()
if ($Mode -eq 'ApplyReviewedMigrations') {
  if (
    -not $AcknowledgeNeonDatabaseWrite -or
    -not $AcknowledgeAtomicDdlNoAutomaticDownMigration -or
    $ConfirmApplyPhrase -cne $confirmationPhrase
  ) {
    throw "ApplyReviewedMigrations requires both acknowledgements and -ConfirmApplyPhrase $confirmationPhrase."
  }
  $runnerMode = 'apply-reviewed'
  $runnerArguments = @('--confirm-apply', $confirmationPhrase)
} elseif (
  -not [string]::IsNullOrWhiteSpace($ConfirmApplyPhrase) -or
  $AcknowledgeNeonDatabaseWrite -or
  $AcknowledgeAtomicDdlNoAutomaticDownMigration
) {
  throw 'RecoverAppliedState is read-only and rejects every apply acknowledgement.'
}

$guardBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($guardBytes)
$guardNonce = [Convert]::ToHexString($guardBytes).ToLowerInvariant()
[Environment]::SetEnvironmentVariable($guardEnvironmentVariable, $guardNonce)
try {
  & $nodeCommand.Source `
    '--experimental-strip-types' `
    "--env-file=$envFile" `
    $runner `
    '--mode' $runnerMode `
    '--review' $resolvedReview `
    '--review-sha256' $ReviewSha256 `
    '--output' $resolvedOutput `
    '--guard-nonce' $guardNonce `
    @runnerArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'The J5g-e2 Neon migration operation failed closed.'
  }
} finally {
  [Environment]::SetEnvironmentVariable($guardEnvironmentVariable, $null)
}

if ($Mode -eq 'ApplyReviewedMigrations') {
  Write-Host 'APPLY_REVIEWED_MIGRATIONS_COMPLETE_EXACT_0005_TO_0008'
} else {
  Write-Host 'RECOVER_APPLIED_STATE_COMPLETE_READ_ONLY'
}
Write-Host "Evidence: $resolvedOutput"
