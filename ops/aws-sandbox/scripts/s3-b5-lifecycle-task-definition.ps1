[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate', 'CreateStack', 'Readback', 'DeleteStack')]
  [string]$Mode = 'LocalValidate',
  [string]$Profile = 'techlong-sandbox-provisioner',
  [string]$ExpiresAt = '',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmRegion = '',
  [string]$ConfirmStackName = '',
  [string]$ConfirmTemplateSha256 = '',
  [string]$ConfirmTaskDefinitionArn = '',
  [string]$ConfirmExecutionPhrase = '',
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeLowCostNotFree,
  [switch]$AcknowledgeNoTaskExecution,
  [switch]$AcknowledgeExactDeregistration
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedProfile = 'techlong-sandbox-provisioner'
$expectedPrincipalArn = 'arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner'
$stackName = 'techlong-sandbox-tenant-b5j3'
$cloudFormationRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole'
$expectedAppInstanceId = 'tenant-lifecycle'
$expectedDeploymentId = 'b5j3-f4aa0febeba5'
$root = Split-Path -Parent $PSScriptRoot
$templatePath = Join-Path $root 'cloudformation\s3-b5-lifecycle-task-definition.template.json'
$validator = Join-Path $root 'scripts\validate-b5-lifecycle-task-definition.mjs'
$templateVerifier = Join-Path $root 'scripts\verify-change-set-template.mjs'
$createPhrase = 'I_ACKNOWLEDGE_INSPECT_ONLY_TASK_DEFINITION_REGISTRATION'
$deletePhrase = 'I_ACKNOWLEDGE_EXACT_TASK_DEFINITION_DEREGISTRATION'

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $knownPath = 'D:\Amazon\AWSCLIV2\aws.exe'
  if (Test-Path -LiteralPath $knownPath) { return $knownPath }
  throw 'AWS CLI v2 was not found.'
}

function Invoke-AwsChecked {
  param([string]$AwsCli, [string[]]$Arguments)
  & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed with exit code $LASTEXITCODE."
  }
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
  param([string]$AwsCli, [string[]]$Arguments)
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed with exit code $LASTEXITCODE."
  }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw 'AWS CLI returned an empty JSON response.'
  }
  return (ConvertFrom-ExactJson -Json $json)
}

function Invoke-AwsJsonFile {
  param(
    [string]$AwsCli,
    [string[]]$Arguments,
    [string]$OutputPath
  )
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed with exit code $LASTEXITCODE."
  }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw 'AWS CLI returned an empty JSON response.'
  }
  [System.IO.File]::WriteAllText(
    $OutputPath,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
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
  $currentSection = $null
  foreach ($line in Get-Content -LiteralPath $configPath) {
    if ($line -match '^\s*\[([^]]+)\]\s*$') {
      $currentSection = $Matches[1].Trim().ToLowerInvariant()
      if (-not $sections.ContainsKey($currentSection)) {
        $sections[$currentSection] = [System.Collections.Generic.List[string]]::new()
      }
      continue
    }
    if ($null -ne $currentSection) {
      $sections[$currentSection].Add([string]$line)
    }
  }
  return $sections
}

function Assert-NoAwsEndpointOverrides {
  foreach ($environmentKey in [Environment]::GetEnvironmentVariables().Keys) {
    if ([string]$environmentKey -imatch '^AWS_ENDPOINT_URL(?:_|$)') {
      throw "Refusing AWS access while endpoint override $environmentKey is set."
    }
  }
  $sections = Read-AwsSharedConfigSections
  foreach ($sectionName in @('default', "profile $Profile", $Profile)) {
    $normalized = $sectionName.ToLowerInvariant()
    if (-not $sections.ContainsKey($normalized)) { continue }
    foreach ($line in $sections[$normalized]) {
      if ($line -imatch '^\s*(?:endpoint_url|services)\s*=') {
        throw "AWS config section $sectionName contains a forbidden endpoint override."
      }
    }
  }
}

function Assert-ExactProvisionerSession {
  param([string]$AwsCli)
  if ($Profile -cne $expectedProfile) {
    throw "Use only the reviewed AWS profile $expectedProfile."
  }
  foreach ($credentialVariable in @(
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN'
  )) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($credentialVariable))) {
      throw "Refusing AWS access while $credentialVariable is set; use only the reviewed profile."
    }
  }
  $identity = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity',
    '--profile', $Profile,
    '--output', 'json'
  )
  if (
    [string]$identity.Account -cne $expectedAccountId -or
    [string]$identity.Arn -cne $expectedPrincipalArn
  ) {
    throw "Refusing AWS access: expected $expectedPrincipalArn in account $expectedAccountId."
  }
  $configuredRegion = ((& $AwsCli configure get region --profile $Profile) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $configuredRegion -cne $expectedRegion) {
    throw "AWS profile must be pinned to $expectedRegion."
  }
}

