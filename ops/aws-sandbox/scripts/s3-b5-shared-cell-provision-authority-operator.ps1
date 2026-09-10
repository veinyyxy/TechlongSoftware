[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'InspectCandidate', 'ExecuteInstall', 'Recover')]
  [string]$Mode = 'LocalValidate',
  [string]$Profile = 'techlong-sandbox-provisioner',
  [string]$ManifestPath,
  [string]$ManifestSha256,
  [string]$ApprovedCandidateItemSha256,
  [string]$GrantExpiresAt,
  [string]$ConfirmAccountId,
  [string]$ConfirmRegion,
  [string]$ConfirmStackName,
  [string]$ConfirmAuthorityTableArn,
  [string]$ConfirmAuthorityKey,
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeReviewedCandidate,
  [switch]$AcknowledgeTemporaryGrantActive,
  [switch]$AcknowledgeAbsentOnlyInstall,
  [switch]$AcknowledgeLowCostNotFree,
  [string]$ConfirmExecutionPhrase
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedProfile = 'techlong-sandbox-provisioner'
$expectedPrincipalArn =
  'arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner'
$expectedRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole'
$expectedSourceProfile = 'techlong-sandbox-user'
$expectedSourcePrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa/techlong-sandbox-dev'
$expectedSessionName = 'techlong-sandbox-provisioner'
$expectedStackName = 'techlong-sandbox-cell-sandbox-1'
$expectedCellCloudFormationRoleArn =
  'arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole'
$expectedAuthorityTableArn =
  'arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority'
$expectedAuthorityKey = 'cell:cell-sandbox-1'
$expectedExecutionPhrase =
  'I_ACKNOWLEDGE_J5F_SHARED_CELL_PROVISION_AUTHORITY_INSTALL'
$guardEnvironmentVariable = 'TECHLONG_J5F_OPERATOR_GUARD_NONCE'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-provision-authority-operator.mjs'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$rootCli = Join-Path $repositoryRoot 'scripts\run-shared-cell-provision-authority-operator.ts'

function Resolve-Executable {
  param([Parameter(Mandatory)][string]$Name, [string]$Fallback)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if ($Fallback -and (Test-Path -LiteralPath $Fallback -PathType Leaf)) { return $Fallback }
  throw "$Name was not found."
}

function ConvertFrom-ExactJson {
  param([Parameter(Mandatory)][string]$Json)
  $convertCommand = Get-Command ConvertFrom-Json
  if ($convertCommand.Parameters.ContainsKey('DateKind')) {
    return (ConvertFrom-Json -InputObject $Json -DateKind String)
  }
  return (ConvertFrom-Json -InputObject $Json)
}

function Invoke-AwsJson {
  param([Parameter(Mandatory)][string]$AwsCli, [Parameter(Mandatory)][string[]]$Arguments)
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'A reviewed AWS identity read failed.' }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw 'A reviewed AWS identity read returned no JSON.'
  }
  return (ConvertFrom-ExactJson -Json $json)
}

function Read-AwsSharedConfigSections {
  $configuredPath = [Environment]::GetEnvironmentVariable('AWS_CONFIG_FILE')
  $configPath = if ([string]::IsNullOrWhiteSpace($configuredPath)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.aws\config'
  } else {
    [Environment]::ExpandEnvironmentVariables($configuredPath)
  }
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "AWS shared config file was not found at $configPath."
  }
  $sections = @{}
  $current = $null
  foreach ($line in Get-Content -LiteralPath $configPath) {
    if ($line -match '^\s*\[([^]]+)\]\s*$') {
      $current = $Matches[1].Trim().ToLowerInvariant()
      if (-not $sections.ContainsKey($current)) {
        $sections[$current] = [System.Collections.Generic.List[string]]::new()
      }
      continue
    }
    if ($null -ne $current) { $sections[$current].Add([string]$line) }
  }
  return $sections
}

