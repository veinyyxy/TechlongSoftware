[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate', 'Create', 'Readback', 'Delete')]
  [string]$Mode = 'LocalValidate',
  [string]$Profile = 'techlong-sandbox-provisioner',
  [string]$SourceReadbackProfile = 'techlong-sandbox-user',
  [string]$ExpiresAt = '',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmRegion = '',
  [string]$ConfirmStackName = '',
  [string]$ConfirmStackId = '',
  [string]$ConfirmLogGroupName = '',
  [string]$ConfirmTemplateSha256 = '',
  [string]$ConfirmTemplateCanonicalSha256 = '',
  [string]$ConfirmExecutionPhrase = '',
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeLowCostNotFree,
  [switch]$AcknowledgeNoEcsCompute,
  [switch]$AcknowledgeExactEmptyLogDeletion
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedProfile = 'techlong-sandbox-provisioner'
$expectedPrincipalArn = 'arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner'
$expectedSourceProfile = 'techlong-sandbox-user'
$expectedSourcePrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$expectedSourceUserName = 'techlong-sandbox-dev'
$expectedProvisionerRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole'
$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa/techlong-sandbox-dev'
$cloudFormationRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole'
$stackName = 'techlong-sandbox-tenant-b5j4logs'
$logGroupName = '/saas/cell-sandbox-1/tenant-lifecycle'
$logGroupArn = 'arn:aws:logs:ca-central-1:402010193138:log-group:/saas/cell-sandbox-1/tenant-lifecycle'
$clusterName = 'cell-sandbox-1'
$clusterArn = 'arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1'
$expectedAppInstanceId = 'tenant-lifecycle'
$expectedDeploymentId = 'b5j4-log-support'
$root = Split-Path -Parent $PSScriptRoot
$templatePath = Join-Path $root 'cloudformation\s3-b5-lifecycle-log-support.template.json'
$validator = Join-Path $root 'scripts\validate-b5-lifecycle-log-support.mjs'
$templateVerifier = Join-Path $root 'scripts\verify-change-set-template.mjs'
$createPhrase = 'I_ACKNOWLEDGE_B5J4_EMPTY_LIFECYCLE_LOG_GROUP_CREATION'
$deletePhrase = 'I_ACKNOWLEDGE_B5J4_EXACT_EMPTY_LOG_GROUP_DELETION'

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $knownPath = 'D:\Amazon\AWSCLIV2\aws.exe'
  if (Test-Path -LiteralPath $knownPath) { return $knownPath }
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

function Invoke-AwsChecked {
  param([string]$AwsCli, [string[]]$Arguments)
  & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI command failed with exit code $LASTEXITCODE." }
}

function Invoke-AwsJson {
  param([string]$AwsCli, [string[]]$Arguments)
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI command failed with exit code $LASTEXITCODE." }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) { throw 'AWS CLI returned an empty JSON response.' }
  return (ConvertFrom-ExactJson -Json $json)
}

function Invoke-AwsJsonFile {
  param([string]$AwsCli, [string[]]$Arguments, [string]$OutputPath)
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI command failed with exit code $LASTEXITCODE." }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) { throw 'AWS CLI returned an empty JSON response.' }
  [System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Read-AwsSharedConfigSections {
  $configuredPath = [Environment]::GetEnvironmentVariable('AWS_CONFIG_FILE')
  $configPath = if ([string]::IsNullOrWhiteSpace($configuredPath)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.aws\config'
  } else { [Environment]::ExpandEnvironmentVariables($configuredPath) }
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
    } elseif ($null -ne $current) { $sections[$current].Add([string]$line) }
  }
  return $sections
}

function Assert-NoAwsOverrides {
  foreach ($name in @(
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN', 'AWS_ROLE_ARN', 'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN', 'AWS_SHARED_CREDENTIALS_FILE'
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
  foreach ($profileName in @('default', $Profile, $SourceReadbackProfile)) {
    foreach ($sectionName in @($profileName, "profile $profileName")) {
      $normalized = $sectionName.ToLowerInvariant()
      if (-not $sections.ContainsKey($normalized)) { continue }
      foreach ($line in $sections[$normalized]) {
        if ($line -imatch '^\s*(?:endpoint_url|services)\s*=') {
          throw "AWS config section $sectionName contains a forbidden endpoint override."
        }
      }
    }
  }
}

function Assert-ExactProvisionerSession {
  param([string]$AwsCli)
  if ($Profile -cne $expectedProfile) { throw "Use only the reviewed AWS profile $expectedProfile." }
  $identity = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity', '--profile', $Profile, '--output', 'json'
  )
  if ([string]$identity.Account -cne $expectedAccountId -or [string]$identity.Arn -cne $expectedPrincipalArn) {
    throw "Refusing AWS access: expected $expectedPrincipalArn in account $expectedAccountId."
  }
  $region = ((& $AwsCli configure get region --profile $Profile) | Out-String).Trim()
  $roleArn = ((& $AwsCli configure get role_arn --profile $Profile) | Out-String).Trim()
  $sourceProfile = ((& $AwsCli configure get source_profile --profile $Profile) | Out-String).Trim()
  $sessionName = ((& $AwsCli configure get role_session_name --profile $Profile) | Out-String).Trim()
  $mfaSerial = ((& $AwsCli configure get mfa_serial --profile $Profile) | Out-String).Trim()
  if (
    $region -cne $expectedRegion -or $roleArn -cne $expectedProvisionerRoleArn -or
    $sourceProfile -cne $expectedSourceProfile -or $sessionName -cne 'techlong-sandbox-provisioner' -or
    $mfaSerial -cne $expectedMfaDeviceArn
  ) { throw 'Provisioner profile region, role, source profile, session name, or MFA serial drifted.' }
}

function Assert-ExactSourceReadbackSession {
  param([string]$AwsCli)
  if ($SourceReadbackProfile -cne $expectedSourceProfile) {
    throw "Use only the reviewed readback profile $expectedSourceProfile."
  }
  $loginSession = ((& $AwsCli configure get login_session --profile $SourceReadbackProfile) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $loginSession -cne $expectedSourcePrincipalArn) {
    throw "Source readback profile must declare login_session = $expectedSourcePrincipalArn."
  }
  $inventory = ((& $AwsCli configure list --profile $SourceReadbackProfile) | Out-String)
  if (
    $LASTEXITCODE -ne 0 -or
    $inventory -cnotmatch '(?m)^\s*access_key\s*:\s*\S+\s*:\s*login\s*:' -or
    $inventory -cnotmatch '(?m)^\s*secret_key\s*:\s*\S+\s*:\s*login\s*:'
  ) { throw 'Source readback credentials must resolve from AWS CLI login.' }
  $identity = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity', '--profile', $SourceReadbackProfile, '--output', 'json'
  )
  $region = ((& $AwsCli configure get region --profile $SourceReadbackProfile) | Out-String).Trim()
  if (
    [string]$identity.Account -cne $expectedAccountId -or
    [string]$identity.Arn -cne $expectedSourcePrincipalArn -or
    $region -cne $expectedRegion
  ) { throw 'Source readback profile identity, account, or region drifted.' }
  $mfa = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-mfa-devices', '--profile', $SourceReadbackProfile,
    '--user-name', $expectedSourceUserName, '--output', 'json'
  )
  $devices = @($mfa.MFADevices)
  if (
    $devices.Count -ne 1 -or [string]$devices[0].UserName -cne $expectedSourceUserName -or
    [string]$devices[0].SerialNumber -cne $expectedMfaDeviceArn
  ) { throw "Source user must retain exactly MFA device $expectedMfaDeviceArn." }
}