function Get-CanonicalTemplateHash {
  $hash = ((& node $templateVerifier --hash-template $templatePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $hash -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Unable to calculate the canonical template SHA-256.'
  }
  return $hash
}

function Assert-ExactExpiresAt {
  param([switch]$RequireFuture)
  if ($ExpiresAt -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') {
    throw 'ExpiresAt must be an exact second-precision UTC timestamp.'
  }
  $parsed = [DateTimeOffset]::ParseExact(
    $ExpiresAt,
    'yyyy-MM-ddTHH:mm:ssZ',
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  )
  if ($RequireFuture) {
    $remaining = $parsed - [DateTimeOffset]::UtcNow
    if ($remaining.TotalMinutes -lt 15 -or $remaining.TotalHours -gt 24) {
      throw 'ExpiresAt must be between 15 minutes and 24 hours in the future.'
    }
  }
}

function Assert-WriteGate {
  param([switch]$Delete)
  if ($ConfirmAccountId -cne $expectedAccountId) {
    throw "AWS writes require -ConfirmAccountId $expectedAccountId."
  }
  if ($ConfirmRegion -cne $expectedRegion) {
    throw "AWS writes require -ConfirmRegion $expectedRegion."
  }
  if ($ConfirmStackName -cne $stackName) {
    throw "AWS writes require -ConfirmStackName $stackName."
  }
  if ($ConfirmTemplateSha256 -cne (Get-CanonicalTemplateHash)) {
    throw 'AWS writes require the exact current -ConfirmTemplateSha256 value.'
  }
  if (-not $AcknowledgeAwsWrite) {
    throw 'AWS writes require -AcknowledgeAwsWrite.'
  }
  if (-not $AcknowledgeLowCostNotFree) {
    throw 'AWS writes require -AcknowledgeLowCostNotFree.'
  }
  if (-not $AcknowledgeNoTaskExecution) {
    throw 'AWS writes require -AcknowledgeNoTaskExecution.'
  }
  if ($Delete) {
    if (-not $AcknowledgeExactDeregistration) {
      throw 'DeleteStack requires -AcknowledgeExactDeregistration.'
    }
    if ($ConfirmExecutionPhrase -cne $deletePhrase) {
      throw "DeleteStack requires -ConfirmExecutionPhrase $deletePhrase."
    }
  } elseif ($ConfirmExecutionPhrase -cne $createPhrase) {
    throw "CreateStack requires -ConfirmExecutionPhrase $createPhrase."
  }
}

function Get-StackOrNull {
  param([string]$AwsCli)
  $response = & $AwsCli cloudformation describe-stacks `
    --profile $Profile `
    --region $expectedRegion `
    --stack-name $stackName `
    --output json 2>&1
  if ($LASTEXITCODE -eq 0) {
    $parsed = ConvertFrom-ExactJson -Json (($response | Out-String).Trim())
    if (@($parsed.Stacks).Count -ne 1) {
      throw 'CloudFormation did not return exactly one registration stack.'
    }
    return $parsed.Stacks[0]
  }
  $errorText = (($response | Out-String).Trim())
  if ($errorText -notmatch '(?i)does not exist') {
    throw "Unable to determine registration stack state: $errorText"
  }
  return $null
}

function Assert-NoActiveLifecycleTaskDefinition {
  param([string]$AwsCli)
  $response = & $AwsCli ecs describe-task-definition `
    --profile $Profile `
    --region $expectedRegion `
    --task-definition tenant-lifecycle `
    --include TAGS `
    --output json 2>&1
  if ($LASTEXITCODE -eq 0) {
    throw 'A tenant-lifecycle TaskDefinition already exists outside the exact registration stack; refusing a duplicate revision.'
  }
  $errorText = (($response | Out-String).Trim())
  if ($errorText -notmatch '(?i)Unable to describe task definition') {
    throw "Unable to prove that no lifecycle TaskDefinition exists: $errorText"
  }
}

function Assert-StackTags {
  param($Stack)
  $tagMap = @{}
  foreach ($tag in @($Stack.Tags)) {
    $key = [string]$tag.Key
    if ($tagMap.ContainsKey($key)) { throw "Duplicate stack tag $key." }
    $tagMap[$key] = [string]$tag.Value
  }
  if (@($tagMap.Keys).Count -ne 5) {
    throw 'Registration stack must have exactly five reviewed tags.'
  }
  $expected = @{
    Environment = 'aws-sandbox'
    ManagedBy = 'techlong-provisioner'
    AppInstanceId = $expectedAppInstanceId
    DeploymentId = $expectedDeploymentId
    ExpiresAt = $ExpiresAt
  }
  foreach ($key in $expected.Keys) {
    if ($tagMap[$key] -cne $expected[$key]) {
      throw "Registration stack tag $key drifted."
    }
  }
}

function Assert-ExactStackAndTaskDefinition {
  param([string]$AwsCli, [string]$TemporaryDirectory)
  $stack = Get-StackOrNull -AwsCli $AwsCli
  if ($null -eq $stack) { throw "Registration stack $stackName does not exist." }
  if ([string]$stack.StackStatus -cne 'CREATE_COMPLETE') {
    throw "Registration stack is not CREATE_COMPLETE: $($stack.StackStatus)."
  }
  if (
    [string]$stack.StackName -cne $stackName -or
    [string]$stack.StackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j3/[a-f0-9-]{36}$'
  ) {
    throw 'Registration stack identity drifted from the exact account, region, and name.'
  }
  if ([string]$stack.RoleARN -cne $cloudFormationRoleArn) {
    throw 'Registration stack does not use the reviewed CloudFormation execution role.'
  }
  if ([bool]$stack.EnableTerminationProtection) {
    throw 'Registration stack may not enable termination protection.'
  }
  if ($null -ne $stack.Parameters -and @($stack.Parameters).Count -ne 0) {
    throw 'Registration stack may not have parameters.'
  }
  Assert-StackTags -Stack $stack
  $outputs = @($stack.Outputs)
  if (
    $outputs.Count -ne 1 -or
    [string]$outputs[0].OutputKey -cne 'TaskDefinitionArn'
  ) {
    throw 'Registration stack must expose exactly TaskDefinitionArn.'
  }
  $taskDefinitionArn = [string]$outputs[0].OutputValue
  if ($taskDefinitionArn -cnotmatch '^arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:[1-9][0-9]*$') {
    throw 'TaskDefinition output is not the exact revision-pinned ARN.'
  }
  if (
    -not [string]::IsNullOrWhiteSpace($ConfirmTaskDefinitionArn) -and
    $ConfirmTaskDefinitionArn -cne $taskDefinitionArn
  ) {
    throw 'ConfirmTaskDefinitionArn does not match the exact stack output.'
  }

  $resourcesResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stack-resources',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $stackName,
    '--output', 'json'
  )
  $summaries = @($resourcesResponse.StackResourceSummaries)
  if (
    $summaries.Count -ne 1 -or
    [string]$summaries[0].LogicalResourceId -cne 'TenantLifecycleTaskDefinition' -or
    [string]$summaries[0].ResourceType -cne 'AWS::ECS::TaskDefinition' -or
    [string]$summaries[0].ResourceStatus -cne 'CREATE_COMPLETE' -or
    [string]$summaries[0].PhysicalResourceId -cne $taskDefinitionArn
  ) {
    throw 'Registration stack resource inventory drifted from the exact one-resource contract.'
  }

  $templateResponsePath = Join-Path $TemporaryDirectory 'get-template.json'
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $stackName,
    '--template-stage', 'Original',
    '--output', 'json'
  ) -OutputPath $templateResponsePath
  $verifiedTemplateHash = ((& node $templateVerifier `
    --expected-template $templatePath `
    --get-template-response $templateResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verifiedTemplateHash -cne (Get-CanonicalTemplateHash)) {
    throw 'Deployed registration stack template differs from the exact reviewed template.'
  }

  $readbackPath = Join-Path $TemporaryDirectory 'describe-task-definition.json'
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'ecs', 'describe-task-definition',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--task-definition', $taskDefinitionArn,
    '--include', 'TAGS',
    '--output', 'json'
  ) -OutputPath $readbackPath
  $readback = ConvertFrom-ExactJson -Json (Get-Content -Raw -LiteralPath $readbackPath)
  $registeredAt = [DateTimeOffset]::Parse([string]$readback.taskDefinition.registeredAt)
  $stackCreatedAt = [DateTimeOffset]::Parse([string]$stack.CreationTime)
  if (
    $registeredAt -lt $stackCreatedAt.AddMinutes(-1) -or
    $registeredAt -gt [DateTimeOffset]::UtcNow.AddMinutes(1)
  ) {
    throw 'TaskDefinition registeredAt is outside the exact stack creation window.'
  }
  $evidence = ((& node $validator `
    --readback $readbackPath `
    --expires-at $ExpiresAt `
    --stack-id ([string]$stack.StackId)) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($evidence)) {
    throw 'Exact revision TaskDefinition readback validation failed.'
  }
  Write-Host "Verified deployed template canonical SHA-256: $verifiedTemplateHash"
  Write-Host "Verified exact ACTIVE TaskDefinition revision: $taskDefinitionArn"
  Write-Host 'registrationReady=false; liveReadbackReady=false; applyRuntimeReady=false; cleanupRuntimeReady=false.'
  return $taskDefinitionArn
}