function Assert-NoCredentialOrEndpointOverrides {
  foreach ($name in @(
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN',
    'AWS_ROLE_ARN',
    'AWS_ROLE_SESSION_NAME',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_PROFILE',
    'AWS_DEFAULT_PROFILE',
    'AWS_REGION',
    'AWS_DEFAULT_REGION'
  )) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      throw "Refusing AWS access while credential/profile/region override $name is set."
    }
  }
  foreach ($key in [Environment]::GetEnvironmentVariables().Keys) {
    if ([string]$key -imatch '^AWS_ENDPOINT_URL(?:_|$)') {
      throw "Refusing AWS access while endpoint override $key is set."
    }
  }

  $sections = Read-AwsSharedConfigSections
  foreach ($sectionName in @(
    'default',
    $expectedProfile,
    "profile $expectedProfile",
    $expectedSourceProfile,
    "profile $expectedSourceProfile"
  )) {
    $normalized = $sectionName.ToLowerInvariant()
    if (-not $sections.ContainsKey($normalized)) { continue }
    foreach ($line in $sections[$normalized]) {
      if ($line -imatch '^\s*(?:endpoint_url|services)\s*=') {
        throw "AWS config section $sectionName contains a forbidden endpoint override."
      }
    }
  }
}

function Get-AwsConfigValue {
  param(
    [Parameter(Mandatory)][string]$AwsCli,
    [Parameter(Mandatory)][string]$ProfileName,
    [Parameter(Mandatory)][string]$Key
  )
  $value = ((& $AwsCli configure get $Key --profile $ProfileName) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read required AWS profile setting $Key."
  }
  return $value
}

function Assert-ExactProvisionerProfileAndIdentity {
  param([Parameter(Mandatory)][string]$AwsCli)
  if ($Profile -cne $expectedProfile) {
    throw "Use only the reviewed AWS profile $expectedProfile."
  }
  $region = Get-AwsConfigValue -AwsCli $AwsCli -ProfileName $Profile -Key 'region'
  $roleArn = Get-AwsConfigValue -AwsCli $AwsCli -ProfileName $Profile -Key 'role_arn'
  $sourceProfile = Get-AwsConfigValue -AwsCli $AwsCli -ProfileName $Profile -Key 'source_profile'
  $mfaSerial = Get-AwsConfigValue -AwsCli $AwsCli -ProfileName $Profile -Key 'mfa_serial'
  $sessionName = Get-AwsConfigValue -AwsCli $AwsCli -ProfileName $Profile -Key 'role_session_name'
  $sourceLoginSession = Get-AwsConfigValue `
    -AwsCli $AwsCli `
    -ProfileName $expectedSourceProfile `
    -Key 'login_session'
  $sourceRegion = Get-AwsConfigValue `
    -AwsCli $AwsCli `
    -ProfileName $expectedSourceProfile `
    -Key 'region'
  if (
    $region -cne $expectedRegion -or
    $roleArn -cne $expectedRoleArn -or
    $sourceProfile -cne $expectedSourceProfile -or
    $mfaSerial -cne $expectedMfaDeviceArn -or
    $sessionName -cne $expectedSessionName -or
    $sourceLoginSession -cne $expectedSourcePrincipalArn -or
    $sourceRegion -cne $expectedRegion
  ) {
    throw 'Provisioner profile role, source, MFA, session name, login session, or region drifted.'
  }
  $sourceCredentialInventory =
    ((& $AwsCli configure list --profile $expectedSourceProfile) | Out-String)
  if (
    $LASTEXITCODE -ne 0 -or
    $sourceCredentialInventory -cnotmatch '(?m)^\s*access_key\s*:\s*\S+\s*:\s*login\s*:' -or
    $sourceCredentialInventory -cnotmatch '(?m)^\s*secret_key\s*:\s*\S+\s*:\s*login\s*:'
  ) {
    throw 'Source credentials must resolve from the reviewed AWS CLI login session.'
  }
  $identity = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--cli-connect-timeout', '10',
    '--cli-read-timeout', '20',
    '--no-cli-pager',
    '--output', 'json'
  )
  if (
    [string]$identity.Account -cne $expectedAccountId -or
    [string]$identity.Arn -cne $expectedPrincipalArn
  ) {
    throw "AWS identity must be exactly $expectedPrincipalArn in account $expectedAccountId."
  }
}

function Assert-Manifest {
  if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    throw 'Online modes require -ManifestPath.'
  }
  if ($ManifestSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Online modes require the reviewed lowercase -ManifestSha256.'
  }
  $fullPath = [IO.Path]::GetFullPath($ManifestPath)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw 'The reviewed operator manifest file was not found.'
  }
  $item = Get-Item -LiteralPath $fullPath -Force
  if (
    $item.Extension -cne '.json' -or
    $item.Length -le 0 -or
    $item.Length -gt 65536 -or
    (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
  ) {
    throw 'The reviewed operator manifest path, type, size, or link state is invalid.'
  }
  $actual = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -cne $ManifestSha256) {
    throw 'The operator manifest raw SHA-256 differs from the reviewed digest.'
  }
  return $fullPath
}

