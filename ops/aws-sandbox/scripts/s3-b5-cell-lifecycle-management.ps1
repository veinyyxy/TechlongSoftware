[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet', 'Readback')]
  [string]$Mode = 'LocalValidate',
  [ValidateSet('InitialLocked')]
  [string]$UpdateShape = 'InitialLocked',
  [string]$Profile = 'techlong-sandbox-user',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmRegion = '',
  [string]$ConfirmManagementStackName = '',
  [string]$ConfirmTemplateSha256 = '',
  [string]$ConfirmTemplateCanonicalSha256 = '',
  [string]$ConfirmChangeSetName = '',
  [string]$ConfirmChangeSetArn = '',
  [string]$ConfirmStackId = '',
  [string]$ConfirmExecutionPhrase = '',
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeCreatesNamedIam,
  [switch]$AcknowledgeSourceUserBootstrapRisk,
  [switch]$AcknowledgeMfaSession,
  [switch]$AcknowledgeLockedIamOnly,
  [switch]$AcknowledgeChangeSetReviewed
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedProfile = 'techlong-sandbox-user'
$expectedPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$expectedUserName = 'techlong-sandbox-dev'
$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa/techlong-sandbox-dev'
$managementStackName = 'techlong-s3-b5-cell-lifecycle-management'
$cellId = 'cell-sandbox-1'
$cellStackName = 'techlong-sandbox-cell-sandbox-1'
$authorityTableName = 'techlong-sandbox-tenant-external-epoch-authority'
$authorityKey = 'cell:cell-sandbox-1'
$operatorBoundaryName = 'TechlongSandboxCellOperatorBoundary'
$operatorRoleName = 'TechlongSandboxCellOperatorRole'
$executionBoundaryName = 'TechlongSandboxCellCloudFormationExecutionBoundary'
$executionRoleName = 'TechlongSandboxCellCloudFormationExecutionRole'
$operatorBoundaryArn = "arn:aws:iam::$expectedAccountId`:policy/$operatorBoundaryName"
$operatorRoleArn = "arn:aws:iam::$expectedAccountId`:role/$operatorRoleName"
$executionBoundaryArn = "arn:aws:iam::$expectedAccountId`:policy/$executionBoundaryName"
$executionRoleArn = "arn:aws:iam::$expectedAccountId`:role/$executionRoleName"
$managementStackIdPattern = '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/[0-9a-f-]{36}$'
$createPhrase = 'I_ACKNOWLEDGE_J5GA_INITIAL_LOCKED_CHANGE_SET_CREATE'
$executePhrase = 'I_ACKNOWLEDGE_J5GA_INITIAL_LOCKED_IAM_ROOT_EXECUTE'
$root = Split-Path -Parent $PSScriptRoot
$renderer = Join-Path $root 'scripts\render-b5-cell-lifecycle-management.mjs'
$validator = Join-Path $root 'scripts\validate-b5-cell-lifecycle-management.mjs'
$templateVerifier = Join-Path $root 'scripts\verify-change-set-template.mjs'

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $knownPath = 'D:\Amazon\AWSCLIV2\aws.exe'
  if (Test-Path -LiteralPath $knownPath -PathType Leaf) { return $knownPath }
  throw 'AWS CLI v2 was not found.'
}

function Add-AwsTimeoutArguments {
  param([string[]]$Arguments)
  return $Arguments + @('--cli-connect-timeout', '10', '--cli-read-timeout', '30')
}

function Invoke-AwsChecked {
  param([string]$AwsCli, [string[]]$Arguments)
  $safeArguments = Add-AwsTimeoutArguments -Arguments $Arguments
  & $AwsCli @safeArguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed with exit code $LASTEXITCODE."
  }
}

function Invoke-AwsJson {
  param([string]$AwsCli, [string[]]$Arguments)
  $safeArguments = Add-AwsTimeoutArguments -Arguments $Arguments
  $output = & $AwsCli @safeArguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed with exit code $LASTEXITCODE."
  }
  $json = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($json)) {
    throw 'AWS CLI returned an empty JSON response.'
  }
  return ($json | ConvertFrom-Json -Depth 100)
}

function Invoke-AwsJsonFile {
  param([string]$AwsCli, [string[]]$Arguments, [string]$OutputPath)
  $safeArguments = Add-AwsTimeoutArguments -Arguments $Arguments
  $output = & $AwsCli @safeArguments
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

function Get-Sha256Text {
  param([string]$Value)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return ([Convert]::ToHexString($algorithm.ComputeHash($bytes))).ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Get-CanonicalTemplateHash {
  param([string]$TemplatePath)
  $output = & node $templateVerifier --hash-template $TemplatePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to canonicalize the rendered management template.'
  }
  $hash = (($output | Out-String).Trim())
  if ($hash -cnotmatch '^[a-f0-9]{64}$') {
    throw 'The rendered management template canonical SHA-256 is invalid.'
  }
  return $hash
}

function New-ReadOnlyTemplateSnapshot {
  $path = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-s3-b5-cell-lifecycle-management-$([Guid]::NewGuid().ToString('N')).json"
  )
  $output = ((& node $renderer --shape Locked --output $path) | Out-String).Trim()
  if (
    $LASTEXITCODE -ne 0 -or
    [string]::IsNullOrWhiteSpace($output) -or
    -not (Test-Path -LiteralPath $path -PathType Leaf)
  ) {
    throw 'Unable to render the Locked lifecycle management template snapshot.'
  }
  $item = Get-Item -LiteralPath $path
  if ($item.Length -le 0 -or $item.Length -gt 51200) {
    throw 'Rendered management template size is outside the direct-body limit.'
  }
  $item.IsReadOnly = $true
  return [PSCustomObject]@{
    Path = $path
    RawSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    CanonicalSha256 = Get-CanonicalTemplateHash -TemplatePath $path
    Size = [long]$item.Length
  }
}

function Remove-TemplateSnapshot {
  param([object]$Snapshot)
  if ($null -eq $Snapshot -or [string]::IsNullOrEmpty([string]$Snapshot.Path)) { return }
  if (Test-Path -LiteralPath $Snapshot.Path) {
    (Get-Item -LiteralPath $Snapshot.Path).IsReadOnly = $false
    Remove-Item -LiteralPath $Snapshot.Path -Force
  }
}

