[CmdletBinding()]
param(
  [ValidateSet('LocalValidate')]
  [string]$Mode = 'LocalValidate'
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $PSScriptRoot 'validate-b5-cell-lifecycle-management.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'Node.js was not found.'
}
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
  throw "Local validator was not found at $validator."
}

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'J5g-a Shared Cell lifecycle IAM local validation failed.'
}

Write-Host 'LOCAL_ONLY_LOCKED_NOT_APPLY_READY_NO_PAID_CELL_APPROVAL'
Write-Host 'No cloud API was called; this wrapper exposes no online mode.'
