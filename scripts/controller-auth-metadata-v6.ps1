$ErrorActionPreference = 'Stop'
# Metadata only: never Get-Content, hash, open or copy the PEM.
$keyPath = 'E:\NodejsProject\TechlongSoftware\techlong-sandbox-controller.2026-10-19.private-key.pem'
$item = Get-Item -LiteralPath $keyPath -Force
if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -lt 1 -or $item.Length -gt 16000) { throw 'KEY_METADATA_REJECTED' }
$acl = Get-Acl -LiteralPath $keyPath
$userSid = ([Security.Principal.NTAccount]::new('YANG-HOME', 'VeinyYang')).Translate([Security.Principal.SecurityIdentifier]).Value
$allowed = @($userSid, 'S-1-5-18', 'S-1-5-32-544')
if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $userSid) { throw 'KEY_ACL_REJECTED' }
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne 3) { throw 'KEY_ACL_REJECTED' }
foreach ($sid in $allowed) {
    $match = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
    if ($match.Count -ne 1 -or $match[0].IsInherited -or $match[0].AccessControlType -ne 'Allow' -or $match[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'KEY_ACL_REJECTED' }
}
$sha = [Security.Cryptography.SHA256]::Create()
try { $sddlSha = [Convert]::ToHexString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($acl.Sddl))).ToLowerInvariant() } finally { $sha.Dispose() }
[ordered]@{ length = $item.Length; lastWriteUtc = $item.LastWriteTimeUtc.ToString('o'); creationUtc = $item.CreationTimeUtc.ToString('o'); aclSha256 = $sddlSha; protectedThreePrincipalAcl = $true; keyContentRead = $false } | ConvertTo-Json -Compress