function Assert-SnapshotUnchanged {
  param([object]$Snapshot)
  if (
    -not (Test-Path -LiteralPath $Snapshot.Path -PathType Leaf) -or
    -not (Get-Item -LiteralPath $Snapshot.Path).IsReadOnly -or
    (Get-FileHash -LiteralPath $Snapshot.Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Snapshot.RawSha256 -or
    (Get-CanonicalTemplateHash -TemplatePath $Snapshot.Path) -cne $Snapshot.CanonicalSha256
  ) {
    throw 'The immutable management template snapshot changed after rendering.'
  }
}

function Get-ChangeSetContract {
  param([object]$Snapshot)
  $binding = "$UpdateShape|$($Snapshot.RawSha256)|$($Snapshot.CanonicalSha256)"
  $bindingHash = Get-Sha256Text -Value $binding
  return [PSCustomObject]@{
    Name = "$managementStackName-initial-locked-$($bindingHash.Substring(0, 16))"
    Description = "B5-J5g-a InitialLocked IAM management root; raw-sha256=$($Snapshot.RawSha256); canonical-sha256=$($Snapshot.CanonicalSha256)"
    ClientToken = "b5j5ga-management-$($bindingHash.Substring(0, 32))"
  }
}

function Assert-ExactSourceLoginSession {
  param([string]$AwsCli)
  foreach ($credentialVariable in @(
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
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($credentialVariable))) {
      throw "Refusing AWS access while $credentialVariable is set; use only the reviewed AWS CLI login_session profile."
    }
  }
  $loginSession = ((& $AwsCli configure get login_session --profile $Profile) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $loginSession -cne $expectedPrincipalArn) {
    throw "AWS profile must declare login_session = $expectedPrincipalArn."
  }
  $credentialInventory = ((& $AwsCli configure list --profile $Profile) | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the AWS profile credential source.'
  }
  if (
    $credentialInventory -cnotmatch '(?m)^\s*access_key\s*:\s*\S+\s*:\s*login\s*:' -or
    $credentialInventory -cnotmatch '(?m)^\s*secret_key\s*:\s*\S+\s*:\s*login\s*:'
  ) {
    throw 'AWS profile credentials must resolve from AWS CLI login, not static keys, credential_process, environment credentials, or AssumeRole.'
  }
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
    if ($null -ne $currentSection) { $sections[$currentSection].Add([string]$line) }
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
  foreach ($candidate in @('default', "profile $Profile", $Profile)) {
    $normalized = $candidate.ToLowerInvariant()
    if (-not $sections.ContainsKey($normalized)) { continue }
    foreach ($line in $sections[$normalized]) {
      if ($line -imatch '^\s*endpoint_url\s*=') {
        throw "AWS config section $candidate contains a forbidden endpoint_url override."
      }
      if ($line -imatch '^\s*services\s*=') {
        throw "AWS config section $candidate contains a forbidden services endpoint configuration."
      }
    }
  }
}

function Assert-ExactSourceIdentity {
  param([string]$AwsCli)
  if ($Profile -cne $expectedProfile) {
    throw "Online modes require the exact AWS profile $expectedProfile."
  }
  Assert-NoAwsEndpointOverrides
  Assert-ExactSourceLoginSession -AwsCli $AwsCli
  $identity = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity', '--profile', $Profile, '--output', 'json'
  )
  if (
    [string]$identity.Account -cne $expectedAccountId -or
    [string]$identity.Arn -cne $expectedPrincipalArn
  ) {
    throw "Refusing AWS access: expected $expectedPrincipalArn in account $expectedAccountId."
  }
  $configuredRegion = ((& $AwsCli configure get region --profile $Profile) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $configuredRegion -cne $expectedRegion) {
    throw "Refusing AWS access: profile region must be $expectedRegion."
  }
  $mfa = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-mfa-devices',
    '--profile', $Profile,
    '--user-name', $expectedUserName,
    '--output', 'json'
  )
  $devices = @($mfa.MFADevices)
  if (
    $devices.Count -ne 1 -or
    [string]$devices[0].UserName -cne $expectedUserName -or
    [string]$devices[0].SerialNumber -cne $expectedMfaDeviceArn
  ) {
    throw "The source user must have exactly the reviewed MFA device $expectedMfaDeviceArn attached."
  }
}

function Get-ExactStackOrNull {
  param([string]$AwsCli, [string]$StackName)
  $arguments = Add-AwsTimeoutArguments -Arguments @(
    'cloudformation', 'describe-stacks',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $StackName,
    '--output', 'json'
  )
  $output = & $AwsCli @arguments 2>&1
  if ($LASTEXITCODE -eq 0) {
    $response = (($output | Out-String).Trim()) | ConvertFrom-Json -Depth 100
    if (@($response.Stacks).Count -ne 1) {
      throw "CloudFormation returned an unexpected Stack count for $StackName."
    }
    return @($response.Stacks)[0]
  }
  $errorText = ($output | Out-String)
  if ($errorText -match '(?i)(AccessDenied|Unauthorized|not authorized)') {
    throw "CloudFormation DescribeStacks for $StackName was denied; denial is never accepted as MISSING."
  }
  if (
    $errorText -notmatch '(?i)\(ValidationError\)' -or
    $errorText -notmatch '(?i)when calling the DescribeStacks operation' -or
    $errorText -notmatch "(?i)$([regex]::Escape($StackName)).*does not exist"
  ) {
    throw "Unable to determine exact Stack state for ${StackName}: $errorText"
  }
  return $null
}

function Assert-StackMissing {
  param([string]$AwsCli, [string]$StackName)
  if ($null -ne (Get-ExactStackOrNull -AwsCli $AwsCli -StackName $StackName)) {
    throw "Stack $StackName must be absent for this operation."
  }
  foreach ($read in @(
    @('GetTemplate', @(
      'cloudformation', 'get-template',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $StackName,
      '--template-stage', 'Original',
      '--no-cli-pager',
      '--output', 'json'
    )),
    @('ListStackResources', @(
      'cloudformation', 'list-stack-resources',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $StackName,
      '--no-paginate',
      '--no-cli-pager',
      '--output', 'json'
    ))
  )) {
    $operation = [string]$read[0]
    $arguments = Add-AwsTimeoutArguments -Arguments ([string[]]$read[1])
    $output = & $AwsCli @arguments 2>&1
    if ($LASTEXITCODE -eq 0) {
      throw "CloudFormation $operation unexpectedly found Stack $StackName."
    }
    $errorText = ($output | Out-String)
    if ($errorText -match '(?i)(AccessDenied|Unauthorized|not authorized)') {
      throw "CloudFormation $operation for $StackName was denied; denial is never accepted as MISSING."
    }
    if (
      $errorText -notmatch '(?i)\(ValidationError\)' -or
      $errorText -notmatch "(?i)when calling the $([regex]::Escape($operation)) operation" -or
      $errorText -notmatch "(?i)$([regex]::Escape($StackName)).*does not exist"
    ) {
      throw "Unable to prove exact MISSING state with CloudFormation $operation for ${StackName}: $errorText"
    }
  }
}

function Assert-IamLookupMissing {
  param([string]$AwsCli, [string[]]$Arguments, [string]$Label)
  $safeArguments = Add-AwsTimeoutArguments -Arguments $Arguments
  $output = & $AwsCli @safeArguments 2>&1
  if ($LASTEXITCODE -eq 0) {
    throw "$Label already exists outside the exact management Stack contract."
  }
  $errorText = ($output | Out-String)
  if ($errorText -notmatch '(?i)NoSuchEntity') {
    throw "Unable to prove $Label is absent: $errorText"
  }
}

