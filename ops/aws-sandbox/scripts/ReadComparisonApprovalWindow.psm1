# JSON timestamps can be strings (older PowerShell) or DateTime objects
# (PowerShell 7.5+). Never format a UTC DateTime using the current culture and
# parse that zone-less string again: it silently reinterprets UTC as local time.
function ConvertTo-ReadComparisonApprovalUtc {
    param([Parameter(Mandatory)][object]$Value)
    if ($Value -is [DateTimeOffset]) { return $Value.ToUniversalTime() }
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [DateTimeKind]::Unspecified) { throw 'Approval timestamp has no explicit timezone. No AWS write.' }
        return ([DateTimeOffset]::new($Value)).ToUniversalTime()
    }
    if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') {
        throw 'Approval timestamp must be canonical UTC. No AWS write.'
    }
    return [DateTimeOffset]::ParseExact($Value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture,
        ([Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal))
}
function Assert-ReadComparisonApprovalWindow {
    param([Parameter(Mandatory)][object]$Start, [Parameter(Mandatory)][object]$End)
    $issued = ConvertTo-ReadComparisonApprovalUtc $Start
    $expires = ConvertTo-ReadComparisonApprovalUtc $End
    $current = [DateTimeOffset]::UtcNow
    if ($expires -le $issued -or ($expires - $issued).TotalMilliseconds -gt 300000 -or $current -lt $issued -or $current -ge $expires) {
        throw 'Approval window expired/not started/invalid. No AWS write. Never auto-refresh or reuse approval.'
    }
}
Export-ModuleMember -Function ConvertTo-ReadComparisonApprovalUtc, Assert-ReadComparisonApprovalWindow