function Assert-CanonicalGrantWindow {
  if ($GrantExpiresAt -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') {
    throw 'ExecuteInstall requires canonical -GrantExpiresAt with milliseconds.'
  }
  $expiry = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParseExact(
    $GrantExpiresAt,
    'yyyy-MM-ddTHH:mm:ss.fffZ',
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$expiry
  )) {
    throw 'Grant expiry is not a real canonical UTC instant.'
  }
  $remaining = $expiry.ToUniversalTime() - [DateTimeOffset]::UtcNow
  if ($remaining.TotalMinutes -le 2 -or $remaining.TotalMinutes -gt 60) {
    throw 'ExecuteInstall requires more than 2 and at most 60 minutes of grant time remaining.'
  }
}

function Assert-ModeArguments {
  if (
    $Mode -ne 'ExecuteInstall' -and
    (
      $AcknowledgeAwsWrite -or
      $AcknowledgeReviewedCandidate -or
      $AcknowledgeTemporaryGrantActive -or
      $AcknowledgeAbsentOnlyInstall -or
      $AcknowledgeLowCostNotFree -or
      -not [string]::IsNullOrWhiteSpace($ConfirmAccountId) -or
      -not [string]::IsNullOrWhiteSpace($ConfirmRegion) -or
      -not [string]::IsNullOrWhiteSpace($ConfirmStackName) -or
      -not [string]::IsNullOrWhiteSpace($ConfirmAuthorityTableArn) -or
      -not [string]::IsNullOrWhiteSpace($ConfirmAuthorityKey) -or
      -not [string]::IsNullOrWhiteSpace($ConfirmExecutionPhrase)
    )
  ) {
    throw 'InspectCandidate and Recover reject all write acknowledgements and execution confirmations.'
  }
  if ($Mode -eq 'InspectCandidate') {
    if (
      -not [string]::IsNullOrWhiteSpace($ApprovedCandidateItemSha256) -or
      -not [string]::IsNullOrWhiteSpace($GrantExpiresAt)
    ) {
      throw 'InspectCandidate does not accept candidate approval or grant expiry.'
    }
    return
  }
  if ($ApprovedCandidateItemSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw 'ExecuteInstall and Recover require -ApprovedCandidateItemSha256.'
  }
  if ($Mode -eq 'Recover') {
    if (-not [string]::IsNullOrWhiteSpace($GrantExpiresAt)) {
      throw 'Recover is read-only and does not accept -GrantExpiresAt.'
    }
    return
  }
  Assert-CanonicalGrantWindow
  if (
    $ConfirmAccountId -cne $expectedAccountId -or
    $ConfirmRegion -cne $expectedRegion -or
    $ConfirmStackName -cne $expectedStackName -or
    $ConfirmAuthorityTableArn -cne $expectedAuthorityTableArn -or
    $ConfirmAuthorityKey -cne $expectedAuthorityKey
  ) {
    throw 'ExecuteInstall requires all exact account, region, Stack, table and key confirmations.'
  }
  if (
    -not $AcknowledgeAwsWrite -or
    -not $AcknowledgeReviewedCandidate -or
    -not $AcknowledgeTemporaryGrantActive -or
    -not $AcknowledgeAbsentOnlyInstall -or
    -not $AcknowledgeLowCostNotFree
  ) {
    throw 'ExecuteInstall requires all explicit write, candidate, grant, absent-only and low-cost acknowledgements.'
  }
  if ($ConfirmExecutionPhrase -cne $expectedExecutionPhrase) {
    throw "ExecuteInstall requires -ConfirmExecutionPhrase $expectedExecutionPhrase."
  }
}

