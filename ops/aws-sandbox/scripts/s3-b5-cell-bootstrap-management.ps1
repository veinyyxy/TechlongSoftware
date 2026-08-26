[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet', 'Readback', 'Delete')]
  [string]$Mode = 'LocalValidate',
  [ValidateSet(
    'InitialLocked',
    'BootstrapAuthorGrant',
    'BootstrapAuthorRevoke',
    'BootstrapExecuteGrant',
    'BootstrapExecuteRevoke',
    'BootstrapRollbackGrant',
    'BootstrapRollbackRevoke'
  )]
  [string]$UpdateShape = 'InitialLocked',
  [string]$Profile = 'techlong-sandbox-user',
  [string]$ApprovedChangeSetName = '',
  [string]$GrantExpiresAt = '',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmRegion = '',
  [string]$ConfirmManagementStackName = '',
  [string]$ConfirmStackId = '',
  [string]$ConfirmTemplateSha256 = '',
  [string]$ConfirmTemplateCanonicalSha256 = '',
  [string]$ConfirmExecutionPhrase = '',
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeCreatesNamedIam,
  [switch]$AcknowledgeSourceUserBootstrapRisk,
  [switch]$AcknowledgeMfaSession,
  [switch]$AcknowledgeLowCostNotFree,
  [switch]$AcknowledgeChangeSetReviewed,
  [switch]$AcknowledgeManagementRootDeletion
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$expectedUserName = 'techlong-sandbox-dev'
$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa/techlong-sandbox-dev'
$managementStackName = 'techlong-s3-b5-cell-bootstrap-management'
$childBootstrapStackName = 'techlong-s3-b5-cell-bootstrap'
$expectedManagerRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellBootstrapManagerRole'
$expectedExecutionRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellBootstrapCloudFormationExecutionRole'
$expectedManagerBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellBootstrapManagerBoundary'
$expectedExecutionBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellBootstrapCloudFormationExecutionBoundary'
$expectedJanitorBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellJanitorBoundary'
$expectedSchedulerBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellSchedulerInvokeBoundary'
$expectedJanitorRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole'
$expectedSchedulerRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole'
$childTemplateBucketName = 'techlong-sandbox-build-source-402010193138-ca-central-1'
$childTemplateObjectKeyPrefix = 'b5-cell-bootstrap/templates/sha256'
$childTemplateResourceTypes = @(
  'AWS::Logs::LogGroup',
  'AWS::Lambda::Function',
  'AWS::Scheduler::ScheduleGroup',
  'AWS::Scheduler::Schedule'
)
$managementStackIdPattern = '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap-management/[0-9a-f-]{36}$'
$bootstrapStackIdPattern = '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/[0-9a-f-]{36}$'
$childChangeSetNamePattern = '^techlong-s3-b5-cell-bootstrap-[a-f0-9]{16}$'
$grantExpiryPattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
$writePhrase = 'I_ACKNOWLEDGE_B5_CELL_BOOTSTRAP_MANAGEMENT_IAM_CHANGES'
$deletePhrase = 'I_ACKNOWLEDGE_B5_CELL_BOOTSTRAP_MANAGEMENT_DELETE'
$root = Split-Path -Parent $PSScriptRoot
$renderer = Join-Path $root 'scripts\render-b5-cell-bootstrap-management.mjs'
$childRenderer = Join-Path $root 'scripts\render-b5-cell-bootstrap.mjs'
$childValidator = Join-Path $root 'scripts\validate-b5-cell-bootstrap.mjs'
$validator = Join-Path $root 'scripts\validate-b5-cell-bootstrap-management.mjs'
$templateVerifier = Join-Path $root 'scripts\verify-change-set-template.mjs'

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
  return ($json | ConvertFrom-Json)
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

function Get-ShapeContract {
  switch ($UpdateShape) {
    'InitialLocked' {
      return [PSCustomObject]@{
        TargetRendererShape = 'Locked'
        PreviousRendererShape = 'Missing'
        ChangeSetType = 'CREATE'
        ShapeToken = 'initial-locked'
        ExpectedAction = 'Add'
        TargetLocked = $true
      }
    }
    'BootstrapAuthorGrant' {
      return [PSCustomObject]@{
        TargetRendererShape = 'AuthorGrant'
        PreviousRendererShape = 'Locked'
        ChangeSetType = 'UPDATE'
        ShapeToken = 'bootstrap-author-grant'
        ExpectedAction = 'Modify'
        TargetLocked = $false
      }
    }
    'BootstrapAuthorRevoke' {
      return [PSCustomObject]@{
        TargetRendererShape = 'Locked'
        PreviousRendererShape = 'AuthorGrant'
        ChangeSetType = 'UPDATE'
        ShapeToken = 'bootstrap-author-revoke'
        ExpectedAction = 'Modify'
        TargetLocked = $true
      }
    }
    'BootstrapExecuteGrant' {
      return [PSCustomObject]@{
        TargetRendererShape = 'ExecuteGrant'
        PreviousRendererShape = 'Locked'
        ChangeSetType = 'UPDATE'
        ShapeToken = 'bootstrap-execute-grant'
        ExpectedAction = 'Modify'
        TargetLocked = $false
      }
    }
    'BootstrapExecuteRevoke' {
      return [PSCustomObject]@{
        TargetRendererShape = 'Locked'
        PreviousRendererShape = 'ExecuteGrant'
        ChangeSetType = 'UPDATE'
        ShapeToken = 'bootstrap-execute-revoke'
        ExpectedAction = 'Modify'
        TargetLocked = $true
      }
    }
    'BootstrapRollbackGrant' {
      return [PSCustomObject]@{
        TargetRendererShape = 'RollbackGrant'
        PreviousRendererShape = 'Locked'
        ChangeSetType = 'UPDATE'
        ShapeToken = 'bootstrap-rollback-grant'
        ExpectedAction = 'Modify'
        TargetLocked = $false
      }
    }
    'BootstrapRollbackRevoke' {
      return [PSCustomObject]@{
        TargetRendererShape = 'Locked'
        PreviousRendererShape = 'RollbackGrant'
        ChangeSetType = 'UPDATE'
        ShapeToken = 'bootstrap-rollback-revoke'
        ExpectedAction = 'Modify'
        TargetLocked = $true
      }
    }
    default { throw "Unsupported management UpdateShape $UpdateShape." }
  }
}

function ConvertFrom-CanonicalGrantExpiry {
  param([string]$Value)
  if ($Value -cnotmatch $grantExpiryPattern) {
    throw '-GrantExpiresAt must be canonical UTC with milliseconds.'
  }
  $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
    [System.Globalization.DateTimeStyles]::AdjustToUniversal
  $parsed = [DateTime]::ParseExact(
    $Value,
    'yyyy-MM-ddTHH:mm:ss.fffZ',
    [System.Globalization.CultureInfo]::InvariantCulture,
    $styles
  )
  if ($parsed.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') -cne $Value) {
    throw '-GrantExpiresAt is not a canonical UTC instant.'
  }
  return $parsed
}

function Assert-ShapeInputs {
  param([object]$Contract, [object]$ChildSnapshot)
  $requiresApprovedName = $UpdateShape -in @(
    'BootstrapAuthorGrant',
    'BootstrapAuthorRevoke',
    'BootstrapExecuteGrant',
    'BootstrapExecuteRevoke'
  )
  $requiresExpiry = $UpdateShape -ne 'InitialLocked'
  if ($requiresApprovedName) {
    $expectedName = "techlong-s3-b5-cell-bootstrap-$($ChildSnapshot.RawSha256.Substring(0, 16))"
    if (
      $ApprovedChangeSetName -cnotmatch $childChangeSetNamePattern -or
      $ApprovedChangeSetName -cne $expectedName
    ) {
      throw "-ApprovedChangeSetName must be the exact child-template digest-bound name $expectedName."
    }
  } elseif (-not [string]::IsNullOrEmpty($ApprovedChangeSetName)) {
    throw "$UpdateShape does not accept -ApprovedChangeSetName."
  }
  if ($requiresExpiry) {
    $expiry = ConvertFrom-CanonicalGrantExpiry -Value $GrantExpiresAt
    $isGrant = $UpdateShape -in @(
      'BootstrapAuthorGrant',
      'BootstrapExecuteGrant',
      'BootstrapRollbackGrant'
    )
    if ($isGrant -and $Mode -in @('OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet')) {
      $remaining = $expiry - [DateTime]::UtcNow
      if ($remaining.TotalSeconds -le 120 -or $remaining.TotalMinutes -gt 60) {
        throw 'A new temporary grant must expire more than 2 minutes and no more than 60 minutes from now.'
      }
    }
  } elseif (-not [string]::IsNullOrEmpty($GrantExpiresAt)) {
    throw 'InitialLocked does not accept -GrantExpiresAt.'
  }
  if ($Mode -eq 'Delete' -and -not $Contract.TargetLocked) {
    throw 'Delete requires -UpdateShape InitialLocked and an exact deployed Locked template.'
  }
}

function Get-ChildTemplateObjectKey {
  param([object]$ChildSnapshot)
  return "$childTemplateObjectKeyPrefix/$($ChildSnapshot.RawSha256).json"
}

function Get-ChildTemplateUrl {
  param([object]$ChildSnapshot)
  $key = Get-ChildTemplateObjectKey -ChildSnapshot $ChildSnapshot
  return "https://$childTemplateBucketName.s3.$expectedRegion.amazonaws.com/$key"
}

function Get-ChildChangeSetName {
  param([object]$ChildSnapshot)
  return "techlong-s3-b5-cell-bootstrap-$($ChildSnapshot.RawSha256.Substring(0, 16))"
}

function New-ReadOnlyChildTemplateSnapshot {
  $path = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-s3-b5-cell-bootstrap-$([Guid]::NewGuid().ToString('N')).json"
  )
  $renderOutput = ((& node $childRenderer --output $path) | Out-String).Trim()
  if (
    $LASTEXITCODE -ne 0 -or
    [string]::IsNullOrWhiteSpace($renderOutput) -or
    -not (Test-Path -LiteralPath $path -PathType Leaf)
  ) {
    throw 'Unable to render the child B5 Cell Bootstrap template snapshot.'
  }
  $validationOutput = ((& node $childValidator --template $path) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($validationOutput)) {
    throw 'Rendered child B5 Cell Bootstrap template validation failed.'
  }
  $item = Get-Item -LiteralPath $path
  if ($item.Length -le 0 -or $item.Length -gt 51200) {
    throw 'Rendered child B5 Cell Bootstrap template size is outside the direct-body limit.'
  }
  $item.IsReadOnly = $true
  $canonicalHash = Get-CanonicalTemplateHash -TemplatePath $path
  return [PSCustomObject]@{
    Path = $path
    RawSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    CanonicalSha256 = $canonicalHash
    Size = [long]$item.Length
  }
}

