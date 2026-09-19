[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'EvidencePreflight')]
  [string]$Mode = 'LocalValidate',
  [string]$Profile = 'techlong-sandbox-provisioner'
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
$cellStackName = 'techlong-sandbox-cell-sandbox-1'
$authorityTableArn =
  'arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority'
$authorityKey = 'cell:cell-sandbox-1'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-provision-authority-preflight.mjs'

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $knownPath = 'D:\Amazon\AWSCLIV2\aws.exe'
  if (Test-Path -LiteralPath $knownPath -PathType Leaf) { return $knownPath }
  throw 'AWS CLI v2 was not found.'
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
  if ($LASTEXITCODE -ne 0) {
    throw 'A reviewed AWS read failed.'
  }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw 'A reviewed AWS read returned no JSON.'
  }
  return (ConvertFrom-ExactJson -Json $json)
}

function Invoke-AwsOptionalJson {
  param([Parameter(Mandatory)][string]$AwsCli, [Parameter(Mandatory)][string[]]$Arguments)
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw 'The reviewed optional-result AWS read failed.'
  }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) {
    return $null
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
    if ($null -ne $current) {
      $sections[$current].Add([string]$line)
    }
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
    'AWS_SHARED_CREDENTIALS_FILE'
  )) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      throw "Refusing AWS access while credential override $name is set."
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

function Assert-ExactMissingStackRead {
  param(
    [Parameter(Mandatory)][string]$AwsCli,
    [Parameter(Mandatory)][string]$Operation,
    [Parameter(Mandatory)][string[]]$Arguments
  )
  $output = & $AwsCli @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $errorText = (($output | Out-String).Trim())
  if ($exitCode -eq 0) {
    throw "CloudFormation $Operation unexpectedly found the forbidden Shared Cell Stack."
  }
  if ($errorText -match '(?i)(AccessDenied|Unauthorized|not authorized)') {
    throw "CloudFormation $Operation was denied; denial is never accepted as MISSING."
  }
  if (
    $errorText -notmatch '(?i)\(ValidationError\)' -or
    $errorText -notmatch "(?i)when calling the $([regex]::Escape($Operation)) operation" -or
    $errorText -notmatch "(?i)$([regex]::Escape($cellStackName)).*does not exist"
  ) {
    throw "CloudFormation $Operation did not return the exact expected MISSING result."
  }
}

function Assert-SharedCellStackMissing {
  param([Parameter(Mandatory)][string]$AwsCli)
  Assert-ExactMissingStackRead -AwsCli $AwsCli -Operation 'DescribeStacks' -Arguments @(
    'cloudformation', 'describe-stacks',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $cellStackName,
    '--no-cli-pager',
    '--output', 'json'
  )
  Assert-ExactMissingStackRead -AwsCli $AwsCli -Operation 'GetTemplate' -Arguments @(
    'cloudformation', 'get-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $cellStackName,
    '--template-stage', 'Original',
    '--no-cli-pager',
    '--output', 'json'
  )
  Assert-ExactMissingStackRead -AwsCli $AwsCli -Operation 'ListStackResources' -Arguments @(
    'cloudformation', 'list-stack-resources',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $cellStackName,
    '--no-paginate',
    '--no-cli-pager',
    '--output', 'json'
  )
  Write-Host 'Shared Cell root Stack state: MISSING'
}

function Assert-AuthorityKeyAbsent {
  param([Parameter(Mandatory)][string]$AwsCli)
  $keyDocument = '{"authority_key":{"S":"cell:cell-sandbox-1"}}'
  $response = Invoke-AwsOptionalJson -AwsCli $AwsCli -Arguments @(
    'dynamodb', 'get-item',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--table-name', $authorityTableArn,
    '--key', $keyDocument,
    '--consistent-read',
    '--return-consumed-capacity', 'NONE',
    '--no-cli-pager',
    '--output', 'json'
  )
  if ($null -eq $response) {
    Write-Host 'Shared Cell authority key state: ABSENT'
    return
  }
  # Keep DynamoDB's exact `{}` result as a true zero-property response.
  # Direct member enumeration produces a one-element `$null` array here.
  $responseProperties = @(
    $response.PSObject.Properties |
      ForEach-Object { [string]$_.Name }
  )
  if ($responseProperties -contains 'Item') {
    Write-Host 'Shared Cell authority key state: PRESENT_BLOCKED'
    throw 'The Shared Cell authority key already exists; its contents were not displayed.'
  }
  if ($responseProperties.Count -ne 0) {
    throw 'The authority GetItem response contained an unexpected field.'
  }
  Write-Host 'Shared Cell authority key state: ABSENT'
}

& node $validator
if ($LASTEXITCODE -ne 0) {
  throw 'Local Shared Cell provision-authority preflight validation failed.'
}
if ($Mode -eq 'LocalValidate') {
  Write-Host 'Local validation complete. No AWS API was called.'
  exit 0
}

Assert-NoCredentialOrEndpointOverrides
$previousIgnoreConfiguredEndpoints =
  [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')
try {
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    'true',
    [EnvironmentVariableTarget]::Process
  )
  $awsCli = Resolve-AwsCli
  Assert-ExactProvisionerProfileAndIdentity -AwsCli $awsCli
  Assert-SharedCellStackMissing -AwsCli $awsCli
  Assert-AuthorityKeyAbsent -AwsCli $awsCli
  Write-Host 'Evidence preflight passed. The temporary PutItem grant is attested separately by the bootstrap IAM readback and simulation; no authority item, Shared Cell, or task mutation was requested.'
} finally {
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    $previousIgnoreConfiguredEndpoints,
    [EnvironmentVariableTarget]::Process
  )
}