& node $validator
if ($LASTEXITCODE -ne 0) {
  throw 'Local J5f Shared Cell provision-authority operator validation failed.'
}
if ($Mode -eq 'LocalValidate') {
  foreach ($value in @(
    $ManifestPath,
    $ManifestSha256,
    $ApprovedCandidateItemSha256,
    $GrantExpiresAt,
    $ConfirmAccountId,
    $ConfirmRegion,
    $ConfirmStackName,
    $ConfirmAuthorityTableArn,
    $ConfirmAuthorityKey,
    $ConfirmExecutionPhrase
  )) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      throw 'LocalValidate does not accept online operation arguments.'
    }
  }
  if (
    $AcknowledgeAwsWrite -or
    $AcknowledgeReviewedCandidate -or
    $AcknowledgeTemporaryGrantActive -or
    $AcknowledgeAbsentOnlyInstall -or
    $AcknowledgeLowCostNotFree
  ) {
    throw 'LocalValidate does not accept online acknowledgements.'
  }
  & node --experimental-strip-types $rootCli --mode LocalValidate
  if ($LASTEXITCODE -ne 0) { throw 'Root operator LocalValidate failed.' }
  Write-Host 'Local validation complete. No AWS API was called.'
  exit 0
}

Assert-ModeArguments
$reviewedManifestPath = Assert-Manifest
Assert-NoCredentialOrEndpointOverrides
$awsCli = Resolve-Executable -Name 'aws' -Fallback 'D:\Amazon\AWSCLIV2\aws.exe'
Assert-ExactProvisionerProfileAndIdentity -AwsCli $awsCli

$previousIgnoreConfiguredEndpoints =
  [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')
$previousGuardNonce = [Environment]::GetEnvironmentVariable($guardEnvironmentVariable)
$guardBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
$guardNonce = [Convert]::ToHexString($guardBytes).ToLowerInvariant()
try {
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    'true',
    [EnvironmentVariableTarget]::Process
  )
  [Environment]::SetEnvironmentVariable(
    $guardEnvironmentVariable,
    $guardNonce,
    [EnvironmentVariableTarget]::Process
  )
  $arguments = @(
    '--experimental-strip-types',
    $rootCli,
    '--mode', $Mode,
    '--profile', $Profile,
    '--manifest-path', $reviewedManifestPath,
    '--manifest-sha256', $ManifestSha256,
    '--guard-nonce', $guardNonce
  )
  if ($Mode -in @('ExecuteInstall', 'Recover')) {
    $arguments += @(
      '--approved-candidate-item-sha256',
      $ApprovedCandidateItemSha256
    )
  }
  if ($Mode -eq 'ExecuteInstall') {
    Assert-CanonicalGrantWindow
    $arguments += @(
      '--grant-expires-at', $GrantExpiresAt,
      '--confirm-account-id', $ConfirmAccountId,
      '--confirm-region', $ConfirmRegion,
      '--confirm-stack-name', $ConfirmStackName,
      '--confirm-authority-table-arn', $ConfirmAuthorityTableArn,
      '--confirm-authority-key', $ConfirmAuthorityKey,
      '--acknowledge-aws-write', 'true',
      '--acknowledge-reviewed-candidate', 'true',
      '--acknowledge-temporary-grant-active', 'true',
      '--acknowledge-absent-only-install', 'true',
      '--acknowledge-low-cost-not-free', 'true',
      '--confirm-execution-phrase', $ConfirmExecutionPhrase
    )
  }
  $output = & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Root operator $Mode failed." }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw 'Root operator returned no safe summary.'
  }
  $summary = ConvertFrom-ExactJson -Json $json
  $expectedPhase = if ($Mode -eq 'InspectCandidate') {
    'INSPECTED'
  } elseif ($Mode -eq 'ExecuteInstall') {
    'INSTALLED'
  } else {
    'RECOVERED'
  }
  if (
    [int]$summary.schemaVersion -ne 2 -or
    [string]$summary.cloudFormationRoleArn -cne $expectedCellCloudFormationRoleArn -or
    [string]$summary.phase -cne $expectedPhase -or
    [bool]$summary.mutationPerformed -ne ($Mode -eq 'ExecuteInstall') -or
    [string]$summary.candidateItemSha256 -cnotmatch '^[a-f0-9]{64}$'
  ) {
    throw 'Root operator returned an invalid phase or mutation summary.'
  }
  if (
    $Mode -in @('ExecuteInstall', 'Recover') -and
    [string]$summary.candidateItemSha256 -cne $ApprovedCandidateItemSha256
  ) {
    throw 'Root operator summary differs from the reviewed candidate digest.'
  }
  Write-Output $json
} finally {
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    $previousIgnoreConfiguredEndpoints,
    [EnvironmentVariableTarget]::Process
  )
  [Environment]::SetEnvironmentVariable(
    $guardEnvironmentVariable,
    $previousGuardNonce,
    [EnvironmentVariableTarget]::Process
  )
}
