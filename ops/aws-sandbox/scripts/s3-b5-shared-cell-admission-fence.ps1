[CmdletBinding()]
param(
  [ValidateSet('LocalValidate')]
  [string]$Mode = 'LocalValidate'
)

$ErrorActionPreference = 'Stop'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-admission-fence.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw 'Node.js was not found.'
}
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
  throw "Local validator was not found at $validator."
}

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'J5g-d Shared Cell admission-fence local validation failed.'
}

Write-Host 'LOCAL_ONLY_DURABLE_ADMISSION_FENCE_DEFAULT_OFF'
Write-Host 'No cloud or database API was called; this wrapper exposes no online mode.'