function Assert-ManagementIamNamesMissing {
  param([string]$AwsCli)
  foreach ($roleName in @($operatorRoleName, $executionRoleName)) {
    Assert-IamLookupMissing -AwsCli $AwsCli -Label "IAM Role $roleName" -Arguments @(
      'iam', 'get-role',
      '--profile', $Profile,
      '--role-name', $roleName,
      '--output', 'json'
    )
  }
  foreach ($policyArn in @($operatorBoundaryArn, $executionBoundaryArn)) {
    Assert-IamLookupMissing -AwsCli $AwsCli -Label "IAM ManagedPolicy $policyArn" -Arguments @(
      'iam', 'get-policy',
      '--profile', $Profile,
      '--policy-arn', $policyArn,
      '--output', 'json'
    )
  }
}

function Assert-AuthorityAbsent {
  param([string]$AwsCli)
  $keyJson = ConvertTo-Json -InputObject @{
    authority_key = @{ S = $authorityKey }
  } -Compress
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'dynamodb', 'get-item',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--table-name', $authorityTableName,
    '--key', $keyJson,
    '--consistent-read',
    '--return-consumed-capacity', 'NONE',
    '--query', '{Item:Item}',
    '--output', 'json'
  )
  if ($null -ne $response.Item) {
    throw "Authority key $authorityKey must remain ABSENT."
  }
}

function Assert-InitialMissingState {
  param([string]$AwsCli)
  Assert-StackMissing -AwsCli $AwsCli -StackName $managementStackName
  Assert-StackMissing -AwsCli $AwsCli -StackName $cellStackName
  Assert-ManagementIamNamesMissing -AwsCli $AwsCli
  Assert-AuthorityAbsent -AwsCli $AwsCli
}

function ConvertTo-UniqueMap {
  param(
    [object[]]$Entries,
    [string]$KeyProperty,
    [string]$ValueProperty,
    [string]$Label
  )
  $map = @{}
  foreach ($entry in @($Entries)) {
    $key = [string]$entry.$KeyProperty
    if ([string]::IsNullOrEmpty($key) -or $map.ContainsKey($key)) {
      throw "$Label contains an empty or duplicate key."
    }
    $map[$key] = [string]$entry.$ValueProperty
  }
  return $map
}

function Assert-ExactMap {
  param([hashtable]$Actual, [hashtable]$Expected, [string]$Label)
  if ($Actual.Count -ne $Expected.Count) {
    throw "$Label count drifted."
  }
  foreach ($key in $Expected.Keys) {
    if (-not $Actual.ContainsKey($key) -or $Actual[$key] -cne $Expected[$key]) {
      throw "$Label value $key drifted."
    }
  }
}

function Get-ExpectedParameters {
  return @{
    ExpectedAccountId = $expectedAccountId
    ExpectedRegion = $expectedRegion
    ManagementPrincipalArn = $expectedPrincipalArn
  }
}

function Get-ExpectedStackTags {
  return @{
    Environment = 'aws-sandbox'
    ManagedBy = 'techlong-cell-lifecycle-manager'
    Component = 'b5-cell-lifecycle-management'
  }
}

