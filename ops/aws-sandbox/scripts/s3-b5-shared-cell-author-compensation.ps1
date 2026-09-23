[CmdletBinding()]
param(
  [ValidateSet('LocalValidate')]
  [string]$Mode = 'LocalValidate'
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

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'Shared Cell author compensation local validation failed.'
}

Write-Host 'LOCAL_ONLY_REVIEW_IN_PROGRESS_COMPENSATION_NOT_CLOUD_WIRED'
Write-Host 'No cloud API was called; this wrapper exposes no online mode.'
