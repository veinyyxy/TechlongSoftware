# Pure timestamp tests. No AWS SDK/CLI, local ledger or write entry is invoked.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../../ops/aws-sandbox/scripts/ReadComparisonApprovalWindow.psm1') -Force -DisableNameChecking
function Equal-Ticks($Actual, $Expected) {
    if ($Actual.UtcDateTime.Ticks -ne $Expected.UtcDateTime.Ticks) { throw 'UTC instant or millisecond precision drifted.' }
}
function Must-Block([scriptblock]$Action) {
    $blocked = $false
    try { & $Action } catch { $blocked = $true }
    if (-not $blocked) { throw 'Invalid approval window was accepted.' }
}
$text = '2026-10-04T14:01:22.850Z'
$expected = [DateTimeOffset]::ParseExact($text, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture,
    ([Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal))
Equal-Ticks (ConvertTo-ReadComparisonApprovalUtc $text) $expected
$parsed = '{"expiresAt":"2026-10-04T14:01:22.850Z"}' | ConvertFrom-Json
Equal-Ticks (ConvertTo-ReadComparisonApprovalUtc $parsed.expiresAt) $expected
Equal-Ticks (ConvertTo-ReadComparisonApprovalUtc $expected.UtcDateTime.ToLocalTime()) $expected
Equal-Ticks (ConvertTo-ReadComparisonApprovalUtc $expected.ToOffset([TimeSpan]::FromHours(-5))) $expected
Must-Block { ConvertTo-ReadComparisonApprovalUtc ([DateTime]::SpecifyKind($expected.UtcDateTime, [DateTimeKind]::Unspecified)) }
Must-Block { ConvertTo-ReadComparisonApprovalUtc '2026-10-04T14:01:22.850' }
$now = [DateTimeOffset]::UtcNow
function Canonical($Value) { return $Value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture) }
$active = @{ issuedAt = (Canonical $now.AddMinutes(-1)); expiresAt = (Canonical $now.AddMinutes(1)) } | ConvertTo-Json | ConvertFrom-Json
Assert-ReadComparisonApprovalWindow $active.issuedAt $active.expiresAt
Must-Block { Assert-ReadComparisonApprovalWindow (Canonical $now.AddMinutes(-2)) (Canonical $now.AddMinutes(-1)) }
Must-Block { Assert-ReadComparisonApprovalWindow (Canonical $now.AddMinutes(1)) (Canonical $now.AddMinutes(2)) }
Must-Block { Assert-ReadComparisonApprovalWindow (Canonical $now.AddMinutes(-1)) (Canonical $now.AddMinutes(5)) }
Must-Block { Assert-ReadComparisonApprovalWindow (Canonical $now) (Canonical $now) }
Write-Output 'Approval UTC regression passed (11 checks; no AWS or ledger operations).'