function Assert-ExactGetTemplateResponse {
  param(
    [string]$AwsCli,
    [object]$Snapshot,
    [string]$ResponsePath,
    [string]$ChangeSetName = ''
  )
  $arguments = @(
    'cloudformation', 'get-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $managementStackName
  )
  if (-not [string]::IsNullOrEmpty($ChangeSetName)) {
    $arguments += @('--change-set-name', $ChangeSetName)
  }
  $arguments += @('--template-stage', 'Original', '--output', 'json')
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments $arguments -OutputPath $ResponsePath
  $verifiedHash = ((& node $templateVerifier `
    --expected-template $Snapshot.Path `
    --get-template-response $ResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verifiedHash -cne $Snapshot.CanonicalSha256) {
    throw 'CloudFormation TemplateBody is not the exact reviewed Locked management template.'
  }
}

function Assert-ReviewedChangeSet {
  param([object]$ChangeSet, [object]$Snapshot, [object]$Contract)
  if (
    [string]$ChangeSet.StackName -cne $managementStackName -or
    [string]$ChangeSet.ChangeSetName -cne $Contract.Name -or
    [string]$ChangeSet.ChangeSetId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-lifecycle-management-initial-locked-[a-f0-9]{16}/[0-9a-f-]{36}$' -or
    [string]$ChangeSet.StackId -cnotmatch $managementStackIdPattern -or
    (-not [string]::IsNullOrEmpty([string]$ChangeSet.ChangeSetType) -and
      [string]$ChangeSet.ChangeSetType -cne 'CREATE') -or
    [string]$ChangeSet.Status -cne 'CREATE_COMPLETE' -or
    [string]$ChangeSet.ExecutionStatus -cne 'AVAILABLE' -or
    [string]$ChangeSet.Description -cne $Contract.Description -or
    -not [string]::IsNullOrEmpty([string]$ChangeSet.RoleARN)
  ) {
    throw 'Change Set identity, state, description, type, or source-user RoleARN contract drifted.'
  }
  if (
    @($ChangeSet.NotificationARNs).Count -ne 0 -or
    -not [string]::IsNullOrEmpty([string]$ChangeSet.ParentChangeSetId) -or
    -not [string]::IsNullOrEmpty([string]$ChangeSet.RootChangeSetId) -or
    $ChangeSet.IncludeNestedStacks -eq $true -or
    $ChangeSet.ImportExistingResources -eq $true -or
    @($ChangeSet.Capabilities).Count -ne 1 -or
    [string]@($ChangeSet.Capabilities)[0] -cne 'CAPABILITY_NAMED_IAM' -or
    [string]$ChangeSet.OnStackFailure -cne 'DELETE'
  ) {
    throw 'Change Set nested/import/notification/capability/on-failure metadata drifted.'
  }
  $rollbackProperties = @(
    $ChangeSet.PSObject.Properties |
      Where-Object { [string]$_.Name -ceq 'RollbackConfiguration' }
  )
  if ($rollbackProperties.Count -ne 1 -or $null -eq $rollbackProperties[0].Value) {
    throw 'Change Set RollbackConfiguration must be present as the exact empty object.'
  }
  Assert-ExactJsonObject `
    -Actual $rollbackProperties[0].Value `
    -Expected ([PSCustomObject]@{}) `
    -Label 'Change Set RollbackConfiguration'
  if ($null -ne $ChangeSet.DeploymentConfig) {
    if (
      [string]$ChangeSet.DeploymentConfig.Mode -cne 'STANDARD' -or
      $ChangeSet.DeploymentConfig.DisableRollback -ne $false
    ) {
      throw 'Change Set deployment mode or rollback behavior drifted.'
    }
  }
  $parameters = ConvertTo-UniqueMap `
    -Entries @($ChangeSet.Parameters) `
    -KeyProperty 'ParameterKey' `
    -ValueProperty 'ParameterValue' `
    -Label 'Change Set parameter'
  Assert-ExactMap -Actual $parameters -Expected (Get-ExpectedParameters) -Label 'Change Set parameter'
  $tags = ConvertTo-UniqueMap `
    -Entries @($ChangeSet.Tags) `
    -KeyProperty 'Key' `
    -ValueProperty 'Value' `
    -Label 'Change Set tag'
  Assert-ExactMap -Actual $tags -Expected (Get-ExpectedStackTags) -Label 'Change Set tag'
  $expectedResources = @{
    CellOperatorBoundary = 'AWS::IAM::ManagedPolicy'
    CellOperatorRole = 'AWS::IAM::Role'
    CellCloudFormationExecutionBoundary = 'AWS::IAM::ManagedPolicy'
    CellCloudFormationExecutionRole = 'AWS::IAM::Role'
  }
  $changes = @($ChangeSet.Changes)
  if ($changes.Count -ne $expectedResources.Count) {
    throw 'Change Set resource-change count is not the exact four-resource Locked shape.'
  }
  $seen = @{}
  foreach ($entry in $changes) {
    $change = $entry.ResourceChange
    $logicalId = [string]$change.LogicalResourceId
    if (-not $expectedResources.ContainsKey($logicalId) -or $seen.ContainsKey($logicalId)) {
      throw "Change Set contains unexpected or duplicate logical resource $logicalId."
    }
    $seen[$logicalId] = $true
    if (
      [string]$change.Action -cne 'Add' -or
      [string]$change.ResourceType -cne $expectedResources[$logicalId] -or
      [string]$change.Replacement -notin @('', 'False') -or
      @($change.Scope).Count -ne 0 -or
      @($change.Details).Count -ne 0
    ) {
      throw "Change Set resource contract drifted for $logicalId."
    }
  }
}

function Get-ReviewedChangeSet {
  param(
    [string]$AwsCli,
    [object]$Snapshot,
    [object]$Contract,
    [string]$TemplateResponsePath
  )
  $changeSet = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'describe-change-set',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $managementStackName,
    '--change-set-name', $Contract.Name,
    '--output', 'json'
  )
  Assert-ReviewedChangeSet -ChangeSet $changeSet -Snapshot $Snapshot -Contract $Contract
  Assert-ExactGetTemplateResponse `
    -AwsCli $AwsCli `
    -Snapshot $Snapshot `
    -ResponsePath $TemplateResponsePath `
    -ChangeSetName $Contract.Name
  return $changeSet
}

function Assert-PreExecutionState {
  param([string]$AwsCli)
  $stack = Get-ExactStackOrNull -AwsCli $AwsCli -StackName $managementStackName
  if (
    $null -eq $stack -or
    [string]$stack.StackName -cne $managementStackName -or
    [string]$stack.StackId -cnotmatch $managementStackIdPattern -or
    [string]$stack.StackStatus -cne 'REVIEW_IN_PROGRESS' -or
    -not [string]::IsNullOrEmpty([string]$stack.RoleARN) -or
    $stack.EnableTerminationProtection -eq $true -or
    -not [string]::IsNullOrEmpty([string]$stack.ParentId) -or
    -not [string]::IsNullOrEmpty([string]$stack.RootId)
  ) {
    throw 'InitialLocked management Stack must be the exact top-level REVIEW_IN_PROGRESS placeholder.'
  }
  Assert-StackMissing -AwsCli $AwsCli -StackName $cellStackName
  Assert-ManagementIamNamesMissing -AwsCli $AwsCli
  Assert-AuthorityAbsent -AwsCli $AwsCli
  return $stack
}

function Assert-WriteAcknowledgements {
  param(
    [object]$Snapshot,
    [object]$Contract,
    [bool]$Executing,
    [object]$ChangeSet = $null
  )
  if ($ConfirmAccountId -cne $expectedAccountId) {
    throw "AWS write requires -ConfirmAccountId $expectedAccountId."
  }
  if ($ConfirmRegion -cne $expectedRegion) {
    throw "AWS write requires -ConfirmRegion $expectedRegion."
  }
  if ($ConfirmManagementStackName -cne $managementStackName) {
    throw "AWS write requires -ConfirmManagementStackName $managementStackName."
  }
  if ($ConfirmTemplateSha256 -cne $Snapshot.RawSha256) {
    throw "AWS write requires -ConfirmTemplateSha256 $($Snapshot.RawSha256)."
  }
  if ($ConfirmTemplateCanonicalSha256 -cne $Snapshot.CanonicalSha256) {
    throw "AWS write requires -ConfirmTemplateCanonicalSha256 $($Snapshot.CanonicalSha256)."
  }
  if ($ConfirmChangeSetName -cne $Contract.Name) {
    throw "AWS write requires -ConfirmChangeSetName $($Contract.Name)."
  }
  foreach ($required in @(
    @{ Value = $AcknowledgeAwsWrite; Name = 'AcknowledgeAwsWrite' },
    @{ Value = $AcknowledgeCreatesNamedIam; Name = 'AcknowledgeCreatesNamedIam' },
    @{ Value = $AcknowledgeSourceUserBootstrapRisk; Name = 'AcknowledgeSourceUserBootstrapRisk' },
    @{ Value = $AcknowledgeMfaSession; Name = 'AcknowledgeMfaSession' },
    @{ Value = $AcknowledgeLockedIamOnly; Name = 'AcknowledgeLockedIamOnly' }
  )) {
    if (-not $required.Value) { throw "AWS write requires -$($required.Name)." }
  }
  $expectedPhrase = if ($Executing) { $executePhrase } else { $createPhrase }
  if ($ConfirmExecutionPhrase -cne $expectedPhrase) {
    throw "AWS write requires -ConfirmExecutionPhrase $expectedPhrase."
  }
  if ($Executing) {
    if (-not $AcknowledgeChangeSetReviewed) {
      throw 'ExecuteChangeSet requires -AcknowledgeChangeSetReviewed after a separate exact InspectChangeSet command.'
    }
    if (
      $null -eq $ChangeSet -or
      $ConfirmChangeSetArn -cne [string]$ChangeSet.ChangeSetId -or
      $ConfirmStackId -cne [string]$ChangeSet.StackId
    ) {
      throw 'ExecuteChangeSet requires the exact reviewed -ConfirmChangeSetArn and -ConfirmStackId.'
    }
  } elseif (
    -not [string]::IsNullOrEmpty($ConfirmChangeSetArn) -or
    -not [string]::IsNullOrEmpty($ConfirmStackId) -or
    $AcknowledgeChangeSetReviewed
  ) {
    throw 'CreateChangeSet does not accept execute-only Change Set ARN, StackId, or review acknowledgement.'
  }
}

function ConvertFrom-ExactIamDocument {
  param([object]$Document, [string]$Label)
  if ($null -eq $Document) { throw "$Label is missing." }
  if ($Document -is [string]) {
    $decoded = [Uri]::UnescapeDataString([string]$Document)
    try {
      return ($decoded | ConvertFrom-Json -Depth 100)
    } catch {
      throw "$Label is not an exact JSON policy document."
    }
  }
  return $Document
}

function Get-CanonicalObjectHash {
  param([object]$Value, [string]$Label)
  if ($null -eq $Value) { throw "$Label is missing." }
  $path = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-b5j5ga-object-$([Guid]::NewGuid().ToString('N')).json"
  )
  try {
    $json = ConvertTo-Json -InputObject $Value -Compress -Depth 100
    [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
    return Get-CanonicalTemplateHash -TemplatePath $path
  } finally {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
}

function Assert-ExactJsonObject {
  param([object]$Actual, [object]$Expected, [string]$Label)
  $actualHash = Get-CanonicalObjectHash -Value $Actual -Label "$Label actual"
  $expectedHash = Get-CanonicalObjectHash -Value $Expected -Label "$Label expected"
  if ($actualHash -cne $expectedHash) { throw "$Label canonical document drifted." }
}

function Assert-IamResponseNotTruncated {
  param([object]$Response, [string]$Label)
  if (
    $Response.IsTruncated -eq $true -or
    -not [string]::IsNullOrEmpty([string]$Response.Marker)
  ) {
    throw "$Label unexpectedly returned a truncated IAM response."
  }
}

function Assert-ExactIamResourceTags {
  param(
    [object[]]$ActualTags,
    [object[]]$ExpectedBusinessTags,
    [string]$LogicalId,
    [string]$ExpectedStackId,
    [string]$Label
  )
  $actual = ConvertTo-UniqueMap `
    -Entries @($ActualTags) -KeyProperty 'Key' -ValueProperty 'Value' -Label "$Label tag"
  $expected = ConvertTo-UniqueMap `
    -Entries @($ExpectedBusinessTags) -KeyProperty 'Key' -ValueProperty 'Value' -Label "$Label expected tag"
  $actualBusiness = @{}
  foreach ($key in $actual.Keys) {
    if ($key -notmatch '^aws:') { $actualBusiness[$key] = $actual[$key] }
  }
  Assert-ExactMap -Actual $actualBusiness -Expected $expected -Label "$Label business tag"
  $allowedSystemTags = @{
    'aws:cloudformation:logical-id' = $LogicalId
    'aws:cloudformation:stack-id' = $ExpectedStackId
    'aws:cloudformation:stack-name' = $managementStackName
  }
  foreach ($key in $actual.Keys) {
    if ($key -notmatch '^aws:') { continue }
    if (
      -not $allowedSystemTags.ContainsKey($key) -or
      [string]$actual[$key] -cne [string]$allowedSystemTags[$key]
    ) {
      throw "$Label contains an unexpected AWS system tag $key."
    }
  }
}

function Assert-ExactPolicyEntities {
  param(
    [string]$AwsCli,
    [string]$PolicyArn,
    [string]$UsageFilter,
    [string]$ExpectedRoleName,
    [bool]$RoleExpected
  )
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-entities-for-policy',
    '--profile', $Profile,
    '--policy-arn', $PolicyArn,
    '--policy-usage-filter', $UsageFilter,
    '--no-paginate',
    '--output', 'json'
  )
  Assert-IamResponseNotTruncated -Response $response -Label "$PolicyArn $UsageFilter entities"
  $roles = @($response.PolicyRoles)
  $expectedCount = if ($RoleExpected) { 1 } else { 0 }
  if (
    @($response.PolicyGroups).Count -ne 0 -or
    @($response.PolicyUsers).Count -ne 0 -or
    $roles.Count -ne $expectedCount
  ) {
    throw "$PolicyArn $UsageFilter entities drifted."
  }
  if ($RoleExpected -and (
    [string]$roles[0].RoleName -cne $ExpectedRoleName -or
    [string]::IsNullOrEmpty([string]$roles[0].RoleId)
  )) {
    throw "$PolicyArn $UsageFilter is not bound to the exact reviewed role."
  }
}

function Assert-ExactManagedPolicyReadback {
  param(
    [string]$AwsCli,
    [object]$ExpectedResource,
    [string]$ExpectedPolicyArn,
    [string]$ExpectedRoleName,
    [bool]$AttachedAsIdentityPolicy
  )
  $expected = $ExpectedResource.Properties
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-policy',
    '--profile', $Profile,
    '--policy-arn', $ExpectedPolicyArn,
    '--output', 'json'
  )
  $policy = $response.Policy
  $expectedAttachmentCount = if ($AttachedAsIdentityPolicy) { 1 } else { 0 }
  if (
    [string]$policy.PolicyName -cne [string]$expected.ManagedPolicyName -or
    [string]$policy.Arn -cne $ExpectedPolicyArn -or
    [string]$policy.Path -cne '/' -or
    [string]$policy.DefaultVersionId -cne 'v1' -or
    $policy.IsAttachable -ne $true -or
    [int]$policy.AttachmentCount -ne $expectedAttachmentCount -or
    [int]$policy.PermissionsBoundaryUsageCount -ne 1 -or
    [string]$policy.Description -cne [string]$expected.Description
  ) {
    throw "Managed policy $ExpectedPolicyArn metadata, attachment, or boundary use drifted."
  }
  $versionsResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-policy-versions',
    '--profile', $Profile,
    '--policy-arn', $ExpectedPolicyArn,
    '--no-paginate',
    '--output', 'json'
  )
  Assert-IamResponseNotTruncated -Response $versionsResponse -Label "$ExpectedPolicyArn versions"
  $versions = @($versionsResponse.Versions)
  if (
    $versions.Count -ne 1 -or
    [string]$versions[0].VersionId -cne 'v1' -or
    $versions[0].IsDefaultVersion -ne $true
  ) {
    throw "Managed policy $ExpectedPolicyArn must have exactly its initial v1 version."
  }
  $version = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-policy-version',
    '--profile', $Profile,
    '--policy-arn', $ExpectedPolicyArn,
    '--version-id', 'v1',
    '--output', 'json'
  )
  if (
    [string]$version.PolicyVersion.VersionId -cne 'v1' -or
    $version.PolicyVersion.IsDefaultVersion -ne $true
  ) {
    throw "Managed policy $ExpectedPolicyArn v1 metadata drifted."
  }
  $document = ConvertFrom-ExactIamDocument `
    -Document $version.PolicyVersion.Document `
    -Label "$ExpectedPolicyArn v1"
  Assert-ExactJsonObject `
    -Actual $document `
    -Expected $expected.PolicyDocument `
    -Label "$ExpectedPolicyArn default policy"
  Assert-ExactPolicyEntities `
    -AwsCli $AwsCli `
    -PolicyArn $ExpectedPolicyArn `
    -UsageFilter 'PermissionsPolicy' `
    -ExpectedRoleName $ExpectedRoleName `
    -RoleExpected $AttachedAsIdentityPolicy
  Assert-ExactPolicyEntities `
    -AwsCli $AwsCli `
    -PolicyArn $ExpectedPolicyArn `
    -UsageFilter 'PermissionsBoundary' `
    -ExpectedRoleName $ExpectedRoleName `
    -RoleExpected $true
}

function Assert-ExactRoleReadback {
  param(
    [string]$AwsCli,
    [object]$ExpectedResource,
    [string]$ExpectedRoleArn,
    [string]$ExpectedBoundaryArn,
    [string]$ExpectedBoundaryName,
    [string]$LogicalId,
    [string]$ExpectedStackId,
    [bool]$BoundaryAttached
  )
  $expected = $ExpectedResource.Properties
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-role',
    '--profile', $Profile,
    '--role-name', ([string]$expected.RoleName),
    '--output', 'json'
  )
  $role = $response.Role
  if (
    [string]$role.RoleName -cne [string]$expected.RoleName -or
    [string]$role.Arn -cne $ExpectedRoleArn -or
    [string]$role.Path -cne '/' -or
    [string]$role.Description -cne [string]$expected.Description -or
    [int]$role.MaxSessionDuration -ne [int]$expected.MaxSessionDuration -or
    [string]$role.PermissionsBoundary.PermissionsBoundaryArn -cne $ExpectedBoundaryArn -or
    [string]$role.PermissionsBoundary.PermissionsBoundaryType -cne 'Policy'
  ) {
    throw "IAM Role $ExpectedRoleArn identity, boundary, or session contract drifted."
  }
  $trust = ConvertFrom-ExactIamDocument `
    -Document $role.AssumeRolePolicyDocument `
    -Label "$ExpectedRoleArn trust policy"
  $expectedTrust = (ConvertTo-Json -InputObject $expected.AssumeRolePolicyDocument -Compress -Depth 100) |
    ConvertFrom-Json -Depth 100
  if ([string]$expected.RoleName -ceq $operatorRoleName) {
    $expectedTrust.Statement[0].Principal.AWS = $expectedPrincipalArn
  }
  Assert-ExactJsonObject -Actual $trust -Expected $expectedTrust -Label "$ExpectedRoleArn trust policy"
  Assert-ExactIamResourceTags `
    -ActualTags @($role.Tags) `
    -ExpectedBusinessTags @($expected.Tags) `
    -LogicalId $LogicalId `
    -ExpectedStackId $ExpectedStackId `
    -Label $ExpectedRoleArn
  $attached = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-attached-role-policies',
    '--profile', $Profile,
    '--role-name', ([string]$expected.RoleName),
    '--no-paginate',
    '--output', 'json'
  )
  Assert-IamResponseNotTruncated -Response $attached -Label "$ExpectedRoleArn attached policies"
  $policies = @($attached.AttachedPolicies)
  $expectedCount = if ($BoundaryAttached) { 1 } else { 0 }
  if ($policies.Count -ne $expectedCount) {
    throw "IAM Role $ExpectedRoleArn attached-policy count drifted."
  }
  if ($BoundaryAttached -and (
    [string]$policies[0].PolicyArn -cne $ExpectedBoundaryArn -or
    [string]$policies[0].PolicyName -cne $ExpectedBoundaryName
  )) {
    throw "IAM Role $ExpectedRoleArn attached-policy contract drifted."
  }
  $inline = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-role-policies',
    '--profile', $Profile,
    '--role-name', ([string]$expected.RoleName),
    '--no-paginate',
    '--output', 'json'
  )
  Assert-IamResponseNotTruncated -Response $inline -Label "$ExpectedRoleArn inline policies"
  if (@($inline.PolicyNames).Count -ne 0) {
    throw "IAM Role $ExpectedRoleArn must have zero inline policies in Locked state."
  }
}

function Assert-ExactManagementIamReadback {
  param([string]$AwsCli, [object]$Snapshot, [string]$ExpectedStackId)
  $template = (Get-Content -LiteralPath $Snapshot.Path -Raw) | ConvertFrom-Json -Depth 100
  $resources = $template.Resources
  $contracts = @(
    [PSCustomObject]@{
      PolicyLogicalId = 'CellOperatorBoundary'; PolicyArn = $operatorBoundaryArn
      RoleLogicalId = 'CellOperatorRole'; RoleArn = $operatorRoleArn
      AttachedAsIdentityPolicy = $true
    },
    [PSCustomObject]@{
      PolicyLogicalId = 'CellCloudFormationExecutionBoundary'; PolicyArn = $executionBoundaryArn
      RoleLogicalId = 'CellCloudFormationExecutionRole'; RoleArn = $executionRoleArn
      AttachedAsIdentityPolicy = $false
    }
  )
  foreach ($entry in $contracts) {
    $policyResource = $resources.($entry.PolicyLogicalId)
    $roleResource = $resources.($entry.RoleLogicalId)
    if (
      [string]$policyResource.Type -cne 'AWS::IAM::ManagedPolicy' -or
      [string]$roleResource.Type -cne 'AWS::IAM::Role'
    ) {
      throw "Reviewed IAM logical resources for $($entry.PolicyLogicalId) drifted."
    }
    $policyName = [string]$policyResource.Properties.ManagedPolicyName
    Assert-ExactManagedPolicyReadback `
      -AwsCli $AwsCli `
      -ExpectedResource $policyResource `
      -ExpectedPolicyArn $entry.PolicyArn `
      -ExpectedRoleName ([string]$roleResource.Properties.RoleName) `
      -AttachedAsIdentityPolicy ([bool]$entry.AttachedAsIdentityPolicy)
    Assert-ExactRoleReadback `
      -AwsCli $AwsCli `
      -ExpectedResource $roleResource `
      -ExpectedRoleArn $entry.RoleArn `
      -ExpectedBoundaryArn $entry.PolicyArn `
      -ExpectedBoundaryName $policyName `
      -LogicalId $entry.RoleLogicalId `
      -ExpectedStackId $ExpectedStackId `
      -BoundaryAttached ([bool]$entry.AttachedAsIdentityPolicy)
  }
}

