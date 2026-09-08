[CmdletBinding()]
param(
  [ValidateSet('LocalValidate')]
  [string]$Mode = 'LocalValidate'
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-cleanup-production-adapters.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'Node.js was not found.'
}
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
  throw "Local validator was not found at $validator."
}

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'J5g-c Shared Cell cleanup production adapter local validation failed.'
}

Write-Host 'LOCAL_ONLY_DEFAULT_OFF_REAL_ADAPTERS_CURRENT_JANITOR_PLAN_ONLY'
Write-Host 'No cloud or database API was called; this wrapper exposes no online mode.'