function New-ReadOnlyTemplateSnapshot {
  param(
    [string]$RendererShape,
    [bool]$UseGrantInputs,
    [string]$ApprovedTemplateSha256
  )
  $path = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-s3-b5-cell-bootstrap-management-$([Guid]::NewGuid().ToString('N')).json"
  )
  $arguments = @(
    $renderer,
    '--shape', $RendererShape,
    '--output', $path
  )
  if ($UseGrantInputs) {
    if ($RendererShape -ne 'RollbackGrant') {
      $arguments += @('--approved-change-set-name', $ApprovedChangeSetName)
    }
    if ($RendererShape -in @('AuthorGrant', 'ExecuteGrant')) {
      if ($ApprovedTemplateSha256 -cnotmatch '^[a-f0-9]{64}$') {
        throw "$RendererShape requires the exact approved child template SHA-256."
      }
      $arguments += @('--approved-template-sha256', $ApprovedTemplateSha256)
    }
    $arguments += @('--grant-expires-at', $GrantExpiresAt)
  }
  $renderOutput = ((& node @arguments) | Out-String).Trim()
  if (
    $LASTEXITCODE -ne 0 -or
    [string]::IsNullOrWhiteSpace($renderOutput) -or
    -not (Test-Path -LiteralPath $path -PathType Leaf)
  ) {
    throw "Unable to render the $RendererShape management template snapshot."
  }
  $item = Get-Item -LiteralPath $path
  $item.IsReadOnly = $true
  $rawHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $canonicalHash = Get-CanonicalTemplateHash -TemplatePath $path
  return [PSCustomObject]@{
    Path = $path
    RawSha256 = $rawHash
    CanonicalSha256 = $canonicalHash
    RendererShape = $RendererShape
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
  $rawHash = (Get-FileHash -LiteralPath $Snapshot.Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $canonicalHash = Get-CanonicalTemplateHash -TemplatePath $Snapshot.Path
  if (
    $rawHash -cne $Snapshot.RawSha256 -or
    $canonicalHash -cne $Snapshot.CanonicalSha256 -or
    -not (Get-Item -LiteralPath $Snapshot.Path).IsReadOnly
  ) {
    throw 'The immutable management template snapshot changed after rendering.'
  }
}

function Assert-TemplateConfirmations {
  param([object]$Snapshot)
  if ($ConfirmTemplateSha256 -cne $Snapshot.RawSha256) {
    throw "AWS write requires -ConfirmTemplateSha256 $($Snapshot.RawSha256)."
  }
  if ($ConfirmTemplateCanonicalSha256 -cne $Snapshot.CanonicalSha256) {
    throw "AWS write requires -ConfirmTemplateCanonicalSha256 $($Snapshot.CanonicalSha256)."
  }
}

function Assert-WriteAcknowledgements {
  param([object]$Snapshot, [bool]$Deleting)
  if ($ConfirmAccountId -cne $expectedAccountId) {
    throw "AWS write requires -ConfirmAccountId $expectedAccountId."
  }
  if ($ConfirmRegion -cne $expectedRegion) {
    throw "AWS write requires -ConfirmRegion $expectedRegion."
  }
  if ($ConfirmManagementStackName -cne $managementStackName) {
    throw "AWS write requires -ConfirmManagementStackName $managementStackName."
  }
  Assert-TemplateConfirmations -Snapshot $Snapshot
  if (-not $AcknowledgeAwsWrite) {
    throw 'AWS write requires -AcknowledgeAwsWrite.'
  }
  if (-not $AcknowledgeCreatesNamedIam) {
    throw 'AWS write requires -AcknowledgeCreatesNamedIam.'
  }
  if (-not $AcknowledgeSourceUserBootstrapRisk) {
    throw 'AWS write requires -AcknowledgeSourceUserBootstrapRisk.'
  }
  if (-not $AcknowledgeMfaSession) {
    throw 'AWS write requires -AcknowledgeMfaSession after the script verifies login_session and the exact MFA device.'
  }
  $expectedPhrase = if ($Deleting) { $deletePhrase } else { $writePhrase }
  if ($ConfirmExecutionPhrase -cne $expectedPhrase) {
    throw "AWS write requires -ConfirmExecutionPhrase $expectedPhrase."
  }
  if ($Deleting -and -not $AcknowledgeManagementRootDeletion) {
    throw 'Delete requires -AcknowledgeManagementRootDeletion.'
  }
}

function Assert-ExactSourceLoginSession {
  param([string]$AwsCli)
  foreach ($credentialVariable in @(
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'
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
  $candidateSections = @('default', "profile $Profile", $Profile)
  foreach ($candidate in $candidateSections) {
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

function Assert-ExactMfaDevice {
  param([string]$AwsCli)
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-mfa-devices',
    '--profile', $Profile,
    '--user-name', $expectedUserName,
    '--output', 'json'
  )
  $devices = @($response.MFADevices)
  if (
    $devices.Count -ne 1 -or
    [string]$devices[0].UserName -cne $expectedUserName -or
    [string]$devices[0].SerialNumber -cne $expectedMfaDeviceArn
  ) {
    throw "The source user must have exactly the reviewed MFA device $expectedMfaDeviceArn attached."
  }
}

function Assert-ExactSourceIdentity {
  param([string]$AwsCli)
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
  Assert-ExactMfaDevice -AwsCli $AwsCli
  $configuredRegion = ((& $AwsCli configure get region --profile $Profile) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $configuredRegion -cne $expectedRegion) {
    throw "Refusing AWS access: profile region must be $expectedRegion."
  }
}

function Get-ExactStackOrNull {
  param([string]$AwsCli, [string]$StackName)
  $output = & $AwsCli cloudformation describe-stacks `
    --profile $Profile `
    --region $expectedRegion `
    --stack-name $StackName `
    --output json 2>&1
  if ($LASTEXITCODE -eq 0) {
    $response = (($output | Out-String).Trim()) | ConvertFrom-Json
    if (@($response.Stacks).Count -ne 1) {
      throw "CloudFormation returned an unexpected Stack count for $StackName."
    }
    return @($response.Stacks)[0]
  }
  $errorText = ($output | Out-String)
  if ($errorText -notmatch '(?i)does not exist') {
    throw "Unable to determine exact Stack state for ${StackName}: $errorText"
  }
  return $null
}

function Assert-StackMissing {
  param([string]$AwsCli, [string]$StackName)
  $stack = Get-ExactStackOrNull -AwsCli $AwsCli -StackName $StackName
  if ($null -ne $stack) {
    throw "Stack $StackName must be absent for this operation."
  }
}

function Assert-IamLookupMissing {
  param(
    [string]$AwsCli,
    [string[]]$Arguments,
    [string]$Label
  )
  $output = & $AwsCli @Arguments 2>&1
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
  foreach ($roleName in @(
    'TechlongSandboxCellBootstrapManagerRole',
    'TechlongSandboxCellBootstrapCloudFormationExecutionRole',
    'TechlongSandboxCellJanitorExecutionRole',
    'TechlongSandboxCellSchedulerInvokeRole'
  )) {
    Assert-IamLookupMissing -AwsCli $AwsCli -Label "IAM Role $roleName" -Arguments @(
      'iam', 'get-role',
      '--profile', $Profile,
      '--role-name', $roleName,
      '--output', 'json'
    )
  }
  foreach ($policyArn in @(
    $expectedManagerBoundaryArn,
    $expectedExecutionBoundaryArn,
    $expectedJanitorBoundaryArn,
    $expectedSchedulerBoundaryArn
  )) {
    Assert-IamLookupMissing -AwsCli $AwsCli -Label "IAM ManagedPolicy $policyArn" -Arguments @(
      'iam', 'get-policy',
      '--profile', $Profile,
      '--policy-arn', $policyArn,
      '--output', 'json'
    )
  }
}

function Assert-LegacyCellIamNamesMissing {
  param([string]$AwsCli)
  foreach ($roleName in @(
    'TechlongSandboxCellOperatorRole',
    'TechlongSandboxCellCloudFormationExecutionRole'
  )) {
    Assert-IamLookupMissing -AwsCli $AwsCli -Label "legacy IAM Role $roleName" -Arguments @(
      'iam', 'get-role',
      '--profile', $Profile,
      '--role-name', $roleName,
      '--output', 'json'
    )
  }
  foreach ($policyName in @(
    'TechlongSandboxCellOperatorBoundary',
    'TechlongSandboxCellCloudFormationExecutionBoundary'
  )) {
    $policyArn = "arn:aws:iam::$expectedAccountId`:policy/$policyName"
    Assert-IamLookupMissing -AwsCli $AwsCli -Label "legacy IAM ManagedPolicy $policyArn" -Arguments @(
      'iam', 'get-policy',
      '--profile', $Profile,
      '--policy-arn', $policyArn,
      '--output', 'json'
    )
  }
}

function Assert-AwsLookupMissing {
  param(
    [string]$AwsCli,
    [string[]]$Arguments,
    [string]$Label
  )
  $output = & $AwsCli @Arguments 2>&1
  if ($LASTEXITCODE -eq 0) {
    throw "$Label still exists outside the absent child Bootstrap Stack contract."
  }
  $errorText = ($output | Out-String)
  if ($errorText -notmatch '(?i)(ResourceNotFoundException|not found|does not exist)') {
    throw "Unable to prove $Label is absent: $errorText"
  }
}

function Assert-ChildBootstrapRuntimeNamesMissing {
  param([string]$AwsCli)
  Assert-AwsLookupMissing -AwsCli $AwsCli -Label 'Cell Janitor Lambda function' -Arguments @(
    'lambda', 'get-function',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--function-name', 'techlong-sandbox-cell-janitor',
    '--output', 'json'
  )
  $logs = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-log-groups',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--log-group-name-prefix', '/aws/lambda/techlong-sandbox-cell-janitor',
    '--no-paginate',
    '--output', 'json'
  )
  if (
    -not [string]::IsNullOrEmpty([string]$logs.nextToken) -or
    @($logs.logGroups).Count -ne 0
  ) {
    throw 'The exact Cell Janitor LogGroup prefix must be absent with the child Bootstrap Stack.'
  }
  Assert-AwsLookupMissing -AwsCli $AwsCli -Label 'Cell Scheduler group' -Arguments @(
    'scheduler', 'get-schedule-group',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--name', 'techlong-sandbox-cell',
    '--output', 'json'
  )
  Assert-AwsLookupMissing -AwsCli $AwsCli -Label 'Cell Janitor schedule' -Arguments @(
    'scheduler', 'get-schedule',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--group-name', 'techlong-sandbox-cell',
    '--name', 'techlong-sandbox-cell-global-janitor',
    '--output', 'json'
  )
}

function Assert-ChildSnapshotUnchanged {
  param([object]$ChildSnapshot)
  $item = Get-Item -LiteralPath $ChildSnapshot.Path
  $rawHash = (Get-FileHash -LiteralPath $ChildSnapshot.Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $canonicalHash = Get-CanonicalTemplateHash -TemplatePath $ChildSnapshot.Path
  if (
    $rawHash -cne $ChildSnapshot.RawSha256 -or
    $canonicalHash -cne $ChildSnapshot.CanonicalSha256 -or
    [long]$item.Length -ne [long]$ChildSnapshot.Size -or
    -not $item.IsReadOnly
  ) {
    throw 'The immutable child B5 Cell Bootstrap template snapshot changed.'
  }
}

function Assert-ExactBootstrapSourceBucket {
  param([string]$AwsCli)
  $bootstrapStackName = 'techlong-s3-bootstrap'
  $stack = Get-ExactStackOrNull -AwsCli $AwsCli -StackName $bootstrapStackName
  if (
    $null -eq $stack -or
    [string]$stack.StackName -cne $bootstrapStackName -or
    [string]$stack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')
  ) {
    throw 'The exact completed techlong-s3-bootstrap Stack is required before publishing a child template.'
  }
  $bucketOutputs = @($stack.Outputs | Where-Object {
    [string]$_.OutputKey -ceq 'CodeBuildSourceBucketName'
  })
  if (
    $bucketOutputs.Count -ne 1 -or
    [string]$bucketOutputs[0].OutputValue -cne $childTemplateBucketName
  ) {
    throw 'techlong-s3-bootstrap CodeBuildSourceBucketName output drifted.'
  }
  $resource = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'describe-stack-resource',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName,
    '--logical-resource-id', 'CodeBuildSourceBucket',
    '--output', 'json'
  )
  $detail = $resource.StackResourceDetail
  if (
    [string]$detail.StackName -cne $bootstrapStackName -or
    [string]$detail.StackId -cne [string]$stack.StackId -or
    [string]$detail.LogicalResourceId -cne 'CodeBuildSourceBucket' -or
    [string]$detail.PhysicalResourceId -cne $childTemplateBucketName -or
    [string]$detail.ResourceType -cne 'AWS::S3::Bucket' -or
    [string]$detail.ResourceStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')
  ) {
    throw 'techlong-s3-bootstrap CodeBuildSourceBucket physical ownership drifted.'
  }

  $location = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-location', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  if ([string]$location.LocationConstraint -cne $expectedRegion) {
    throw 'Child template bucket region drifted.'
  }
  $publicAccess = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-public-access-block', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  $public = $publicAccess.PublicAccessBlockConfiguration
  if (
    $public.BlockPublicAcls -ne $true -or
    $public.BlockPublicPolicy -ne $true -or
    $public.IgnorePublicAcls -ne $true -or
    $public.RestrictPublicBuckets -ne $true
  ) {
    throw 'Child template bucket public-access block drifted.'
  }
  $policyStatus = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-policy-status', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  if ($policyStatus.PolicyStatus.IsPublic -ne $false) {
    throw 'Child template bucket policy is public or its private status is unavailable.'
  }
  $bucketPolicyResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-policy', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  try {
    $bucketPolicy = ([string]$bucketPolicyResponse.Policy) | ConvertFrom-Json -Depth 100
  } catch {
    throw 'Child template bucket policy is not exact JSON.'
  }
  Assert-ExactJsonObject -Actual $bucketPolicy -Expected ([ordered]@{
    Version = '2012-10-17'
    Statement = @(
      [ordered]@{
        Sid = 'DenyInsecureTransport'
        Effect = 'Deny'
        Principal = '*'
        Action = 's3:*'
        Resource = @(
          "arn:aws:s3:::$childTemplateBucketName",
          "arn:aws:s3:::$childTemplateBucketName/*"
        )
        Condition = [ordered]@{
          Bool = [ordered]@{ 'aws:SecureTransport' = 'false' }
        }
      }
    )
  }) -Label 'Child template bucket policy'
  $acl = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-acl', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  $grants = @($acl.Grants)
  if (
    [string]::IsNullOrEmpty([string]$acl.Owner.ID) -or
    $grants.Count -ne 1 -or
    [string]$grants[0].Permission -cne 'FULL_CONTROL' -or
    [string]$grants[0].Grantee.Type -cne 'CanonicalUser' -or
    [string]$grants[0].Grantee.ID -cne [string]$acl.Owner.ID -or
    -not [string]::IsNullOrEmpty([string]$grants[0].Grantee.URI) -or
    -not [string]::IsNullOrEmpty([string]$grants[0].Grantee.EmailAddress)
  ) {
    throw 'Child template bucket ACL is not exact owner-only private access.'
  }
  $encryption = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-encryption', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  $encryptionRules = @($encryption.ServerSideEncryptionConfiguration.Rules)
  if (
    $encryptionRules.Count -ne 1 -or
    [string]$encryptionRules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm -cne 'AES256' -or
    -not [string]::IsNullOrEmpty([string]$encryptionRules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID) -or
    $encryptionRules[0].BucketKeyEnabled -ne $false
  ) {
    throw 'Child template bucket default encryption is not exact AES256.'
  }
  $ownership = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-ownership-controls', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  $ownershipRules = @($ownership.OwnershipControls.Rules)
  if (
    $ownershipRules.Count -ne 1 -or
    [string]$ownershipRules[0].ObjectOwnership -cne 'BucketOwnerEnforced'
  ) {
    throw 'Child template bucket ownership controls drifted.'
  }
  $versioningOutput = & $AwsCli s3api get-bucket-versioning `
    --profile $Profile `
    --region $expectedRegion `
    --bucket $childTemplateBucketName `
    --expected-bucket-owner $expectedAccountId `
    --output json
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to read child template bucket versioning.'
  }
  $versioningText = (($versioningOutput | Out-String).Trim())
  $versioning = if ([string]::IsNullOrWhiteSpace($versioningText)) {
    [PSCustomObject]@{}
  } else {
    $versioningText | ConvertFrom-Json
  }
  if (
    -not [string]::IsNullOrEmpty([string]$versioning.Status) -or
    -not [string]::IsNullOrEmpty([string]$versioning.MFADelete)
  ) {
    throw 'Child template bucket versioning must remain unconfigured for one exact immutable object.'
  }
  $tagging = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-tagging', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--expected-bucket-owner', $expectedAccountId,
    '--output', 'json'
  )
  Assert-ExactIamResourceTags `
    -ActualTags @($tagging.TagSet) `
    -ExpectedBusinessTags @(
      [PSCustomObject]@{ Key = 'Environment'; Value = 'aws-sandbox' },
      [PSCustomObject]@{ Key = 'ManagedBy'; Value = 'techlong-provisioner' },
      [PSCustomObject]@{ Key = 'Component'; Value = 'build-source' }
    ) `
    -LogicalId 'CodeBuildSourceBucket' `
    -ExpectedStackId ([string]$stack.StackId) `
    -ExpectedStackName $bootstrapStackName `
    -Label "S3 bucket $childTemplateBucketName"
  return $stack
}

function Get-ChildTemplateObjectHeadOrNull {
  param([string]$AwsCli, [string]$ObjectKey)
  $output = & $AwsCli s3api head-object `
    --profile $Profile `
    --region $expectedRegion `
    --bucket $childTemplateBucketName `
    --key $ObjectKey `
    --expected-bucket-owner $expectedAccountId `
    --checksum-mode ENABLED `
    --output json 2>&1
  if ($LASTEXITCODE -eq 0) {
    $json = (($output | Out-String).Trim())
    if ([string]::IsNullOrWhiteSpace($json)) {
      throw 'S3 HeadObject returned an empty response.'
    }
    return ($json | ConvertFrom-Json)
  }
  $errorText = ($output | Out-String)
  if ($errorText -match '(?i)(404|Not Found|NoSuchKey)') { return $null }
  throw "Unable to read the child template object head: $errorText"
}