function Assert-ExactDeniedSimulation {
  param(
    [string]$AwsCli,
    [string]$RoleArn,
    [string]$Action,
    [string]$ResourceArn,
    [string[]]$AdditionalContextEntries = @()
  )
  $contextEntries = @(
    "ContextKeyName=aws:RequestedRegion,ContextKeyValues=$expectedRegion,ContextKeyType=string"
  ) + @($AdditionalContextEntries)
  $arguments = @(
    'iam', 'simulate-principal-policy',
    '--profile', $Profile,
    '--policy-source-arn', $RoleArn,
    '--action-names', $Action,
    '--resource-arns', $ResourceArn,
    '--context-entries'
  ) + $contextEntries + @(
    '--no-paginate',
    '--output', 'json'
  )
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments $arguments
  Assert-IamResponseNotTruncated -Response $response -Label "$RoleArn simulation"
  $results = @($response.EvaluationResults)
  if (
    $results.Count -ne 1 -or
    [string]$results[0].EvalActionName -cne $Action -or
    [string]$results[0].EvalResourceName -cne $ResourceArn -or
    [string]$results[0].EvalDecision -cne 'implicitDeny' -or
    @($results[0].MissingContextValues).Count -ne 0 -or
    $null -eq $results[0].PermissionsBoundaryDecisionDetail -or
    $results[0].PermissionsBoundaryDecisionDetail.AllowedByPermissionsBoundary -ne $false
  ) {
    throw "$RoleArn unexpectedly allows or cannot fully evaluate $Action on $ResourceArn."
  }
}