function Get-ExactDeletionTarget {
  param([string]$AwsCli, [string]$TemporaryDirectory)
  $stack = Get-StackOrNull -AwsCli $AwsCli
  if ($null -eq $stack) { throw "Registration stack $stackName does not exist." }
  if ([string]$stack.StackStatus -notin @('CREATE_COMPLETE', 'DELETE_FAILED')) {
    throw "Registration stack is not in an exact deletable state: $($stack.StackStatus)."
  }
  if (
    [string]$stack.StackName -cne $stackName -or
    [string]$stack.StackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j3/[a-f0-9-]{36}$' -or
    [string]$stack.RoleARN -cne $cloudFormationRoleArn -or
    [bool]$stack.EnableTerminationProtection -or
    ($null -ne $stack.Parameters -and @($stack.Parameters).Count -ne 0)
  ) {
    throw 'Deletion target is not the exact reviewed registration stack.'
  }
  Assert-StackTags -Stack $stack
  $outputs = @($stack.Outputs)
  if ($outputs.Count -ne 1 -or [string]$outputs[0].OutputKey -cne 'TaskDefinitionArn') {
    throw 'Deletion target must expose exactly TaskDefinitionArn.'
  }
  $taskDefinitionArn = [string]$outputs[0].OutputValue
  if (
    $taskDefinitionArn -cnotmatch '^arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:[1-9][0-9]*$' -or
    $ConfirmTaskDefinitionArn -cne $taskDefinitionArn
  ) {
    throw 'DeleteStack requires the exact current -ConfirmTaskDefinitionArn.'
  }

  $resourcesResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stack-resources',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $stackName,
    '--output', 'json'
  )
  $summaries = @($resourcesResponse.StackResourceSummaries)
  if (
    $summaries.Count -ne 1 -or
    [string]$summaries[0].LogicalResourceId -cne 'TenantLifecycleTaskDefinition' -or
    [string]$summaries[0].ResourceType -cne 'AWS::ECS::TaskDefinition' -or
    [string]$summaries[0].ResourceStatus -notin @('CREATE_COMPLETE', 'DELETE_FAILED', 'DELETE_COMPLETE') -or
    [string]$summaries[0].PhysicalResourceId -cne $taskDefinitionArn
  ) {
    throw 'Deletion target resource inventory drifted from the exact one-resource contract.'
  }

  $templateResponsePath = Join-Path $TemporaryDirectory 'delete-get-template.json'
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $stackName,
    '--template-stage', 'Original',
    '--output', 'json'
  ) -OutputPath $templateResponsePath
  $verifiedTemplateHash = ((& node $templateVerifier `
    --expected-template $templatePath `
    --get-template-response $templateResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verifiedTemplateHash -cne (Get-CanonicalTemplateHash)) {
    throw 'Deletion target template differs from the exact reviewed template.'
  }
  return $taskDefinitionArn
}