function Get-TemplateDigests {
  param([Parameter(Mandatory)][string]$ReviewedTemplatePath)
  $raw = (Get-FileHash -LiteralPath $ReviewedTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $canonical = ((& node $templateVerifier --hash-template $ReviewedTemplatePath) | Out-String).Trim()
  if ($raw -cnotmatch '^[a-f0-9]{64}$' -or $canonical -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Unable to calculate exact raw and canonical template SHA-256 values.'
  }
  return @{ Raw = $raw; Canonical = $canonical }
}

function New-ReadOnlyTemplateSnapshot {
  param([Parameter(Mandatory)][string]$DestinationPath)
  $templateBytes = [System.IO.File]::ReadAllBytes($templatePath)
  [System.IO.File]::WriteAllBytes($DestinationPath, $templateBytes)
  [System.IO.File]::SetAttributes(
    $DestinationPath,
    [System.IO.FileAttributes]::ReadOnly
  )
  $snapshotAttributes = [System.IO.File]::GetAttributes($DestinationPath)
  if (($snapshotAttributes -band [System.IO.FileAttributes]::ReadOnly) -eq 0) {
    throw 'Unable to make the reviewed template snapshot read-only.'
  }
  return $DestinationPath
}

function Assert-ConfirmedTemplateDigests {
  param([Parameter(Mandatory)][string]$ReviewedTemplatePath)
  $digests = Get-TemplateDigests -ReviewedTemplatePath $ReviewedTemplatePath
  if ($ConfirmTemplateSha256 -cne $digests.Raw) {
    throw 'AWS writes require the exact snapshot raw -ConfirmTemplateSha256.'
  }
  if ($ConfirmTemplateCanonicalSha256 -cne $digests.Canonical) {
    throw 'AWS writes require the exact snapshot -ConfirmTemplateCanonicalSha256.'
  }
  return $digests
}

function Assert-ExactExpiresAt {
  param([switch]$RequireFuture)
  if ($ExpiresAt -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') {
    throw 'ExpiresAt must be an exact second-precision UTC timestamp.'
  }
  $parsed = [DateTimeOffset]::ParseExact(
    $ExpiresAt, 'yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  )
  if ($RequireFuture) {
    $remaining = $parsed - [DateTimeOffset]::UtcNow
    if ($remaining.TotalMinutes -lt 15 -or $remaining.TotalHours -gt 3) {
      throw 'ExpiresAt must be between 15 minutes and 3 hours in the future.'
    }
  }
}

function Assert-ConfirmStackId {
  if ($ConfirmStackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j4logs/[a-f0-9-]{36}$') {
    throw 'The exact B5-J4a -ConfirmStackId is required.'
  }
}

function Assert-WriteGate {
  param(
    [switch]$Delete,
    [Parameter(Mandatory)][string]$ReviewedTemplatePath
  )
  Assert-ConfirmedTemplateDigests -ReviewedTemplatePath $ReviewedTemplatePath | Out-Null
  if ($ConfirmAccountId -cne $expectedAccountId) { throw "AWS writes require -ConfirmAccountId $expectedAccountId." }
  if ($ConfirmRegion -cne $expectedRegion) { throw "AWS writes require -ConfirmRegion $expectedRegion." }
  if ($ConfirmStackName -cne $stackName) { throw "AWS writes require -ConfirmStackName $stackName." }
  if ($ConfirmLogGroupName -cne $logGroupName) { throw "AWS writes require -ConfirmLogGroupName $logGroupName." }
  if (-not $AcknowledgeAwsWrite) { throw 'AWS writes require -AcknowledgeAwsWrite.' }
  if (-not $AcknowledgeNoEcsCompute) { throw 'AWS writes require -AcknowledgeNoEcsCompute.' }
  if ($Delete) {
    Assert-ConfirmStackId
    if (-not $AcknowledgeExactEmptyLogDeletion) {
      throw 'Delete requires -AcknowledgeExactEmptyLogDeletion.'
    }
    if ($ConfirmExecutionPhrase -cne $deletePhrase) {
      throw "Delete requires -ConfirmExecutionPhrase $deletePhrase."
    }
  } else {
    if (-not $AcknowledgeLowCostNotFree) { throw 'Create requires -AcknowledgeLowCostNotFree.' }
    if ($ConfirmExecutionPhrase -cne $createPhrase) {
      throw "Create requires -ConfirmExecutionPhrase $createPhrase."
    }
  }
}

function Get-StackOrNull {
  param([string]$AwsCli)
  $response = & $AwsCli cloudformation describe-stacks --profile $Profile --region $expectedRegion `
    --stack-name $stackName --output json 2>&1
  if ($LASTEXITCODE -eq 0) {
    $parsed = ConvertFrom-ExactJson -Json (($response | Out-String).Trim())
    if (@($parsed.Stacks).Count -ne 1) { throw 'CloudFormation did not return exactly one B5-J4a stack.' }
    return $parsed.Stacks[0]
  }
  $errorText = (($response | Out-String).Trim())
  if ($errorText -notmatch '(?i)does not exist') { throw "Unable to determine B5-J4a stack state: $errorText" }
  return $null
}

function Assert-ClusterMissing {
  param([object]$Payload)
  $clusters = @($Payload.clusters)
  $failures = @($Payload.failures)
  if (
    $clusters.Count -ne 0 -or $failures.Count -ne 1 -or
    [string]$failures[0].arn -cne $clusterArn -or [string]$failures[0].reason -cne 'MISSING'
  ) { throw "ECS cluster $clusterName is not exactly MISSING." }
}

function Get-ClusterMissingPayload {
  param([string]$AwsCli)
  $payload = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'ecs', 'describe-clusters', '--profile', $Profile, '--region', $expectedRegion,
    '--clusters', $clusterName, '--output', 'json'
  )
  Assert-ClusterMissing -Payload $payload
  return $payload
}

function Get-LogGroupsByExactPrefix {
  param([string]$AwsCli)
  return Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-log-groups', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--log-group-name-prefix', $logGroupName,
    '--no-paginate', '--output', 'json'
  )
}

function Assert-LogGroupAbsent {
  param([string]$AwsCli)
  $response = Get-LogGroupsByExactPrefix -AwsCli $AwsCli
  if (@($response.logGroups).Count -ne 0) {
    throw "The exact log-group prefix $logGroupName is not empty; refusing CREATE or reporting incomplete DELETE."
  }
}

function Assert-AccountSubscriptionPoliciesAbsent {
  param([string]$AwsCli)
  $payload = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-account-policies', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--policy-type', 'SUBSCRIPTION_FILTER_POLICY',
    '--no-paginate', '--output', 'json'
  )
  $propertyNames = @($payload.PSObject.Properties.Name)
  if (
    $propertyNames.Count -ne 1 -or [string]$propertyNames[0] -cne 'accountPolicies' -or
    @($payload.accountPolicies).Count -ne 0
  ) { throw 'Account subscription-filter policies are not the exact empty set.' }
}

function Assert-StackTags {
  param([object]$Stack)
  $map = @{}
  foreach ($tag in @($Stack.Tags)) {
    if ($map.ContainsKey([string]$tag.Key)) { throw "Duplicate stack tag $($tag.Key)." }
    $map[[string]$tag.Key] = [string]$tag.Value
  }
  $expected = @{
    Environment = 'aws-sandbox'; ManagedBy = 'techlong-provisioner';
    AppInstanceId = $expectedAppInstanceId; DeploymentId = $expectedDeploymentId; ExpiresAt = $ExpiresAt
  }
  if ($map.Count -ne $expected.Count) { throw 'B5-J4a stack must have exactly five ownership tags.' }
  foreach ($key in $expected.Keys) {
    if ($map[$key] -cne $expected[$key]) { throw "B5-J4a stack tag $key drifted." }
  }
}

function Assert-ExactStackAndLog {
  param(
    [string]$AwsCli,
    [string]$ExpectedStackId,
    [string]$TemporaryDirectory,
    [Parameter(Mandatory)][string]$ReviewedTemplatePath
  )
  $stack = Get-StackOrNull -AwsCli $AwsCli
  if ($null -eq $stack) { throw "Stack $stackName does not exist." }
  if (
    [string]$stack.StackName -cne $stackName -or [string]$stack.StackId -cne $ExpectedStackId -or
    [string]$stack.StackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j4logs/[a-f0-9-]{36}$' -or
    [string]$stack.StackStatus -cne 'CREATE_COMPLETE' -or [string]$stack.RoleARN -cne $cloudFormationRoleArn -or
    [bool]$stack.EnableTerminationProtection
  ) { throw 'B5-J4a stack identity, status, role, or termination-protection state drifted.' }
  $parameters = @($stack.Parameters)
  if (
    $parameters.Count -ne 1 -or [string]$parameters[0].ParameterKey -cne 'ExpiresAt' -or
    [string]$parameters[0].ParameterValue -cne $ExpiresAt
  ) { throw 'B5-J4a stack ExpiresAt parameter drifted.' }
  Assert-StackTags -Stack $stack
  $outputMap = @{}
  foreach ($output in @($stack.Outputs)) { $outputMap[[string]$output.OutputKey] = [string]$output.OutputValue }
  if (
    $outputMap.Count -ne 2 -or $outputMap.LogGroupName -cne $logGroupName -or
    $outputMap.LogGroupArn -cne "$logGroupArn`:*"
  ) { throw 'B5-J4a stack outputs drifted.' }

  $resources = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stack-resources', '--profile', $Profile, '--region', $expectedRegion,
    '--stack-name', $ExpectedStackId, '--output', 'json'
  )
  $inventory = @($resources.StackResourceSummaries)
  if (
    $inventory.Count -ne 1 -or [string]$inventory[0].LogicalResourceId -cne 'TenantLifecycleLogGroup' -or
    [string]$inventory[0].ResourceType -cne 'AWS::Logs::LogGroup' -or
    [string]$inventory[0].PhysicalResourceId -cne $logGroupName -or
    [string]$inventory[0].ResourceStatus -cne 'CREATE_COMPLETE'
  ) { throw 'B5-J4a stack resource inventory is not the exact one-resource log-group contract.' }

  $templateResponsePath = Join-Path $TemporaryDirectory 'get-template.json'
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template', '--profile', $Profile, '--region', $expectedRegion,
    '--stack-name', $ExpectedStackId, '--template-stage', 'Original', '--output', 'json'
  ) -OutputPath $templateResponsePath
  $digests = Get-TemplateDigests -ReviewedTemplatePath $ReviewedTemplatePath
  $verified = ((& node $templateVerifier --expected-template $ReviewedTemplatePath `
    --get-template-response $templateResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verified -cne $digests.Canonical) {
    throw 'Deployed B5-J4a template differs from the exact reviewed template.'
  }

  $describePath = Join-Path $TemporaryDirectory 'describe-log-groups.json'
  $tagsPath = Join-Path $TemporaryDirectory 'list-log-tags.json'
  $streamsPath = Join-Path $TemporaryDirectory 'describe-log-streams.json'
  $subscriptionsPath = Join-Path $TemporaryDirectory 'describe-subscription-filters.json'
  $accountSubscriptionsPath = Join-Path $TemporaryDirectory 'describe-account-subscription-policies.json'
  $clusterPath = Join-Path $TemporaryDirectory 'describe-clusters.json'
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-log-groups', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--log-group-name-prefix', $logGroupName, '--no-paginate', '--output', 'json'
  ) -OutputPath $describePath
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'logs', 'list-tags-for-resource', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--resource-arn', $logGroupArn, '--output', 'json'
  ) -OutputPath $tagsPath
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-log-streams', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--log-group-name', $logGroupName, '--limit', '1', '--no-paginate', '--output', 'json'
  ) -OutputPath $streamsPath
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-subscription-filters', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--log-group-name', $logGroupName,
    '--limit', '1', '--no-paginate', '--output', 'json'
  ) -OutputPath $subscriptionsPath
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-account-policies', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--policy-type', 'SUBSCRIPTION_FILTER_POLICY',
    '--no-paginate', '--output', 'json'
  ) -OutputPath $accountSubscriptionsPath
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'ecs', 'describe-clusters', '--profile', $Profile, '--region', $expectedRegion,
    '--clusters', $clusterName, '--output', 'json'
  ) -OutputPath $clusterPath
  $clusterPayload = ConvertFrom-ExactJson -Json (Get-Content -Raw -LiteralPath $clusterPath)
  Assert-ClusterMissing -Payload $clusterPayload
  $evidence = ((& node $validator --template $ReviewedTemplatePath --describe $describePath `
    --tags $tagsPath --streams $streamsPath --subscriptions $subscriptionsPath `
    --account-subscriptions $accountSubscriptionsPath --cluster $clusterPath `
    --expires-at $ExpiresAt --stack-id $ExpectedStackId) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($evidence)) {
    throw 'Exact B5-J4a CloudWatch live readback validation failed.'
  }
  $evidenceDocument = ConvertFrom-ExactJson -Json $evidence
  if ([string]$evidenceDocument.canonicalSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw 'B5-J4a live readback did not produce a canonical evidence hash.'
  }
  Write-Host "Verified deployed template canonical SHA-256: $verified"
  Write-Host "Verified exact empty STANDARD lifecycle log group: $logGroupName"
  Write-Host "Verified live evidence canonical SHA-256: $($evidenceDocument.canonicalSha256)"
  Write-Host 'registrationReady=false; liveReadbackReady=false; applyRuntimeReady=false; cleanupRuntimeReady=false.'
}