function Assert-ExactIamSimulation {
  param([string]$AwsCli)
  $simulatedCellStackArn =
    "arn:aws:cloudformation:$expectedRegion`:$expectedAccountId`:stack/$cellStackName/00000000-0000-0000-0000-000000000000"
  $operatorContextEntries = @(
    "ContextKeyName=cloudformation:ChangeSetName,ContextKeyValues=${cellStackName}-simulation,ContextKeyType=string"
  )
  foreach ($entry in @(
    @('cloudformation:CreateChangeSet', $simulatedCellStackArn),
    @('cloudformation:ExecuteChangeSet', $simulatedCellStackArn),
    @('cloudformation:DeleteStack', $simulatedCellStackArn),
    @('iam:PassRole', $executionRoleArn)
  )) {
    Assert-ExactDeniedSimulation `
      -AwsCli $AwsCli `
      -RoleArn $operatorRoleArn `
      -Action $entry[0] `
      -ResourceArn $entry[1] `
      -AdditionalContextEntries $operatorContextEntries
  }
  foreach ($entry in @(
    @('ec2:CreateVpc', '*'),
    @('ecs:CreateCluster', "arn:aws:ecs:$expectedRegion`:$expectedAccountId`:cluster/$cellId"),
    @('elasticloadbalancing:CreateLoadBalancer', "arn:aws:elasticloadbalancing:$expectedRegion`:$expectedAccountId`:loadbalancer/app/$cellStackName/0000000000000000"),
    @('rds:CreateDBCluster', "arn:aws:rds:$expectedRegion`:$expectedAccountId`:cluster:$cellStackName"),
    @('scheduler:CreateSchedule', "arn:aws:scheduler:$expectedRegion`:$expectedAccountId`:schedule/techlong-sandbox-cell/${cellStackName}-ttl"),
    @('logs:CreateLogGroup', "arn:aws:logs:$expectedRegion`:$expectedAccountId`:log-group:/aws/rds/cluster/$cellStackName/postgresql")
  )) {
    Assert-ExactDeniedSimulation `
      -AwsCli $AwsCli -RoleArn $executionRoleArn -Action $entry[0] -ResourceArn $entry[1]
  }
}