function Assert-ExactChildTemplateObjectMetadata {
  param([object]$Metadata, [object]$ChildSnapshot, [string]$Label)
  $expectedChecksum = [Convert]::ToBase64String(
    [Convert]::FromHexString([string]$ChildSnapshot.RawSha256)
  )
  $actualMetadata = @{}
  foreach ($property in @($Metadata.Metadata.PSObject.Properties)) {
    if ($actualMetadata.ContainsKey([string]$property.Name)) {
      throw "$Label returned duplicate object metadata."
    }
    $actualMetadata[[string]$property.Name] = [string]$property.Value
  }
  Assert-ExactMap -Actual $actualMetadata -Expected @{
    'raw-sha256' = $ChildSnapshot.RawSha256
    'canonical-sha256' = $ChildSnapshot.CanonicalSha256
  } -Label "$Label user metadata"
  if (
    [long]$Metadata.ContentLength -ne [long]$ChildSnapshot.Size -or
    [string]$Metadata.ContentType -cne 'application/json' -or
    [string]$Metadata.ServerSideEncryption -cne 'AES256' -or
    [string]$Metadata.ChecksumSHA256 -cne $expectedChecksum -or
    (-not [string]::IsNullOrEmpty([string]$Metadata.ChecksumType) -and
      [string]$Metadata.ChecksumType -cne 'FULL_OBJECT') -or
    (-not [string]::IsNullOrEmpty([string]$Metadata.StorageClass) -and
      [string]$Metadata.StorageClass -cne 'STANDARD') -or
    -not [string]::IsNullOrEmpty([string]$Metadata.SSEKMSKeyId) -or
    -not [string]::IsNullOrEmpty([string]$Metadata.SSECustomerAlgorithm) -or
    $Metadata.BucketKeyEnabled -eq $true -or
    -not [string]::IsNullOrEmpty([string]$Metadata.VersionId) -or
    -not [string]::IsNullOrEmpty([string]$Metadata.WebsiteRedirectLocation) -or
    -not [string]::IsNullOrEmpty([string]$Metadata.ObjectLockMode) -or
    -not [string]::IsNullOrEmpty([string]$Metadata.ObjectLockRetainUntilDate) -or
    -not [string]::IsNullOrEmpty([string]$Metadata.ObjectLockLegalHoldStatus)
  ) {
    throw "$Label content, AES256, checksum, or immutable metadata drifted."
  }
}

function Assert-ExactChildTemplateObject {
  param([string]$AwsCli, [object]$ChildSnapshot)
  $objectKey = Get-ChildTemplateObjectKey -ChildSnapshot $ChildSnapshot
  $head = Get-ChildTemplateObjectHeadOrNull -AwsCli $AwsCli -ObjectKey $objectKey
  if ($null -eq $head) {
    throw "Approved child template object s3://$childTemplateBucketName/$objectKey is missing."
  }
  Assert-ExactChildTemplateObjectMetadata `
    -Metadata $head `
    -ChildSnapshot $ChildSnapshot `
    -Label 'S3 HeadObject'
  $downloadPath = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-b5j4b-child-download-$([Guid]::NewGuid().ToString('N')).json"
  )
  try {
    $download = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
      's3api', 'get-object', '--profile', $Profile, '--region', $expectedRegion,
      '--bucket', $childTemplateBucketName, '--key', $objectKey,
      '--expected-bucket-owner', $expectedAccountId,
      '--checksum-mode', 'ENABLED', $downloadPath, '--output', 'json'
    )
    Assert-ExactChildTemplateObjectMetadata `
      -Metadata $download `
      -ChildSnapshot $ChildSnapshot `
      -Label 'S3 GetObject'
    $downloadRaw = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $downloadCanonical = Get-CanonicalTemplateHash -TemplatePath $downloadPath
    if (
      $downloadRaw -cne $ChildSnapshot.RawSha256 -or
      $downloadCanonical -cne $ChildSnapshot.CanonicalSha256 -or
      (Get-Item -LiteralPath $downloadPath).Length -ne [long]$ChildSnapshot.Size
    ) {
      throw 'Downloaded child template object does not exactly match the immutable local snapshot.'
    }
  } finally {
    if (Test-Path -LiteralPath $downloadPath) {
      Remove-Item -LiteralPath $downloadPath -Force
    }
  }
}

