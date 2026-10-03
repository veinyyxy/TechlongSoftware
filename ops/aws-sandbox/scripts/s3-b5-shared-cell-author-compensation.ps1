[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'ReviewManagement')]
  [string]$Mode = 'LocalValidate',
  [string]$ReviewInputPath = ''
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-author-compensation.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'Node.js was not found.'
}
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
  throw "Local validator was not found at $validator."
}

if ($Mode -eq 'ReviewManagement') {
  if ([string]::IsNullOrWhiteSpace($ReviewInputPath) -or -not (Test-Path -LiteralPath $ReviewInputPath -PathType Leaf)) {
    throw 'ReviewManagement requires an existing local -ReviewInputPath JSON file.'
  }
  $reviewer = Join-Path $PSScriptRoot 'review-b5-shared-cell-author-compensation-management.ts'
  & $nodeCommand.Source --experimental-strip-types $reviewer --input $ReviewInputPath
  if ($LASTEXITCODE -ne 0) { throw 'Local management action review failed.' }
  return
}
if (-not [string]::IsNullOrWhiteSpace($ReviewInputPath)) {
  throw '-ReviewInputPath is accepted only by ReviewManagement.'
}

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'Shared Cell author compensation local validation failed.'
}

Write-Host 'LOCAL_ONLY_REVIEW_IN_PROGRESS_COMPENSATION_NOT_CLOUD_WIRED'
Write-Host 'No cloud API was called; this wrapper exposes no online mode.'