Write-Host 'Running local B5-J3 one-resource TaskDefinition validation...'
& node $validator
if ($LASTEXITCODE -ne 0) { throw 'Local B5-J3 validation failed.' }

if ($Mode -eq 'LocalValidate') {
  Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
  exit 0
}

if ($Profile -notmatch '^[A-Za-z0-9_-]{1,64}$') {
  throw 'AWS profile name contains unsupported characters.'
}
Assert-ExactExpiresAt -RequireFuture:($Mode -in @('OnlineValidate', 'CreateStack'))
if ($Mode -in @('CreateStack', 'DeleteStack')) {
  Assert-WriteGate -Delete:($Mode -eq 'DeleteStack')
}

$temporaryDirectory = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-b5j3-taskdef-$([Guid]::NewGuid().ToString('N'))"
)
$previousIgnoreConfiguredEndpointUrls =
  [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')

try {
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  Assert-NoAwsEndpointOverrides
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    'true',
    [EnvironmentVariableTarget]::Process
  )
  $awsCli = Resolve-AwsCli
  Assert-ExactProvisionerSession -AwsCli $awsCli

  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--template-body', "file://$templatePath"
  )

  if ($Mode -eq 'OnlineValidate') {
    $existingStack = Get-StackOrNull -AwsCli $awsCli
    if ($null -eq $existingStack) {
      Assert-NoActiveLifecycleTaskDefinition -AwsCli $awsCli
      Write-Host 'Online validation passed; the exact registration stack does not exist.'
    } else {
      Write-Host "Online validation passed; stack status is $($existingStack.StackStatus). Use Readback for exact verification."
    }
    exit 0
  }

  if ($Mode -eq 'Readback') {
    Assert-ExactStackAndTaskDefinition -AwsCli $awsCli -TemporaryDirectory $temporaryDirectory | Out-Null
    exit 0
  }

  if ($Mode -eq 'CreateStack') {
    $existingStack = Get-StackOrNull -AwsCli $awsCli
    if ($null -ne $existingStack) {
      Assert-ExactStackAndTaskDefinition -AwsCli $awsCli -TemporaryDirectory $temporaryDirectory | Out-Null
      Write-Host 'Exact registration stack already exists; no new TaskDefinition revision was registered.'
      exit 0
    }
    Assert-NoActiveLifecycleTaskDefinition -AwsCli $awsCli
    $stackTags = @(
      'Key=Environment,Value=aws-sandbox',
      'Key=ManagedBy,Value=techlong-provisioner',
      "Key=AppInstanceId,Value=$expectedAppInstanceId",
      "Key=DeploymentId,Value=$expectedDeploymentId",
      "Key=ExpiresAt,Value=$ExpiresAt"
    )
    $createArguments = @(
      'cloudformation', 'create-stack',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $stackName,
      '--template-body', "file://$templatePath",
      '--role-arn', $cloudFormationRoleArn,
      '--on-failure', 'DELETE',
      '--tags'
    ) + $stackTags
    Invoke-AwsChecked -AwsCli $awsCli -Arguments $createArguments
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', 'stack-create-complete',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $stackName
    )
    Assert-ExactStackAndTaskDefinition -AwsCli $awsCli -TemporaryDirectory $temporaryDirectory | Out-Null
    Write-Host 'Inspect-only TaskDefinition registration completed. No ECS task was started.'
    exit 0
  }

  $taskDefinitionArn = Get-ExactDeletionTarget `
    -AwsCli $awsCli `
    -TemporaryDirectory $temporaryDirectory
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'delete-stack',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $stackName,
    '--role-arn', $cloudFormationRoleArn
  )
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'wait', 'stack-delete-complete',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $stackName
  )
  if ($null -ne (Get-StackOrNull -AwsCli $awsCli)) {
    throw 'CloudFormation reported deletion complete but the exact stack still exists.'
  }
  $inactiveResponse = & $awsCli ecs describe-task-definition `
    --profile $Profile `
    --region $expectedRegion `
    --task-definition $taskDefinitionArn `
    --include TAGS `
    --output json 2>&1
  if ($LASTEXITCODE -eq 0) {
    $inactive = ConvertFrom-ExactJson -Json (($inactiveResponse | Out-String).Trim())
    if (
      [string]$inactive.taskDefinition.taskDefinitionArn -cne $taskDefinitionArn -or
      [string]$inactive.taskDefinition.status -cne 'INACTIVE'
    ) {
      throw 'CloudFormation deletion left an unexpected TaskDefinition state.'
    }
  } elseif ((($inactiveResponse | Out-String).Trim()) -notmatch '(?i)Unable to describe task definition') {
    throw 'CloudFormation deleted the stack, but exact TaskDefinition terminal state could not be verified.'
  }
  Write-Host "Deleted exact registration stack; the revision is INACTIVE or no longer describable: $taskDefinitionArn"
} finally {
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    $previousIgnoreConfiguredEndpointUrls,
    [EnvironmentVariableTarget]::Process
  )
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