function Publish-ExactChildTemplateObject {
  param([string]$AwsCli, [object]$ChildSnapshot)
  Assert-ChildSnapshotUnchanged -ChildSnapshot $ChildSnapshot
  Assert-ExactBootstrapSourceBucket -AwsCli $AwsCli | Out-Null
  $objectKey = Get-ChildTemplateObjectKey -ChildSnapshot $ChildSnapshot
  $head = Get-ChildTemplateObjectHeadOrNull -AwsCli $AwsCli -ObjectKey $objectKey
  if ($null -eq $head) {
    $checksum = [Convert]::ToBase64String(
      [Convert]::FromHexString([string]$ChildSnapshot.RawSha256)
    )
    $output = & $AwsCli s3api put-object `
      --profile $Profile `
      --region $expectedRegion `
      --bucket $childTemplateBucketName `
      --key $objectKey `
      --expected-bucket-owner $expectedAccountId `
      --body $ChildSnapshot.Path `
      --content-type application/json `
      --server-side-encryption AES256 `
      --checksum-algorithm SHA256 `
      --checksum-sha256 $checksum `
      --metadata "raw-sha256=$($ChildSnapshot.RawSha256),canonical-sha256=$($ChildSnapshot.CanonicalSha256)" `
      --if-none-match '*' `
      --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
      $putText = (($output | Out-String).Trim())
      if ([string]::IsNullOrWhiteSpace($putText)) {
        throw 'S3 PutObject returned no confirmation.'
      }
      $put = $putText | ConvertFrom-Json
      if (
        [string]$put.ServerSideEncryption -cne 'AES256' -or
        [string]$put.ChecksumSHA256 -cne $checksum -or
        [string]::IsNullOrEmpty([string]$put.ETag) -or
        -not [string]::IsNullOrEmpty([string]$put.VersionId)
      ) {
        throw 'S3 PutObject did not confirm exact AES256 and SHA256 storage.'
      }
    } else {
      $errorText = ($output | Out-String)
      if ($errorText -notmatch '(?i)(PreconditionFailed|412)') {
        throw "Unable to publish the immutable child template object: $errorText"
      }
    }
  }
  Assert-ExactChildTemplateObject -AwsCli $AwsCli -ChildSnapshot $ChildSnapshot
  Assert-ChildSnapshotUnchanged -ChildSnapshot $ChildSnapshot
  Write-Host "Exact immutable child template object is ready: $(Get-ChildTemplateUrl -ChildSnapshot $ChildSnapshot)"
}

function Remove-ExactChildTemplateObject {
  param([string]$AwsCli, [object]$ChildSnapshot)
  Assert-ChildSnapshotUnchanged -ChildSnapshot $ChildSnapshot
  Assert-ExactBootstrapSourceBucket -AwsCli $AwsCli | Out-Null
  $objectKey = Get-ChildTemplateObjectKey -ChildSnapshot $ChildSnapshot
  $head = Get-ChildTemplateObjectHeadOrNull -AwsCli $AwsCli -ObjectKey $objectKey
  if ($null -eq $head) {
    Write-Host "Immutable child template object is already absent: s3://$childTemplateBucketName/$objectKey"
    return
  }
  Assert-ExactChildTemplateObject -AwsCli $AwsCli -ChildSnapshot $ChildSnapshot
  if ([string]$head.ETag -cnotmatch '^"[a-f0-9]{32}"$') {
    throw 'Exact child template object ETag is unavailable for conditional deletion.'
  }
  $deleted = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'delete-object', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $childTemplateBucketName, '--key', $objectKey,
    '--expected-bucket-owner', $expectedAccountId,
    '--if-match', ([string]$head.ETag), '--output', 'json'
  )
  if (
    $deleted.DeleteMarker -eq $true -or
    -not [string]::IsNullOrEmpty([string]$deleted.VersionId)
  ) {
    throw 'Conditional child template deletion unexpectedly created a versioned delete marker.'
  }
  if ($null -ne (Get-ChildTemplateObjectHeadOrNull -AwsCli $AwsCli -ObjectKey $objectKey)) {
    throw 'Exact child template object still exists after conditional deletion.'
  }
  Write-Host "Conditionally deleted exact child template object: s3://$childTemplateBucketName/$objectKey"
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
    throw 'CloudFormation TemplateBody is not the exact immutable reviewed management template.'
  }
  return $verifiedHash
}

function New-PreviousShapeSnapshot {
  param([object]$Contract, [object]$ChildSnapshot)
  if ($Contract.PreviousRendererShape -eq 'Missing') { return $null }
  $useGrantInputs = $Contract.PreviousRendererShape -ne 'Locked'
  return New-ReadOnlyTemplateSnapshot `
    -RendererShape $Contract.PreviousRendererShape `
    -UseGrantInputs $useGrantInputs `
    -ApprovedTemplateSha256 $ChildSnapshot.RawSha256
}

function Assert-ExactPreviousState {
  param(
    [string]$AwsCli,
    [object]$Contract,
    [object]$PreviousSnapshot,
    [string]$ResponsePath,
    [object]$ChildSnapshot
  )
  if ($Contract.ChangeSetType -eq 'CREATE') {
    Assert-StackMissing -AwsCli $AwsCli -StackName $managementStackName
    Assert-StackMissing -AwsCli $AwsCli -StackName $childBootstrapStackName
    Assert-ManagementIamNamesMissing -AwsCli $AwsCli
    Assert-LegacyCellIamNamesMissing -AwsCli $AwsCli
    Assert-ChildBootstrapRuntimeNamesMissing -AwsCli $AwsCli
    return
  }
  $previousContract = [PSCustomObject]@{
    TargetRendererShape = $Contract.PreviousRendererShape
  }
  Assert-ExactStackReadback `
    -AwsCli $AwsCli `
    -Snapshot $PreviousSnapshot `
    -Contract $previousContract `
    -TemplateResponsePath $ResponsePath `
    -ChildSnapshot $ChildSnapshot | Out-Null
}

function ConvertTo-UniqueMap {
  param([object[]]$Entries, [string]$KeyProperty, [string]$ValueProperty)
  $map = @{}
  foreach ($entry in @($Entries)) {
    $key = [string]$entry.$KeyProperty
    if ([string]::IsNullOrEmpty($key) -or $map.ContainsKey($key)) {
      throw "Duplicate or empty $KeyProperty was returned by AWS."
    }
    $map[$key] = [string]$entry.$ValueProperty
  }
  return $map
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
    ManagedBy = 'techlong-cell-bootstrap-manager'
    Component = 'b5-cell-bootstrap-management'
  }
}

function Assert-ExactMap {
  param([hashtable]$Actual, [hashtable]$Expected, [string]$Label)
  if ($Actual.Count -ne $Expected.Count) {
    throw "$Label count drifted."
  }
  foreach ($key in $Expected.Keys) {
    if (-not $Actual.ContainsKey($key) -or [string]$Actual[$key] -cne [string]$Expected[$key]) {
      throw "$Label value $key drifted."
    }
  }
}

function ConvertFrom-ExactIamDocument {
  param([object]$Document, [string]$Label)
  if ($null -eq $Document) {
    throw "$Label is missing."
  }
  if ($Document -is [string]) {
    $decoded = [Uri]::UnescapeDataString([string]$Document)
    try {
      return (ConvertFrom-Json -InputObject $decoded -Depth 100)
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
    "techlong-b5j4b-iam-object-$([Guid]::NewGuid().ToString('N')).json"
  )
  try {
    $json = ConvertTo-Json -InputObject $Value -Compress -Depth 100
    [System.IO.File]::WriteAllText(
      $path,
      $json,
      [System.Text.UTF8Encoding]::new($false)
    )
    return Get-CanonicalTemplateHash -TemplatePath $path
  } finally {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

function Assert-ExactJsonObject {
  param([object]$Actual, [object]$Expected, [string]$Label)
  $actualHash = Get-CanonicalObjectHash -Value $Actual -Label "$Label actual"
  $expectedHash = Get-CanonicalObjectHash -Value $Expected -Label "$Label expected"
  if ($actualHash -cne $expectedHash) {
    throw "$Label canonical document drifted."
  }
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
    [string]$ExpectedStackName = $managementStackName,
    [string]$Label
  )
  $actual = ConvertTo-UniqueMap -Entries @($ActualTags) -KeyProperty 'Key' -ValueProperty 'Value'
  $expected = ConvertTo-UniqueMap `
    -Entries @($ExpectedBusinessTags) `
    -KeyProperty 'Key' `
    -ValueProperty 'Value'
  $actualBusiness = @{}
  foreach ($key in $actual.Keys) {
    if ($key -notmatch '^aws:') { $actualBusiness[$key] = $actual[$key] }
  }
  Assert-ExactMap -Actual $actualBusiness -Expected $expected -Label "$Label business tag"
  $allowedSystemTags = @{
    'aws:cloudformation:logical-id' = $LogicalId
    'aws:cloudformation:stack-id' = $ExpectedStackId
    'aws:cloudformation:stack-name' = $ExpectedStackName
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
    [string]$ExpectedRoleName
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
  if (
    @($response.PolicyGroups).Count -ne 0 -or
    @($response.PolicyUsers).Count -ne 0 -or
    $roles.Count -ne 1 -or
    [string]$roles[0].RoleName -cne $ExpectedRoleName -or
    [string]::IsNullOrEmpty([string]$roles[0].RoleId)
  ) {
    throw "$PolicyArn $UsageFilter entities are not the exact one-role contract."
  }
}

function Assert-ExactManagedPolicyReadback {
  param(
    [string]$AwsCli,
    [object]$ExpectedResource,
    [string]$ExpectedPolicyArn,
    [string]$ExpectedRoleName,
    [bool]$AllowHistoricalVersions
  )
  $expected = $ExpectedResource.Properties
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-policy',
    '--profile', $Profile,
    '--policy-arn', $ExpectedPolicyArn,
    '--output', 'json'
  )
  $policy = $response.Policy
  if (
    [string]$policy.PolicyName -cne [string]$expected.ManagedPolicyName -or
    [string]$policy.Arn -cne $ExpectedPolicyArn -or
    [string]$policy.Path -cne '/' -or
    [string]$policy.DefaultVersionId -cnotmatch '^v[1-9][0-9]*$' -or
    $policy.IsAttachable -ne $true -or
    [int]$policy.AttachmentCount -ne 1 -or
    [int]$policy.PermissionsBoundaryUsageCount -ne 1 -or
    [string]$policy.Description -cne [string]$expected.Description
  ) {
    throw "Managed policy $ExpectedPolicyArn metadata, attachment count, or boundary usage count drifted."
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
  if ($versions.Count -lt 1 -or $versions.Count -gt 5) {
    throw "Managed policy $ExpectedPolicyArn returned an invalid version count."
  }
  if (
    -not $AllowHistoricalVersions -and
    ($versions.Count -ne 1 -or [string]$versions[0].VersionId -cne 'v1')
  ) {
    throw "Immutable managed policy $ExpectedPolicyArn must retain only default version v1."
  }
  $seenVersions = @{}
  $defaultVersions = @()
  foreach ($version in $versions) {
    $versionId = [string]$version.VersionId
    if ($versionId -cnotmatch '^v[1-9][0-9]*$' -or $seenVersions.ContainsKey($versionId)) {
      throw "Managed policy $ExpectedPolicyArn returned an invalid or duplicate version."
    }
    $seenVersions[$versionId] = $true
    if ($version.IsDefaultVersion -eq $true) { $defaultVersions += $versionId }
  }
  if (
    $defaultVersions.Count -ne 1 -or
    [string]$defaultVersions[0] -cne [string]$policy.DefaultVersionId
  ) {
    throw "Managed policy $ExpectedPolicyArn default-version metadata drifted."
  }
  foreach ($version in $versions) {
    $versionResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
      'iam', 'get-policy-version',
      '--profile', $Profile,
      '--policy-arn', $ExpectedPolicyArn,
      '--version-id', ([string]$version.VersionId),
      '--output', 'json'
    )
    if (
      [string]$versionResponse.PolicyVersion.VersionId -cne [string]$version.VersionId -or
      $versionResponse.PolicyVersion.IsDefaultVersion -ne $version.IsDefaultVersion
    ) {
      throw "Managed policy $ExpectedPolicyArn version readback drifted."
    }
    $document = ConvertFrom-ExactIamDocument `
      -Document $versionResponse.PolicyVersion.Document `
      -Label "$ExpectedPolicyArn version $($version.VersionId)"
    if ($version.IsDefaultVersion -eq $true) {
      Assert-ExactJsonObject `
        -Actual $document `
        -Expected $expected.PolicyDocument `
        -Label "$ExpectedPolicyArn default policy"
    } else {
      $inactiveHash = Get-CanonicalObjectHash `
        -Value $document `
        -Label "$ExpectedPolicyArn inactive version $($version.VersionId)"
      if ($inactiveHash -cnotmatch '^[a-f0-9]{64}$') {
        throw "Managed policy $ExpectedPolicyArn inactive version is not canonical JSON."
      }
    }
  }

  Assert-ExactPolicyEntities `
    -AwsCli $AwsCli `
    -PolicyArn $ExpectedPolicyArn `
    -UsageFilter 'PermissionsPolicy' `
    -ExpectedRoleName $ExpectedRoleName
  Assert-ExactPolicyEntities `
    -AwsCli $AwsCli `
    -PolicyArn $ExpectedPolicyArn `
    -UsageFilter 'PermissionsBoundary' `
    -ExpectedRoleName $ExpectedRoleName
}

function Assert-ExactRoleReadback {
  param(
    [string]$AwsCli,
    [object]$ExpectedResource,
    [string]$ExpectedRoleArn,
    [string]$ExpectedBoundaryArn,
    [string]$ExpectedBoundaryName,
    [string]$LogicalId,
    [string]$ExpectedStackId
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
  $expectedTrust = $expected.AssumeRolePolicyDocument
  if ([string]$expected.RoleName -ceq 'TechlongSandboxCellBootstrapManagerRole') {
    $expectedTrust = (ConvertTo-Json -InputObject $expectedTrust -Compress -Depth 100) |
      ConvertFrom-Json -Depth 100
    $expectedTrust.Statement[0].Principal.AWS = $expectedPrincipalArn
  }
  Assert-ExactJsonObject `
    -Actual $trust `
    -Expected $expectedTrust `
    -Label "$ExpectedRoleArn trust policy"
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
  $attachedPolicies = @($attached.AttachedPolicies)
  if (
    $attachedPolicies.Count -ne 1 -or
    [string]$attachedPolicies[0].PolicyArn -cne $ExpectedBoundaryArn -or
    [string]$attachedPolicies[0].PolicyName -cne $ExpectedBoundaryName
  ) {
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
    throw "IAM Role $ExpectedRoleArn must have zero inline policies."
  }
}

function Assert-ExactManagementIamReadback {
  param([string]$AwsCli, [object]$Snapshot, [string]$ExpectedStackId)
  $template = (Get-Content -LiteralPath $Snapshot.Path -Raw) | ConvertFrom-Json -Depth 100
  $resources = $template.Resources
  $contracts = @(
    [PSCustomObject]@{
      PolicyLogicalId = 'CellJanitorBoundary'; PolicyArn = $expectedJanitorBoundaryArn
      RoleLogicalId = 'CellJanitorExecutionRole'; RoleArn = $expectedJanitorRoleArn
      AllowHistoricalVersions = $false
    },
    [PSCustomObject]@{
      PolicyLogicalId = 'CellSchedulerInvokeBoundary'; PolicyArn = $expectedSchedulerBoundaryArn
      RoleLogicalId = 'CellSchedulerInvokeRole'; RoleArn = $expectedSchedulerRoleArn
      AllowHistoricalVersions = $false
    },
    [PSCustomObject]@{
      PolicyLogicalId = 'CellBootstrapManagerBoundary'; PolicyArn = $expectedManagerBoundaryArn
      RoleLogicalId = 'CellBootstrapManagerRole'; RoleArn = $expectedManagerRoleArn
      AllowHistoricalVersions = $true
    },
    [PSCustomObject]@{
      PolicyLogicalId = 'CellBootstrapExecutionBoundary'; PolicyArn = $expectedExecutionBoundaryArn
      RoleLogicalId = 'CellBootstrapExecutionRole'; RoleArn = $expectedExecutionRoleArn
      AllowHistoricalVersions = $false
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
    $roleName = [string]$roleResource.Properties.RoleName
    Assert-ExactManagedPolicyReadback `
      -AwsCli $AwsCli `
      -ExpectedResource $policyResource `
      -ExpectedPolicyArn $entry.PolicyArn `
      -ExpectedRoleName $roleName `
      -AllowHistoricalVersions ([bool]$entry.AllowHistoricalVersions)
    Assert-ExactRoleReadback `
      -AwsCli $AwsCli `
      -ExpectedResource $roleResource `
      -ExpectedRoleArn $entry.RoleArn `
      -ExpectedBoundaryArn $entry.PolicyArn `
      -ExpectedBoundaryName $policyName `
      -LogicalId $entry.RoleLogicalId `
      -ExpectedStackId $ExpectedStackId
  }
}

function Get-ChangeSetContract {
  param([object]$Snapshot, [object]$Contract)
  $binding = "$UpdateShape|$ApprovedChangeSetName|$GrantExpiresAt|$($Snapshot.RawSha256)|$($Snapshot.CanonicalSha256)"
  $bindingHash = Get-Sha256Text -Value $binding
  $name = "techlong-s3-b5-cell-bootstrap-management-$($Contract.ShapeToken)-$($bindingHash.Substring(0, 16))"
  $description = "B5-J4b management; update-shape=$UpdateShape; raw-sha256=$($Snapshot.RawSha256); canonical-sha256=$($Snapshot.CanonicalSha256)"
  return [PSCustomObject]@{
    Name = $name
    Description = $description
    ClientToken = "b5j4b-management-$($bindingHash.Substring(0, 32))"
  }
}

function Assert-ReviewedChangeSet {
  param(
    [object]$ChangeSet,
    [object]$Snapshot,
    [object]$Contract,
    [object]$ChangeSetContract
  )
  if (
    [string]$ChangeSet.StackName -cne $managementStackName -or
    [string]$ChangeSet.ChangeSetName -cne $ChangeSetContract.Name -or
    [string]$ChangeSet.ChangeSetId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-management-[a-z0-9-]+/[0-9a-f-]{36}$' -or
    [string]$ChangeSet.StackId -cnotmatch $managementStackIdPattern -or
    [string]$ChangeSet.Status -cne 'CREATE_COMPLETE' -or
    [string]$ChangeSet.ExecutionStatus -cne 'AVAILABLE' -or
    [string]$ChangeSet.Description -cne $ChangeSetContract.Description -or
    -not [string]::IsNullOrEmpty([string]$ChangeSet.RoleARN)
  ) {
    throw 'Change Set identity, state, description, or source-user RoleARN contract drifted.'
  }
  if (
    @($ChangeSet.NotificationARNs).Count -ne 0 -or
    -not [string]::IsNullOrEmpty([string]$ChangeSet.ParentChangeSetId) -or
    -not [string]::IsNullOrEmpty([string]$ChangeSet.RootChangeSetId) -or
    $ChangeSet.IncludeNestedStacks -eq $true -or
    $ChangeSet.ImportExistingResources -eq $true -or
    @($ChangeSet.Capabilities).Count -ne 1 -or
    [string]@($ChangeSet.Capabilities)[0] -cne 'CAPABILITY_NAMED_IAM'
  ) {
    throw 'Change Set nested/import/notification/capability metadata drifted.'
  }
  if (
    ($Contract.ChangeSetType -eq 'CREATE' -and [string]$ChangeSet.OnStackFailure -cne 'DELETE') -or
    ($Contract.ChangeSetType -eq 'UPDATE' -and -not [string]::IsNullOrEmpty([string]$ChangeSet.OnStackFailure))
  ) {
    throw 'Change Set rollback/on-stack-failure behavior drifted.'
  }
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
    -ValueProperty 'ParameterValue'
  Assert-ExactMap -Actual $parameters -Expected (Get-ExpectedParameters) -Label 'Change Set parameter'
  $tags = ConvertTo-UniqueMap `
    -Entries @($ChangeSet.Tags) `
    -KeyProperty 'Key' `
    -ValueProperty 'Value'
  Assert-ExactMap -Actual $tags -Expected (Get-ExpectedStackTags) -Label 'Change Set tag'

  $expectedResources = if ($Contract.ChangeSetType -eq 'CREATE') {
    @{
      CellJanitorBoundary = 'AWS::IAM::ManagedPolicy'
      CellSchedulerInvokeBoundary = 'AWS::IAM::ManagedPolicy'
      CellJanitorExecutionRole = 'AWS::IAM::Role'
      CellSchedulerInvokeRole = 'AWS::IAM::Role'
      CellBootstrapManagerBoundary = 'AWS::IAM::ManagedPolicy'
      CellBootstrapManagerRole = 'AWS::IAM::Role'
      CellBootstrapExecutionBoundary = 'AWS::IAM::ManagedPolicy'
      CellBootstrapExecutionRole = 'AWS::IAM::Role'
    }
  } else {
    @{ CellBootstrapManagerBoundary = 'AWS::IAM::ManagedPolicy' }
  }
  $changes = @($ChangeSet.Changes)
  if ($changes.Count -ne $expectedResources.Count) {
    throw 'Change Set resource-change count is not the exact reviewed shape.'
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
      [string]$change.Action -cne $Contract.ExpectedAction -or
      [string]$change.ResourceType -cne $expectedResources[$logicalId] -or
      [string]$change.Replacement -notin @('', 'False')
    ) {
      throw "Change Set resource contract drifted for $logicalId."
    }
    $scope = @($change.Scope)
    if ($Contract.ChangeSetType -eq 'CREATE') {
      if ($scope.Count -ne 0) { throw "$logicalId Add unexpectedly contains a modification scope." }
    } elseif ($scope.Count -ne 1 -or [string]$scope[0] -cne 'Properties') {
      throw 'The one reviewed manager-boundary update must modify Properties only.'
    }
  }
}

function Get-ReviewedChangeSet {
  param(
    [string]$AwsCli,
    [object]$Snapshot,
    [object]$Contract,
    [object]$ChangeSetContract,
    [string]$TemplateResponsePath
  )
  $changeSet = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'describe-change-set',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $managementStackName,
    '--change-set-name', $ChangeSetContract.Name,
    '--output', 'json'
  )
  Assert-ReviewedChangeSet `
    -ChangeSet $changeSet `
    -Snapshot $Snapshot `
    -Contract $Contract `
    -ChangeSetContract $ChangeSetContract
  Assert-ExactGetTemplateResponse `
    -AwsCli $AwsCli `
    -Snapshot $Snapshot `
    -ResponsePath $TemplateResponsePath `
    -ChangeSetName $ChangeSetContract.Name | Out-Null
  return $changeSet
}

function Assert-ExactApprovedChildChangeSet {
  param([string]$AwsCli, [object]$ChildSnapshot, [string]$TemplateResponsePath)
  Assert-ChildSnapshotUnchanged -ChildSnapshot $ChildSnapshot
  $expectedName = Get-ChildChangeSetName -ChildSnapshot $ChildSnapshot
  if ($ApprovedChangeSetName -cne $expectedName) {
    throw "ExecuteGrant must target the exact child Change Set $expectedName."
  }
  $expectedDescription = "B5-J4b cleanup-only bootstrap raw=$($ChildSnapshot.RawSha256) canonical=$($ChildSnapshot.CanonicalSha256)"
  $changeSet = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'describe-change-set',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $childBootstrapStackName,
    '--change-set-name', $expectedName,
    '--include-property-values',
    '--output', 'json'
  )
  $failures = [System.Collections.Generic.List[string]]::new()
  if ([string]$changeSet.StackName -cne $childBootstrapStackName) { $failures.Add('stack_name') }
  if ([string]$changeSet.ChangeSetName -cne $expectedName) { $failures.Add('change_set_name') }
  if ([string]$changeSet.ChangeSetId -cnotmatch "^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/$([regex]::Escape($expectedName))/[0-9a-f-]{36}$") { $failures.Add('change_set_id') }
  if ([string]$changeSet.StackId -cnotmatch $bootstrapStackIdPattern) { $failures.Add('stack_id') }
  if ([string]$changeSet.Status -cne 'CREATE_COMPLETE') { $failures.Add('status') }
  if ([string]$changeSet.ExecutionStatus -cne 'AVAILABLE') { $failures.Add('execution_status') }
  if ([string]$changeSet.Description -cne $expectedDescription) { $failures.Add('description') }
  if ([string]$changeSet.RoleARN -cne $expectedExecutionRoleArn) { $failures.Add('role_arn') }
  if (-not [string]::IsNullOrEmpty([string]$changeSet.NextToken)) { $failures.Add('pagination') }
  if (@($changeSet.NotificationARNs).Count -ne 0) { $failures.Add('notifications') }
  if (-not [string]::IsNullOrEmpty([string]$changeSet.ParentChangeSetId)) { $failures.Add('parent') }
  if (-not [string]::IsNullOrEmpty([string]$changeSet.RootChangeSetId)) { $failures.Add('root') }
  if ($changeSet.IncludeNestedStacks -ne $false) { $failures.Add('nested') }
  if ($changeSet.ImportExistingResources -eq $true) { $failures.Add('import') }
  if ([string]$changeSet.OnStackFailure -cne 'DELETE') { $failures.Add('on_stack_failure') }
  if (@($changeSet.RollbackConfiguration.RollbackTriggers).Count -ne 0) { $failures.Add('rollback_triggers') }
  if ($null -ne $changeSet.DeploymentConfig) {
    if (
      [string]$changeSet.DeploymentConfig.Mode -cne 'STANDARD' -or
      $changeSet.DeploymentConfig.DisableRollback -ne $false
    ) { $failures.Add('deployment_config') }
  }
  if ($failures.Count -ne 0) {
    throw "Approved child Change Set metadata drifted: $($failures -join ', ')."
  }
  $parameters = ConvertTo-UniqueMap `
    -Entries @($changeSet.Parameters) `
    -KeyProperty 'ParameterKey' `
    -ValueProperty 'ParameterValue'
  Assert-ExactMap -Actual $parameters -Expected @{
    ExpectedAccountId = $expectedAccountId
    ExpectedRegion = $expectedRegion
  } -Label 'Approved child Change Set parameter'
  $tags = ConvertTo-UniqueMap `
    -Entries @($changeSet.Tags) `
    -KeyProperty 'Key' `
    -ValueProperty 'Value'
  Assert-ExactMap -Actual $tags -Expected @{
    Environment = 'aws-sandbox'
    ManagedBy = 'techlong-cell-bootstrap-manager'
    Component = 'b5-cell-bootstrap'
  } -Label 'Approved child Change Set tag'
  if (@($changeSet.Capabilities).Count -ne 0) {
    throw 'Approved non-IAM child Change Set must declare zero capabilities.'
  }
  $expectedResources = @{
    CellJanitorLogGroup = 'AWS::Logs::LogGroup'
    CellJanitorFunction = 'AWS::Lambda::Function'
    CellSchedulerGroup = 'AWS::Scheduler::ScheduleGroup'
    CellGlobalJanitorSchedule = 'AWS::Scheduler::Schedule'
  }
  $changes = @($changeSet.Changes)
  if ($changes.Count -ne $expectedResources.Count) {
    throw 'Approved child Change Set must contain exactly four resource additions.'
  }
  $seen = @{}
  foreach ($entry in $changes) {
    $resource = $entry.ResourceChange
    $logicalId = [string]$resource.LogicalResourceId
    if (-not $expectedResources.ContainsKey($logicalId) -or $seen.ContainsKey($logicalId)) {
      throw "Approved child Change Set contains unexpected or duplicate resource $logicalId."
    }
    $seen[$logicalId] = $true
    if (
      [string]$resource.Action -cne 'Add' -or
      [string]$resource.ResourceType -cne $expectedResources[$logicalId] -or
      [string]$resource.Replacement -notin @('', 'False') -or
      @($resource.Scope).Count -ne 0 -or
      -not [string]::IsNullOrEmpty([string]$resource.PhysicalResourceId) -or
      -not [string]::IsNullOrEmpty([string]$resource.PolicyAction)
    ) {
      throw "Approved child Change Set resource shape drifted for $logicalId."
    }
  }
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $childBootstrapStackName,
    '--change-set-name', $expectedName,
    '--template-stage', 'Original',
    '--output', 'json'
  ) -OutputPath $TemplateResponsePath
  $verifiedHash = ((& node $templateVerifier `
    --expected-template $ChildSnapshot.Path `
    --get-template-response $TemplateResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verifiedHash -cne $ChildSnapshot.CanonicalSha256) {
    throw 'Approved child Change Set TemplateBody is not the exact immutable child snapshot.'
  }
  Assert-ChildSnapshotUnchanged -ChildSnapshot $ChildSnapshot
  Write-Host "Exact source-profile child Change Set preflight passed: $expectedName"
  return $changeSet
}

function Assert-SimulatedDecision {
  param(
    [string]$AwsCli,
    [string]$PolicySourceArn,
    [string]$Action,
    [string[]]$ResourceArns,
    [string[]]$ContextEntries,
    [string]$ExpectedDecision
  )
  foreach ($resourceArn in $ResourceArns) {
    $arguments = @(
      'iam', 'simulate-principal-policy',
      '--profile', $Profile,
      '--policy-source-arn', $PolicySourceArn,
      '--action-names', $Action,
      '--resource-arns', $resourceArn
    )
    if (@($ContextEntries).Count -gt 0) {
      $arguments += @('--context-entries') + $ContextEntries
    }
    $arguments += @('--output', 'json')
    $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments $arguments
    Assert-IamResponseNotTruncated -Response $response -Label "IAM simulation $Action on $resourceArn"
    $evaluations = @($response.EvaluationResults)
    if ($evaluations.Count -ne 1) {
      throw "IAM simulation returned an unexpected result count for $Action on $resourceArn."
    }
    $evaluation = $evaluations[0]
    if (
      [string]$evaluation.EvalActionName -cne $Action -or
      [string]$evaluation.EvalResourceName -cne $resourceArn -or
      [string]$evaluation.EvalDecision -cne $ExpectedDecision -or
      @($evaluation.MissingContextValues).Count -ne 0
    ) {
      throw "IAM simulation result for $Action drifted from decision $ExpectedDecision with zero missing context values."
    }
  }
}

function Assert-ExactIamSimulation {
  param([string]$AwsCli, [object]$Contract, [object]$ChildSnapshot)
  $rendererShape = [string]$Contract.TargetRendererShape
  if ($rendererShape -notin @('Locked', 'AuthorGrant', 'ExecuteGrant', 'RollbackGrant')) {
    throw 'IAM simulation requires one exact reviewed management renderer shape.'
  }
  $managerResourceTagContext = @(
    'ContextKeyName=aws:ResourceTag/Environment,ContextKeyValues=aws-sandbox,ContextKeyType=string',
    'ContextKeyName=aws:ResourceTag/ManagedBy,ContextKeyValues=techlong-cell-bootstrap-manager,ContextKeyType=string',
    'ContextKeyName=aws:ResourceTag/Component,ContextKeyValues=b5-cell-bootstrap,ContextKeyType=string'
  )
  $managerRegionalReadContext = @(
    'ContextKeyName=aws:RequestedRegion,ContextKeyValues=ca-central-1,ContextKeyType=string'
  ) + $managerResourceTagContext
  foreach ($action in @('ecs:RunTask', 'rds:CreateDBCluster', 'elasticloadbalancing:CreateLoadBalancer')) {
    Assert-SimulatedDecision `
      -AwsCli $AwsCli `
      -PolicySourceArn $expectedExecutionRoleArn `
      -Action $action `
      -ResourceArns @('*') `
      -ContextEntries @() `
      -ExpectedDecision 'explicitDeny'
  }
  foreach ($policyArn in @($expectedJanitorBoundaryArn, $expectedSchedulerBoundaryArn)) {
    foreach ($action in @(
      'iam:CreatePolicy',
      'iam:CreatePolicyVersion',
      'iam:DeletePolicy',
      'iam:DeletePolicyVersion',
      'iam:SetDefaultPolicyVersion'
    )) {
      Assert-SimulatedDecision `
        -AwsCli $AwsCli `
        -PolicySourceArn $expectedExecutionRoleArn `
        -Action $action `
        -ResourceArns @($policyArn) `
        -ContextEntries @() `
        -ExpectedDecision 'explicitDeny'
    }
  }
  foreach ($roleArn in @($expectedJanitorRoleArn, $expectedSchedulerRoleArn)) {
    foreach ($action in @('iam:PutRolePermissionsBoundary', 'iam:DeleteRolePermissionsBoundary')) {
      Assert-SimulatedDecision `
        -AwsCli $AwsCli `
        -PolicySourceArn $expectedExecutionRoleArn `
        -Action $action `
        -ResourceArns @($roleArn) `
        -ContextEntries @() `
      -ExpectedDecision 'explicitDeny'
    }
  }
  Assert-SimulatedDecision `
    -AwsCli $AwsCli `
    -PolicySourceArn $expectedExecutionRoleArn `
    -Action 'iam:PassRole' `
    -ResourceArns @($expectedJanitorRoleArn) `
    -ContextEntries @('ContextKeyName=iam:PassedToService,ContextKeyValues=lambda.amazonaws.com,ContextKeyType=string') `
    -ExpectedDecision 'allowed'
  Assert-SimulatedDecision `
    -AwsCli $AwsCli `
    -PolicySourceArn $expectedExecutionRoleArn `
    -Action 'iam:PassRole' `
    -ResourceArns @($expectedSchedulerRoleArn) `
    -ContextEntries @('ContextKeyName=iam:PassedToService,ContextKeyValues=scheduler.amazonaws.com,ContextKeyType=string') `
    -ExpectedDecision 'allowed'

  $childStackArn = 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/00000000-0000-0000-0000-000000000000'
  $expectedChildChangeSetName = Get-ChildChangeSetName -ChildSnapshot $ChildSnapshot
  $expectedChildTemplateUrl = Get-ChildTemplateUrl -ChildSnapshot $ChildSnapshot
  $changeSetArn = "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/$expectedChildChangeSetName/00000000-0000-0000-0000-000000000000"
  $now = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $currentTime = "ContextKeyName=aws:CurrentTime,ContextKeyValues=$now,ContextKeyType=date"
  $grantIsActive = $false
  if (-not [string]::IsNullOrEmpty($GrantExpiresAt)) {
    $grantIsActive = (ConvertFrom-CanonicalGrantExpiry -Value $GrantExpiresAt) -gt [DateTime]::UtcNow
  }
  $allowedIfActive = if ($grantIsActive) { 'allowed' } else { 'implicitDeny' }
  $requestedTags = @(
    'ContextKeyName=aws:RequestedRegion,ContextKeyValues=ca-central-1,ContextKeyType=string',
    'ContextKeyName=aws:RequestTag/Environment,ContextKeyValues=aws-sandbox,ContextKeyType=string',
    'ContextKeyName=aws:RequestTag/ManagedBy,ContextKeyValues=techlong-cell-bootstrap-manager,ContextKeyType=string',
    'ContextKeyName=aws:RequestTag/Component,ContextKeyValues=b5-cell-bootstrap,ContextKeyType=string',
    'ContextKeyName=aws:TagKeys,ContextKeyValues=Environment,ManagedBy,Component,ContextKeyType=stringList',
    "ContextKeyName=cloudformation:TemplateUrl,ContextKeyValues=$expectedChildTemplateUrl,ContextKeyType=string",
    "ContextKeyName=cloudformation:RoleARN,ContextKeyValues=$expectedExecutionRoleArn,ContextKeyType=string",
    "ContextKeyName=cloudformation:ChangeSetName,ContextKeyValues=$expectedChildChangeSetName,ContextKeyType=string",
    "ContextKeyName=cloudformation:ResourceTypes,ContextKeyValues=$($childTemplateResourceTypes -join ','),ContextKeyType=stringList",
    $currentTime
  ) + $managerResourceTagContext
  $managerSimulationContext = $requestedTags + @(
    'ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string'
  )
  Assert-SimulatedDecision `
    -AwsCli $AwsCli `
    -PolicySourceArn $expectedManagerRoleArn `
    -Action 'ecs:RunTask' `
    -ResourceArns @('*') `
    -ContextEntries $managerSimulationContext `
    -ExpectedDecision 'implicitDeny'
  $createDecision = if ($rendererShape -eq 'AuthorGrant') { $allowedIfActive } else { 'implicitDeny' }
  $executeDecision = if ($rendererShape -eq 'ExecuteGrant') { $allowedIfActive } else { 'implicitDeny' }
  $deleteDecision = if ($rendererShape -eq 'RollbackGrant') { $allowedIfActive } else { 'implicitDeny' }
  $passDecision = if ($rendererShape -in @('AuthorGrant', 'RollbackGrant')) { $allowedIfActive } else { 'implicitDeny' }
  $templateReadDecision = if ($rendererShape -eq 'AuthorGrant') { $allowedIfActive } else { 'implicitDeny' }
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'cloudformation:CreateChangeSet' -ResourceArns @($childStackArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision $createDecision
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'cloudformation:ExecuteChangeSet' -ResourceArns @($changeSetArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision $executeDecision
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'cloudformation:DeleteStack' -ResourceArns @($childStackArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision $deleteDecision
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'iam:PassRole' -ResourceArns @($expectedExecutionRoleArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision $passDecision
  $approvedTemplateObjectArn = "arn:aws:s3:::$childTemplateBucketName/$(Get-ChildTemplateObjectKey -ChildSnapshot $ChildSnapshot)"
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 's3:GetObject' -ResourceArns @($approvedTemplateObjectArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision $templateReadDecision

  $foreignStackArn = 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/00000000-0000-0000-0000-000000000000'
  $foreignChangeSetArn = 'arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-sandbox-cell-sandbox-1-0000000000000000/00000000-0000-0000-0000-000000000000'
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'cloudformation:CreateChangeSet' -ResourceArns @($foreignStackArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision 'implicitDeny'
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'cloudformation:ExecuteChangeSet' -ResourceArns @($foreignChangeSetArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision 'implicitDeny'
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'cloudformation:DeleteStack' -ResourceArns @($foreignStackArn) `
    -ContextEntries $managerSimulationContext -ExpectedDecision 'implicitDeny'
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 'iam:PassRole' `
    -ResourceArns @('arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole') `
    -ContextEntries $managerSimulationContext `
    -ExpectedDecision 'implicitDeny'
  Assert-SimulatedDecision -AwsCli $AwsCli -PolicySourceArn $expectedManagerRoleArn `
    -Action 's3:GetObject' `
    -ResourceArns @("arn:aws:s3:::$childTemplateBucketName/b5-cell-bootstrap/templates/sha256/$('0' * 64).json") `
    -ContextEntries $managerSimulationContext `
    -ExpectedDecision 'implicitDeny'
}

function Assert-ExactStackReadback {
  param(
    [string]$AwsCli,
    [object]$Snapshot,
    [object]$Contract,
    [string]$TemplateResponsePath,
    [object]$ChildSnapshot
  )
  $stack = Get-ExactStackOrNull -AwsCli $AwsCli -StackName $managementStackName
  if ($null -eq $stack) { throw 'The exact management Stack is missing.' }
  if (
    [string]$stack.StackName -cne $managementStackName -or
    [string]$stack.StackId -cnotmatch $managementStackIdPattern -or
    [string]$stack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE') -or
    -not [string]::IsNullOrEmpty([string]$stack.RoleARN) -or
    $stack.EnableTerminationProtection -ne $false -or
    -not [string]::IsNullOrEmpty([string]$stack.ParentId) -or
    -not [string]::IsNullOrEmpty([string]$stack.RootId)
  ) {
    throw 'Management Stack identity, status, source-user RoleARN, or top-level protection contract drifted.'
  }
  $parameters = ConvertTo-UniqueMap `
    -Entries @($stack.Parameters) `
    -KeyProperty 'ParameterKey' `
    -ValueProperty 'ParameterValue'
  Assert-ExactMap -Actual $parameters -Expected (Get-ExpectedParameters) -Label 'Stack parameter'
  $tags = ConvertTo-UniqueMap -Entries @($stack.Tags) -KeyProperty 'Key' -ValueProperty 'Value'
  Assert-ExactMap -Actual $tags -Expected (Get-ExpectedStackTags) -Label 'Stack tag'
  $outputs = ConvertTo-UniqueMap -Entries @($stack.Outputs) -KeyProperty 'OutputKey' -ValueProperty 'OutputValue'
  Assert-ExactMap -Actual $outputs -Expected @{
    CellBootstrapManagerRoleArn = $expectedManagerRoleArn
    CellBootstrapExecutionRoleArn = $expectedExecutionRoleArn
    ApprovedManagedStackName = $childBootstrapStackName
    SafetyState = 'BOOTSTRAP_MANAGEMENT_ONLY_NO_SHARED_CELL'
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
    throw 'Unexpected pagination in the eight-resource management Stack inventory.'
  }
  $expectedResources = @{
    CellJanitorBoundary = @('AWS::IAM::ManagedPolicy', $expectedJanitorBoundaryArn)
    CellSchedulerInvokeBoundary = @('AWS::IAM::ManagedPolicy', $expectedSchedulerBoundaryArn)
    CellJanitorExecutionRole = @('AWS::IAM::Role', 'TechlongSandboxCellJanitorExecutionRole')
    CellSchedulerInvokeRole = @('AWS::IAM::Role', 'TechlongSandboxCellSchedulerInvokeRole')
    CellBootstrapManagerBoundary = @('AWS::IAM::ManagedPolicy', $expectedManagerBoundaryArn)
    CellBootstrapManagerRole = @('AWS::IAM::Role', 'TechlongSandboxCellBootstrapManagerRole')
    CellBootstrapExecutionBoundary = @('AWS::IAM::ManagedPolicy', $expectedExecutionBoundaryArn)
    CellBootstrapExecutionRole = @('AWS::IAM::Role', 'TechlongSandboxCellBootstrapCloudFormationExecutionRole')
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
      [string]$resource.ResourceStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')
    ) {
      throw "Management Stack live resource $logicalId drifted."
    }
  }
  Assert-ExactGetTemplateResponse `
    -AwsCli $AwsCli `
    -Snapshot $Snapshot `
    -ResponsePath $TemplateResponsePath | Out-Null
  Assert-ExactManagementIamReadback `
    -AwsCli $AwsCli `
    -Snapshot $Snapshot `
    -ExpectedStackId ([string]$stack.StackId)
  Assert-ExactIamSimulation -AwsCli $AwsCli -Contract $Contract -ChildSnapshot $ChildSnapshot
  Write-Host "Strict management Stack readback passed: $($stack.StackId)"
  return $stack
}

Write-Host 'Running local B5-J4b Cell Bootstrap management validation...'
& node $validator
if ($LASTEXITCODE -ne 0) { throw 'Local B5-J4b management validation failed.' }

$contract = Get-ShapeContract
$targetUsesGrantInputs = $contract.TargetRendererShape -ne 'Locked'
$targetSnapshot = $null
$previousSnapshot = $null
$childSnapshot = $null
$templateResponsePath = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-cell-bootstrap-management-template-$([Guid]::NewGuid().ToString('N')).json"
)
$previousTemplateResponsePath = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-cell-bootstrap-management-previous-$([Guid]::NewGuid().ToString('N')).json"
)
$childTemplateResponsePath = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-cell-bootstrap-approved-$([Guid]::NewGuid().ToString('N')).json"
)
$previousIgnoreConfiguredEndpointUrls =
  [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')

try {
  $childSnapshot = New-ReadOnlyChildTemplateSnapshot
  Assert-ShapeInputs -Contract $contract -ChildSnapshot $childSnapshot
  $targetSnapshot = New-ReadOnlyTemplateSnapshot `
    -RendererShape $contract.TargetRendererShape `
    -UseGrantInputs $targetUsesGrantInputs `
    -ApprovedTemplateSha256 $childSnapshot.RawSha256
  Write-Host "Update shape: $UpdateShape"
  Write-Host "Rendered target shape: $($contract.TargetRendererShape)"
  Write-Host "Template raw SHA-256: $($targetSnapshot.RawSha256)"
  Write-Host "Template canonical SHA-256: $($targetSnapshot.CanonicalSha256)"
  Write-Host "Child template raw SHA-256: $($childSnapshot.RawSha256)"
  Write-Host "Child template canonical SHA-256: $($childSnapshot.CanonicalSha256)"
  Write-Host "Child template bytes: $($childSnapshot.Size)"
  Write-Host "Child digest-bound Change Set name: $(Get-ChildChangeSetName -ChildSnapshot $childSnapshot)"
  Write-Host "Child immutable TemplateURL: $(Get-ChildTemplateUrl -ChildSnapshot $childSnapshot)"

  if ($Mode -eq 'LocalValidate') {
    Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
    exit 0
  }
  if ($Profile -notmatch '^[A-Za-z0-9_-]{1,64}$') {
    throw 'AWS profile name contains unsupported characters.'
  }

  Assert-NoAwsEndpointOverrides
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    'true',
    [EnvironmentVariableTarget]::Process
  )
  $awsCli = Resolve-AwsCli
  Assert-ExactSourceIdentity -AwsCli $awsCli
  Assert-ChildSnapshotUnchanged -ChildSnapshot $childSnapshot
  Assert-SnapshotUnchanged -Snapshot $targetSnapshot
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--template-body', "file://$($targetSnapshot.Path)"
  )

  if ($Mode -eq 'OnlineValidate') {
    $previousSnapshot = New-PreviousShapeSnapshot -Contract $contract -ChildSnapshot $childSnapshot
    Assert-ExactPreviousState `
      -AwsCli $awsCli `
      -Contract $contract `
      -PreviousSnapshot $previousSnapshot `
      -ResponsePath $previousTemplateResponsePath `
      -ChildSnapshot $childSnapshot
    Write-Host 'Online validation complete. No Change Set, Stack, IAM resource, or Shared Cell was changed.'
    exit 0
  }

  $changeSetContract = Get-ChangeSetContract -Snapshot $targetSnapshot -Contract $contract
  if ($Mode -in @('CreateChangeSet', 'ExecuteChangeSet', 'Delete')) {
    Assert-WriteAcknowledgements -Snapshot $targetSnapshot -Deleting ($Mode -eq 'Delete')
    Assert-SnapshotUnchanged -Snapshot $targetSnapshot
  }
  if ($Mode -eq 'ExecuteChangeSet' -and -not $AcknowledgeChangeSetReviewed) {
    throw 'ExecuteChangeSet requires -AcknowledgeChangeSetReviewed after a separate exact InspectChangeSet command.'
  }

  if ($Mode -eq 'CreateChangeSet') {
    $previousSnapshot = New-PreviousShapeSnapshot -Contract $contract -ChildSnapshot $childSnapshot
    Assert-ExactPreviousState `
      -AwsCli $awsCli `
      -Contract $contract `
      -PreviousSnapshot $previousSnapshot `
      -ResponsePath $previousTemplateResponsePath `
      -ChildSnapshot $childSnapshot
    if ($UpdateShape -eq 'BootstrapAuthorGrant') {
      if (-not $AcknowledgeLowCostNotFree) {
        throw 'BootstrapAuthorGrant requires -AcknowledgeLowCostNotFree before the immutable S3 Put/Get verification.'
      }
      Publish-ExactChildTemplateObject -AwsCli $awsCli -ChildSnapshot $childSnapshot
    }
    if ($UpdateShape -eq 'BootstrapExecuteGrant') {
      Assert-ExactBootstrapSourceBucket -AwsCli $awsCli | Out-Null
      Assert-ExactChildTemplateObject -AwsCli $awsCli -ChildSnapshot $childSnapshot
      Assert-ExactApprovedChildChangeSet `
        -AwsCli $awsCli `
        -ChildSnapshot $childSnapshot `
        -TemplateResponsePath $childTemplateResponsePath | Out-Null
    }
    Assert-ChildSnapshotUnchanged -ChildSnapshot $childSnapshot
    Assert-SnapshotUnchanged -Snapshot $targetSnapshot
    $parameters = @(
      "ParameterKey=ExpectedAccountId,ParameterValue=$expectedAccountId",
      "ParameterKey=ExpectedRegion,ParameterValue=$expectedRegion",
      "ParameterKey=ManagementPrincipalArn,ParameterValue=$expectedPrincipalArn"
    )
    $createArguments = @(
      'cloudformation', 'create-change-set',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName,
      '--change-set-name', $changeSetContract.Name,
      '--change-set-type', $contract.ChangeSetType,
      '--description', $changeSetContract.Description,
      '--template-body', "file://$($targetSnapshot.Path)",
      '--capabilities', 'CAPABILITY_NAMED_IAM',
      '--parameters'
    ) + $parameters + @(
      '--tags',
      'Key=Environment,Value=aws-sandbox',
      'Key=ManagedBy,Value=techlong-cell-bootstrap-manager',
      'Key=Component,Value=b5-cell-bootstrap-management',
      '--no-include-nested-stacks',
      '--client-token', $changeSetContract.ClientToken
    )
    if ($contract.ChangeSetType -eq 'CREATE') {
      $createArguments += @('--on-stack-failure', 'DELETE')
    }
    Invoke-AwsChecked -AwsCli $awsCli -Arguments $createArguments
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', 'change-set-create-complete',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName,
      '--change-set-name', $changeSetContract.Name
    )
    Get-ReviewedChangeSet `
      -AwsCli $awsCli `
      -Snapshot $targetSnapshot `
      -Contract $contract `
      -ChangeSetContract $changeSetContract `
      -TemplateResponsePath $templateResponsePath | Out-Null
    Write-Host "Created and exact-checked Change Set $($changeSetContract.Name), but did NOT execute it."
    Write-Host 'Run InspectChangeSet separately before ExecuteChangeSet.'
    exit 0
  }

  if ($Mode -in @('InspectChangeSet', 'ExecuteChangeSet')) {
    if ($contract.ChangeSetType -eq 'UPDATE') {
      $previousSnapshot = New-PreviousShapeSnapshot -Contract $contract -ChildSnapshot $childSnapshot
      Assert-ExactPreviousState `
        -AwsCli $awsCli `
        -Contract $contract `
        -PreviousSnapshot $previousSnapshot `
        -ResponsePath $previousTemplateResponsePath `
        -ChildSnapshot $childSnapshot
    } else {
      Assert-StackMissing -AwsCli $awsCli -StackName $childBootstrapStackName
      Assert-ManagementIamNamesMissing -AwsCli $awsCli
      Assert-LegacyCellIamNamesMissing -AwsCli $awsCli
      Assert-ChildBootstrapRuntimeNamesMissing -AwsCli $awsCli
    }
    $changeSet = Get-ReviewedChangeSet `
      -AwsCli $awsCli `
      -Snapshot $targetSnapshot `
      -Contract $contract `
      -ChangeSetContract $changeSetContract `
      -TemplateResponsePath $templateResponsePath
    if ($Mode -eq 'InspectChangeSet') {
      Write-Host "Change Set: $($changeSetContract.Name)"
      Write-Host "Status: $($changeSet.Status) / $($changeSet.ExecutionStatus)"
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
    if ($UpdateShape -eq 'BootstrapExecuteGrant') {
      Assert-ExactBootstrapSourceBucket -AwsCli $awsCli | Out-Null
      Assert-ExactChildTemplateObject -AwsCli $awsCli -ChildSnapshot $childSnapshot
      Assert-ExactApprovedChildChangeSet `
        -AwsCli $awsCli `
        -ChildSnapshot $childSnapshot `
        -TemplateResponsePath $childTemplateResponsePath | Out-Null
      Assert-ChildSnapshotUnchanged -ChildSnapshot $childSnapshot
    }
    Assert-SnapshotUnchanged -Snapshot $targetSnapshot
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'execute-change-set',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName,
      '--change-set-name', $changeSetContract.Name,
      '--client-request-token', "execute-$($changeSetContract.ClientToken)"
    )
    $waiter = if ($contract.ChangeSetType -eq 'CREATE') {
      'stack-create-complete'
    } else {
      'stack-update-complete'
    }
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', $waiter,
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName
    )
    Assert-ExactStackReadback `
      -AwsCli $awsCli `
      -Snapshot $targetSnapshot `
      -Contract $contract `
      -TemplateResponsePath $templateResponsePath `
      -ChildSnapshot $childSnapshot | Out-Null
    Write-Host "Executed and strictly read back management UpdateShape $UpdateShape."
    Write-Host 'No Shared Cell, VPC, ALB, ECS Cluster/Task, or RDS resource was created.'
    exit 0
  }

  if ($Mode -eq 'Readback') {
    Assert-ExactStackReadback `
      -AwsCli $awsCli `
      -Snapshot $targetSnapshot `
      -Contract $contract `
      -TemplateResponsePath $templateResponsePath `
      -ChildSnapshot $childSnapshot | Out-Null
    Write-Host "Readback passed for exact management shape $($contract.TargetRendererShape)."
    exit 0
  }

  if ($Mode -eq 'Delete') {
    if ($UpdateShape -cne 'InitialLocked') {
      throw 'Delete requires -UpdateShape InitialLocked.'
    }
    $stack = Assert-ExactStackReadback `
      -AwsCli $awsCli `
      -Snapshot $targetSnapshot `
      -Contract $contract `
      -TemplateResponsePath $templateResponsePath `
      -ChildSnapshot $childSnapshot
    if ([string]$stack.StackId -cne $ConfirmStackId) {
      throw 'Delete requires the exact deployed -ConfirmStackId.'
    }
    Assert-StackMissing -AwsCli $awsCli -StackName $childBootstrapStackName
    Assert-LegacyCellIamNamesMissing -AwsCli $awsCli
    Assert-ChildBootstrapRuntimeNamesMissing -AwsCli $awsCli
    Remove-ExactChildTemplateObject -AwsCli $awsCli -ChildSnapshot $childSnapshot
    Assert-SnapshotUnchanged -Snapshot $targetSnapshot
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'delete-stack',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName,
      '--client-request-token', "delete-$($changeSetContract.ClientToken)"
    )
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', 'stack-delete-complete',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $managementStackName
    )
    Assert-StackMissing -AwsCli $awsCli -StackName $managementStackName
    Assert-ManagementIamNamesMissing -AwsCli $awsCli
    Assert-LegacyCellIamNamesMissing -AwsCli $awsCli
    Assert-ChildBootstrapRuntimeNamesMissing -AwsCli $awsCli
    Write-Host 'Deleted the exact locked B5-J4b management root after proving the child Bootstrap Stack was absent.'
    exit 0
  }

  throw "Unhandled management mode $Mode."
} finally {
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    $previousIgnoreConfiguredEndpointUrls,
    [EnvironmentVariableTarget]::Process
  )
  Remove-TemplateSnapshot -Snapshot $targetSnapshot
  Remove-TemplateSnapshot -Snapshot $previousSnapshot
  Remove-TemplateSnapshot -Snapshot $childSnapshot
  foreach ($path in @($templateResponsePath, $previousTemplateResponsePath, $childTemplateResponsePath)) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}
