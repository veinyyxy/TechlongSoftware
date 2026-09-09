[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineInspect')]
  [string]$Mode = 'LocalValidate',
  [string]$OutputPath = '',
  [string]$ConfirmReadOnlyPhrase = '',
  [switch]$AcknowledgeReadOnlyNeonAccess
)

$ErrorActionPreference = 'Stop'
$confirmationPhrase = 'I_ACKNOWLEDGE_NEON_READ_ONLY_INSPECTION'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-postgres-cutover.mjs'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$runner = Join-Path $repoRoot 'scripts\run-shared-cell-postgres-cutover.ts'
$envFile = Join-Path $repoRoot '.env.local'

function Assert-LocalFile {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label was not found at $Path."
  }
}

function Assert-OutputOutsideRepository {
  param([Parameter(Mandatory)][string]$Path)
  if (-not [IO.Path]::IsPathFullyQualified($Path)) {
    throw 'OutputPath must be an absolute path.'
  }
  if ([IO.Path]::GetExtension($Path) -cne '.json') {
    throw 'OutputPath must use the .json extension.'
  }
  $fullPath = [IO.Path]::GetFullPath($Path)
  $relative = [IO.Path]::GetRelativePath($repoRoot, $fullPath)
  if (
    -not $relative.StartsWith("..$([IO.Path]::DirectorySeparatorChar)") -and
    $relative -cne '..' -and
    -not [IO.Path]::IsPathFullyQualified($relative)
  ) {
    throw 'The online review manifest must be written outside the repository.'
  }
  $directory = [IO.Path]::GetDirectoryName($fullPath)
  if ([string]::IsNullOrWhiteSpace($directory) -or -not (Test-Path -LiteralPath $directory -PathType Container)) {
    throw 'The review manifest output directory does not exist.'
  }
  if (Test-Path -LiteralPath $fullPath) {
    throw 'The review manifest already exists; refusing to overwrite it.'
  }
  return $fullPath
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'Node.js was not found.'
}
Assert-LocalFile -Path $validator -Label 'J5g-e1 local validator'
Assert-LocalFile -Path $runner -Label 'J5g-e1 online inspector'

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'J5g-e1 Shared Cell PostgreSQL cutover validation failed.'
}

if ($Mode -eq 'LocalValidate') {
  if (
    -not [string]::IsNullOrWhiteSpace($OutputPath) -or
    -not [string]::IsNullOrWhiteSpace($ConfirmReadOnlyPhrase) -or
    $AcknowledgeReadOnlyNeonAccess
  ) {
    throw 'LocalValidate does not accept online inspection arguments.'
  }
  Write-Host 'LOCAL_ONLY_SHARED_CELL_POSTGRES_CUTOVER_INSPECTOR_DEFAULT_OFF'
  Write-Host 'No database or cloud API was called.'
  exit 0
}

if (-not $AcknowledgeReadOnlyNeonAccess) {
  throw 'OnlineInspect requires AcknowledgeReadOnlyNeonAccess.'
}
if ($ConfirmReadOnlyPhrase -cne $confirmationPhrase) {
  throw "OnlineInspect requires the exact phrase $confirmationPhrase."
}
if (
  -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('DATABASE_URL')) -or
  -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('NEON_DATABASE_URL'))
) {
  throw 'Refusing OnlineInspect while a database URL environment override is set.'
}
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
if ($gitExitCode -eq 0 -or -not [string]::IsNullOrWhiteSpace(($trackedEnv | Out-String))) {
  throw 'Refusing OnlineInspect because .env.local is tracked by Git.'
}

$reviewPath = Assert-OutputOutsideRepository -Path $OutputPath
& $nodeCommand.Source `
  '--experimental-strip-types' `
  "--env-file=$envFile" `
  $runner `
  '--mode' 'online-inspect' `
  '--confirm-read-only-neon-access' $confirmationPhrase `
  '--output' $reviewPath
if ($LASTEXITCODE -ne 0) {
  throw 'The J5g-e1 Neon read-only inspection failed.'
}

Write-Host 'ONLINE_INSPECT_COMPLETE_MUTATION_PERFORMED_FALSE'
Write-Host "Review manifest: $reviewPath"