Write-Host 'Running local B5-J4a lifecycle log support validation...'
if ($Mode -eq 'LocalValidate') {
  & node $validator
  if ($LASTEXITCODE -ne 0) { throw 'Local B5-J4a validation failed.' }
  $digests = Get-TemplateDigests -ReviewedTemplatePath $templatePath
  Write-Host "Template SHA-256: $($digests.Raw)"
  Write-Host "Template canonical SHA-256: $($digests.Canonical)"
  Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
  exit 0
}

foreach ($profileName in @($Profile, $SourceReadbackProfile)) {
  if ($profileName -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw 'AWS profile name contains unsupported characters.' }
}
Assert-ExactExpiresAt -RequireFuture:($Mode -in @('OnlineValidate', 'Create'))
if ($Mode -eq 'Readback') {
  Assert-ConfirmStackId
  if ($ConfirmLogGroupName -cne $logGroupName) { throw "Readback requires -ConfirmLogGroupName $logGroupName." }
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "techlong-b5j4logs-$([Guid]::NewGuid().ToString('N'))"
$previousIgnoreEndpoints = [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')
$previousPager = [Environment]::GetEnvironmentVariable('AWS_PAGER')
try {
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $templateSnapshotPath = Join-Path $temporaryDirectory 'reviewed-template.json'
  New-ReadOnlyTemplateSnapshot -DestinationPath $templateSnapshotPath | Out-Null
  & node $validator --template $templateSnapshotPath
  if ($LASTEXITCODE -ne 0) { throw 'The immutable B5-J4a template snapshot failed validation.' }
  if ($Mode -eq 'Create' -or $Mode -eq 'Delete') {
    Assert-WriteGate -Delete:($Mode -eq 'Delete') -ReviewedTemplatePath $templateSnapshotPath
  }
  Assert-NoAwsOverrides
  [Environment]::SetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS', 'true', 'Process')
  [Environment]::SetEnvironmentVariable('AWS_PAGER', '', 'Process')
  $awsCli = Resolve-AwsCli
  Assert-ExactProvisionerSession -AwsCli $awsCli
  Assert-ExactSourceReadbackSession -AwsCli $awsCli
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template', '--profile', $Profile, '--region', $expectedRegion,
    '--template-body', "file://$templateSnapshotPath"
  )

  if ($Mode -eq 'OnlineValidate') {
    if ($null -ne (Get-StackOrNull -AwsCli $awsCli)) { throw "Stack $stackName already exists; use Readback." }
    Assert-LogGroupAbsent -AwsCli $awsCli
    Assert-AccountSubscriptionPoliciesAbsent -AwsCli $awsCli
    Get-ClusterMissingPayload -AwsCli $awsCli | Out-Null
    Write-Host 'Online validation proved exact stack/log-group absence and ECS cluster MISSING. No resource changed.'
    exit 0
  }
  if ($Mode -eq 'Readback') {
    Assert-ExactStackAndLog -AwsCli $awsCli -ExpectedStackId $ConfirmStackId `
      -TemporaryDirectory $temporaryDirectory -ReviewedTemplatePath $templateSnapshotPath
    exit 0
  }
  if ($Mode -eq 'Create') {
    if ($null -ne (Get-StackOrNull -AwsCli $awsCli)) { throw "Stack $stackName already exists; CREATE-only mode refuses update." }
    Assert-LogGroupAbsent -AwsCli $awsCli
    Assert-AccountSubscriptionPoliciesAbsent -AwsCli $awsCli
    Get-ClusterMissingPayload -AwsCli $awsCli | Out-Null
    $digests = Assert-ConfirmedTemplateDigests -ReviewedTemplatePath $templateSnapshotPath
    $response = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
      'cloudformation', 'create-stack', '--profile', $Profile, '--region', $expectedRegion,
      '--stack-name', $stackName, '--template-body', "file://$templateSnapshotPath",
      '--role-arn', $cloudFormationRoleArn, '--on-failure', 'DELETE',
      '--parameters', "ParameterKey=ExpiresAt,ParameterValue=$ExpiresAt",
      '--tags', 'Key=Environment,Value=aws-sandbox', 'Key=ManagedBy,Value=techlong-provisioner',
      'Key=AppInstanceId,Value=tenant-lifecycle', 'Key=DeploymentId,Value=b5j4-log-support',
      "Key=ExpiresAt,Value=$ExpiresAt", '--resource-types', 'AWS::Logs::LogGroup',
      '--timeout-in-minutes', '10', '--client-request-token',
      "b5j4logs-$(($ExpiresAt -replace '[-:]',''))-$($digests.Raw.Substring(0, 16))",
      '--output', 'json'
    )
    $createdStackId = [string]$response.StackId
    if ($createdStackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j4logs/[a-f0-9-]{36}$') {
      throw 'CreateStack returned an unexpected StackId.'
    }
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', 'stack-create-complete', '--profile', $Profile,
      '--region', $expectedRegion, '--stack-name', $createdStackId
    )
    Assert-ExactStackAndLog -AwsCli $awsCli -ExpectedStackId $createdStackId `
      -TemporaryDirectory $temporaryDirectory -ReviewedTemplatePath $templateSnapshotPath
    Write-Host "Created exact B5-J4a support stack: $createdStackId"
    Write-Host 'No ECS task, service, cluster, stream, subscription, or metric filter was created.'
    exit 0
  }

  $stack = Get-StackOrNull -AwsCli $awsCli
  if ($null -eq $stack -or [string]$stack.StackId -cne $ConfirmStackId) {
    throw 'Delete target does not match the exact confirmed StackId.'
  }
  if ([string]$stack.StackStatus -cne 'CREATE_COMPLETE') {
    throw "Delete target is not in a reviewed deletable state: $($stack.StackStatus)."
  }
  Assert-ExactStackAndLog -AwsCli $awsCli -ExpectedStackId $ConfirmStackId `
    -TemporaryDirectory $temporaryDirectory -ReviewedTemplatePath $templateSnapshotPath
  Assert-ConfirmedTemplateDigests -ReviewedTemplatePath $templateSnapshotPath | Out-Null
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'delete-stack', '--profile', $Profile, '--region', $expectedRegion,
    '--stack-name', $ConfirmStackId, '--role-arn', $cloudFormationRoleArn
  )
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'wait', 'stack-delete-complete', '--profile', $Profile,
    '--region', $expectedRegion, '--stack-name', $ConfirmStackId
  )
  if ($null -ne (Get-StackOrNull -AwsCli $awsCli)) { throw 'Stack still exists after deletion waiter completed.' }
  Assert-LogGroupAbsent -AwsCli $awsCli
  Get-ClusterMissingPayload -AwsCli $awsCli | Out-Null
  Write-Host "Deleted exact empty lifecycle log group stack: $ConfirmStackId"
} finally {
  [Environment]::SetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS', $previousIgnoreEndpoints, 'Process')
  [Environment]::SetEnvironmentVariable('AWS_PAGER', $previousPager, 'Process')
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
