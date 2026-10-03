[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineInspect')]
  [string]$Mode = 'LocalValidate',
  [string]$PredecessorReceiptPath = '',
  [string]$OutputPath = '',
  [string]$ConfirmReadOnlyPhrase = '',
  [switch]$AcknowledgeReadOnlyNeonAccess
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$runner = Join-Path $repoRoot 'scripts\review-shared-cell-author-compensation-migrations.ts'
$validator = Join-Path $PSScriptRoot 'validate-b5-author-compensation-migration-review.mjs'
$envFile = Join-Path $repoRoot '.env.local'
$confirmation = 'I_ACKNOWLEDGE_J5GJ6_NEON_READ_ONLY_MIGRATION_REVIEW'
$guardVariable = 'TECHLONG_J5GJ6_MIGRATION_REVIEW_GUARD_NONCE'

function Resolve-ExternalJson {
  param([string]$Path, [switch]$MustExist)
  if (-not [IO.Path]::IsPathFullyQualified($Path) -or [IO.Path]::GetExtension($Path) -cne '.json') {
    throw 'Evidence must use an absolute external JSON path.'
  }
  $fullPath = [IO.Path]::GetFullPath($Path)
  $relative = [IO.Path]::GetRelativePath($repoRoot, $fullPath)
  if (-not $relative.StartsWith("..$([IO.Path]::DirectorySeparatorChar)") -and $relative -cne '..' -and -not [IO.Path]::IsPathFullyQualified($relative)) {
    throw 'Evidence must remain outside the repository.'
  }
  if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($fullPath)) -PathType Container)) { throw 'Evidence directory does not exist.' }
  if ($MustExist) {
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw 'Predecessor receipt does not exist.' }
  } elseif (Test-Path -LiteralPath $fullPath) { throw 'Refusing to overwrite an existing review manifest.' }
  return $fullPath
}

$nodeCommand = Get-Command node -ErrorAction Stop
& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) { throw 'Local migration review validation failed.' }
if ($Mode -eq 'LocalValidate') {
  if ($PredecessorReceiptPath -or $OutputPath -or $ConfirmReadOnlyPhrase -or $AcknowledgeReadOnlyNeonAccess) { throw 'LocalValidate rejects online arguments.' }
  Write-Host 'LOCAL_ONLY_J5GJ6_MIGRATION_REVIEW_NO_NETWORK'
  exit 0
}
if (-not $AcknowledgeReadOnlyNeonAccess -or $ConfirmReadOnlyPhrase -cne $confirmation) { throw 'OnlineInspect requires the exact read-only acknowledgement.' }
foreach ($variable in @('DATABASE_URL', 'NEON_DATABASE_URL', $guardVariable)) {
  if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($variable))) { throw 'Unreviewed database or wrapper environment override is set.' }
}
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw 'The untracked local environment file is required.' }
$gitCommand = Get-Command git -ErrorAction Stop
$trackedEnv = & $gitCommand.Source -c "safe.directory=$repoRoot" -C $repoRoot ls-files --error-unmatch -- .env.local 2>$null
if ($LASTEXITCODE -notin @(0, 1) -or $LASTEXITCODE -eq 0 -or -not [string]::IsNullOrWhiteSpace(($trackedEnv | Out-String))) { throw 'Local environment file must not be tracked in Git.' }
$predecessorPath = Resolve-ExternalJson -Path $PredecessorReceiptPath -MustExist
$reviewPath = Resolve-ExternalJson -Path $OutputPath
if ($predecessorPath -ceq $reviewPath) { throw 'Output cannot replace predecessor evidence.' }
$nonce = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N'))
try {
  [Environment]::SetEnvironmentVariable($guardVariable, $nonce)
  & $nodeCommand.Source '--experimental-strip-types' "--env-file=$envFile" $runner `
    '--mode' 'online-inspect' '--predecessor' $predecessorPath '--output' $reviewPath `
    '--guard-nonce' $nonce '--confirm-read-only' $confirmation
  if ($LASTEXITCODE -ne 0) { throw 'Read-only compensation migration inspection failed.' }
} finally {
  [Environment]::SetEnvironmentVariable($guardVariable, $null)
}
Write-Host 'J5GJ6_REVIEW_COMPLETE_MUTATION_PERFORMED_FALSE_APPLY_DISABLED'