function Assert-ExactStackReadback {
  param([string]$AwsCli, [object]$Snapshot, [string]$TemplateResponsePath)
  $stack = Get-ExactStackOrNull -AwsCli $AwsCli -StackName $managementStackName
  if (
    $null -eq $stack -or
    [string]$stack.StackName -cne $managementStackName -or
    [string]$stack.StackId -cnotmatch $managementStackIdPattern -or
    [string]$stack.StackStatus -cne 'CREATE_COMPLETE' -or
    -not [string]::IsNullOrEmpty([string]$stack.RoleARN) -or
    $stack.EnableTerminationProtection -ne $false -or
    -not [string]::IsNullOrEmpty([string]$stack.ParentId) -or
    -not [string]::IsNullOrEmpty([string]$stack.RootId)
  ) {
    throw 'Management Stack identity, status, source-user RoleARN, or top-level protection contract drifted.'
  }
  $parameters = ConvertTo-UniqueMap `
    -Entries @($stack.Parameters) -KeyProperty 'ParameterKey' -ValueProperty 'ParameterValue' -Label 'Stack parameter'
  Assert-ExactMap -Actual $parameters -Expected (Get-ExpectedParameters) -Label 'Stack parameter'
  $tags = ConvertTo-UniqueMap `
    -Entries @($stack.Tags) -KeyProperty 'Key' -ValueProperty 'Value' -Label 'Stack tag'
  Assert-ExactMap -Actual $tags -Expected (Get-ExpectedStackTags) -Label 'Stack tag'
  $outputs = ConvertTo-UniqueMap `
    -Entries @($stack.Outputs) -KeyProperty 'OutputKey' -ValueProperty 'OutputValue' -Label 'Stack output'
  Assert-ExactMap -Actual $outputs -Expected @{
    CellOperatorRoleArn = $operatorRoleArn
    CellCloudFormationExecutionRoleArn = $executionRoleArn
    ApprovedManagementStackName = $managementStackName
    ApprovedCellStackName = $cellStackName
    SafetyState = 'LOCKED_IAM_MANAGEMENT_ROOT_APPLY_ENABLED_EXECUTION_NOT_APPROVED_NO_PAID_CELL'
  } -Label 'Stack output'
  if (
    @($stack.Capabilities).Count -ne 1 -or
    [string]@($stack.Capabilities)[0] -cne 'CAPABILITY_NAMED_IAM'
  ) {
    throw 'Management Stack capabilities drifted.'
  }
  $inventory = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stack-resources',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $managementStackName,
    '--output', 'json'
  )
  if (-not [string]::IsNullOrEmpty([string]$inventory.NextToken)) {
    throw 'Unexpected pagination in the four-resource management Stack inventory.'
  }
  $expectedResources = @{
    CellOperatorBoundary = @('AWS::IAM::ManagedPolicy', $operatorBoundaryArn)
    CellOperatorRole = @('AWS::IAM::Role', $operatorRoleName)
    CellCloudFormationExecutionBoundary = @('AWS::IAM::ManagedPolicy', $executionBoundaryArn)
    CellCloudFormationExecutionRole = @('AWS::IAM::Role', $executionRoleName)
  }
  $summaries = @($inventory.StackResourceSummaries)
  if ($summaries.Count -ne $expectedResources.Count) {
    throw 'Management Stack resource inventory count drifted.'
  }
  $seen = @{}
  foreach ($resource in $summaries) {
    $logicalId = [string]$resource.LogicalResourceId
    if (-not $expectedResources.ContainsKey($logicalId) -or $seen.ContainsKey($logicalId)) {
      throw "Unexpected or duplicate management Stack resource $logicalId."
    }
    $seen[$logicalId] = $true
    if (
      [string]$resource.ResourceType -cne $expectedResources[$logicalId][0] -or
      [string]$resource.PhysicalResourceId -cne $expectedResources[$logicalId][1] -or
      [string]$resource.ResourceStatus -cne 'CREATE_COMPLETE'
    ) {
      throw "Management Stack live resource $logicalId drifted."
    }
  }
  Assert-ExactGetTemplateResponse `
    -AwsCli $AwsCli -Snapshot $Snapshot -ResponsePath $TemplateResponsePath
  Assert-ExactManagementIamReadback `
    -AwsCli $AwsCli -Snapshot $Snapshot -ExpectedStackId ([string]$stack.StackId)
  Assert-ExactIamSimulation -AwsCli $AwsCli
  Assert-StackMissing -AwsCli $AwsCli -StackName $cellStackName
  Assert-AuthorityAbsent -AwsCli $AwsCli
  Write-Host "Strict Locked management Stack readback passed: $($stack.StackId)"
  return $stack
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found.' }
foreach ($requiredPath in @($renderer, $validator, $templateVerifier)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required J5g-a file was not found at $requiredPath."
  }
}

Write-Host 'Running local B5-J5g-a lifecycle IAM validation...'
& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'J5g-a Shared Cell lifecycle IAM local validation failed.'
}

$snapshot = $null
$templateResponsePath = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-cell-lifecycle-template-$([Guid]::NewGuid().ToString('N')).json"
)
$previousEnvironment = @{
  AWS_IGNORE_CONFIGURED_ENDPOINT_URLS = [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')
  AWS_PAGER = [Environment]::GetEnvironmentVariable('AWS_PAGER')
  AWS_CLI_AUTO_PROMPT = [Environment]::GetEnvironmentVariable('AWS_CLI_AUTO_PROMPT')
  AWS_MAX_ATTEMPTS = [Environment]::GetEnvironmentVariable('AWS_MAX_ATTEMPTS')
}

try {
  $snapshot = New-ReadOnlyTemplateSnapshot
  $contract = Get-ChangeSetContract -Snapshot $snapshot
  Write-Host "Update shape: $UpdateShape"
  Write-Host 'Rendered shape: Locked'
  Write-Host "Management Stack: $managementStackName"
  Write-Host "Template raw SHA-256: $($snapshot.RawSha256)"
  Write-Host "Template canonical SHA-256: $($snapshot.CanonicalSha256)"
  Write-Host "Template bytes: $($snapshot.Size)"
  Write-Host "Deterministic Change Set name: $($contract.Name)"

  if ($Mode -eq 'LocalValidate') {
    Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
    exit 0
  }
  if ($Profile -cnotmatch '^[A-Za-z0-9_-]{1,64}$') {
    throw 'AWS profile name contains unsupported characters.'
  }

  Assert-NoAwsEndpointOverrides
  [Environment]::SetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS', 'true')
  [Environment]::SetEnvironmentVariable('AWS_PAGER', '')
  [Environment]::SetEnvironmentVariable('AWS_CLI_AUTO_PROMPT', 'off')
  [Environment]::SetEnvironmentVariable('AWS_MAX_ATTEMPTS', '3')
  $awsCli = Resolve-AwsCli
  Assert-ExactSourceIdentity -AwsCli $awsCli
  Assert-SnapshotUnchanged -Snapshot $snapshot
  Invoke-AwsJson -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--template-body', "file://$($snapshot.Path)",
    '--output', 'json'
  ) | Out-Null

  if ($Mode -eq 'OnlineValidate') {
    Assert-InitialMissingState -AwsCli $awsCli
    Write-Host 'Online validation passed: management root MISSING, four IAM names MISSING, Cell MISSING, authority ABSENT.'
    Write-Host 'No Change Set, Stack, IAM resource, Shared Cell, or authority item was changed.'
    exit 0
  }

  if ($Mode -eq 'CreateChangeSet') {
    Assert-InitialMissingState -AwsCli $awsCli
    Assert-WriteAcknowledgements `
      -Snapshot $snapshot -Contract $contract -Executing $false
    Assert-SnapshotUnchanged -Snapshot $snapshot
    $parameters = @(
      "ParameterKey=ExpectedAccountId,ParameterValue=$expectedAccountId",
      "ParameterKey=ExpectedRegion,ParameterValue=$expectedRegion",
      "ParameterKey=ManagementPrincipalArn,ParameterValue=$expectedPrincipalArn"
    )
    $arguments = @(
      'cloudformation', 'create-change-set',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName,
      '--change-set-name', $contract.Name,
      '--change-set-type', 'CREATE',
      '--description', $contract.Description,
      '--template-body', "file://$($snapshot.Path)",
      '--capabilities', 'CAPABILITY_NAMED_IAM',
      '--parameters'
    ) + $parameters + @(
      '--tags',
      'Key=Environment,Value=aws-sandbox',
      'Key=ManagedBy,Value=techlong-cell-lifecycle-manager',
      'Key=Component,Value=b5-cell-lifecycle-management',
      '--no-include-nested-stacks',
      '--on-stack-failure', 'DELETE',
      '--client-token', $contract.ClientToken,
      '--output', 'json'
    )
    Invoke-AwsJson -AwsCli $awsCli -Arguments $arguments | Out-Null
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', 'change-set-create-complete',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName,
      '--change-set-name', $contract.Name
    )
    $changeSet = Get-ReviewedChangeSet `
      -AwsCli $awsCli -Snapshot $snapshot -Contract $contract -TemplateResponsePath $templateResponsePath
    Write-Host "Created and exact-checked Change Set $($changeSet.ChangeSetId), but did NOT execute it."
    Write-Host "REVIEW_IN_PROGRESS StackId: $($changeSet.StackId)"
    Write-Host 'Run InspectChangeSet separately before requesting ExecuteChangeSet approval.'
    exit 0
  }

  if ($Mode -in @('InspectChangeSet', 'ExecuteChangeSet')) {
    $placeholder = Assert-PreExecutionState -AwsCli $awsCli
    $changeSet = Get-ReviewedChangeSet `
      -AwsCli $awsCli -Snapshot $snapshot -Contract $contract -TemplateResponsePath $templateResponsePath
    if ([string]$changeSet.StackId -cne [string]$placeholder.StackId) {
      throw 'Change Set StackId does not match the exact REVIEW_IN_PROGRESS placeholder.'
    }
    if ($Mode -eq 'InspectChangeSet') {
      Write-Host "Change Set ARN: $($changeSet.ChangeSetId)"
      Write-Host "StackId: $($changeSet.StackId)"
      @($changeSet.Changes) | ForEach-Object {
        [PSCustomObject]@{
          Action = $_.ResourceChange.Action
          LogicalId = $_.ResourceChange.LogicalResourceId
          ResourceType = $_.ResourceChange.ResourceType
          Replacement = $_.ResourceChange.Replacement
        }
      } | Format-Table -AutoSize
      Write-Host 'Inspection passed and was read-only. No Change Set was executed.'
      exit 0
    }
    Assert-WriteAcknowledgements `
      -Snapshot $snapshot `
      -Contract $contract `
      -Executing $true `
      -ChangeSet $changeSet
    Assert-SnapshotUnchanged -Snapshot $snapshot
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'execute-change-set',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName,
      '--change-set-name', ([string]$changeSet.ChangeSetId),
      '--client-request-token', "execute-$($contract.ClientToken)"
    )
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', 'stack-create-complete',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName
    )
    Assert-ExactStackReadback `
      -AwsCli $awsCli -Snapshot $snapshot -TemplateResponsePath $templateResponsePath | Out-Null
    Write-Host 'Executed InitialLocked and strictly read back exactly four Locked IAM resources.'
    Write-Host 'No Shared Cell, VPC, ALB, ECS, RDS/Aurora, Route53, Schedule, or authority item was created.'
    exit 0
  }

  if ($Mode -eq 'Readback') {
    Assert-ExactStackReadback `
      -AwsCli $awsCli -Snapshot $snapshot -TemplateResponsePath $templateResponsePath | Out-Null
    Write-Host 'Readback passed for exact InitialLocked IAM management root.'
    exit 0
  }

  throw "Unsupported mode $Mode."
} finally {
  Remove-TemplateSnapshot -Snapshot $snapshot
  if (Test-Path -LiteralPath $templateResponsePath) {
    Remove-Item -LiteralPath $templateResponsePath -Force
  }
  foreach ($entry in $previousEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value)
  }
}
