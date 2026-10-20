$ErrorActionPreference = 'Stop'
# Auth configuration metadata only. Never open/hash the file's content.
$p = 'E:\NodejsProject\TechlongSoftware\.env.local'
$item = Get-Item -LiteralPath $p -Force
if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -lt 1 -or $item.Length -gt 131072) { throw 'AUTH_METADATA_REJECTED' }
$acl = Get-Acl -LiteralPath $p
$sid = ([Security.Principal.NTAccount]::new('YANG-HOME', 'VeinyYang')).Translate([Security.Principal.SecurityIdentifier]).Value
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'AUTH_OWNER_REJECTED' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $sddlSha = [Convert]::ToHexString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($acl.Sddl))).ToLowerInvariant() } finally { $sha.Dispose() }
[ordered]@{ length = $item.Length; lastWriteUtc = $item.LastWriteTimeUtc.ToString('o'); creationUtc = $item.CreationTimeUtc.ToString('o'); aclSha256 = $sddlSha; inheritedAcl = (-not $acl.AreAccessRulesProtected); contentRead = $false } | ConvertTo-Json -Compress
