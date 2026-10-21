param([Parameter(Mandatory=$true)][string]$KeyPath)
$ErrorActionPreference = 'Stop'
# Metadata only. This command never opens, hashes or prints the key content.
$item = Get-Item -LiteralPath $KeyPath -Force
if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -lt 1 -or $item.Length -gt 16000) { throw 'KEY_METADATA_REJECTED' }
$acl = Get-Acl -LiteralPath $KeyPath
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($userSid, 'S-1-5-18', 'S-1-5-32-544')
if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $userSid) { throw 'KEY_ACL_REJECTED' }
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne 3) { throw 'KEY_ACL_REJECTED' }
foreach ($sid in $allowed) {
    $match = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
    if ($match.Count -ne 1 -or $match[0].IsInherited -or $match[0].AccessControlType -ne 'Allow' -or $match[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'KEY_ACL_REJECTED' }
}
$bytes = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($acl.Sddl))
[ordered]@{ protectionSha256 = [Convert]::ToHexString($bytes).ToLowerInvariant(); protectedThreePrincipalAcl = $true; keyContentRead = $false } | ConvertTo-Json -Compress
