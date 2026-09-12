[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet', 'Readback', 'ProbeJanitor', 'Delete')]
  [string]$Mode = 'LocalValidate',
  [ValidateSet('InitialCreate', 'PlannerUpdate', 'AuthorityV2ConsumerUpdate', 'AuthorityV2ConsumerRollback')]
  [string]$DeploymentShape = 'InitialCreate',
  [string]$ManagerProfile = 'techlong-sandbox-cell-bootstrap-manager',
  [string]$SourceReadbackProfile = 'techlong-sandbox-user',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmRegion = '',
  [string]$ConfirmBootstrapStackName = '',
  [string]$ConfirmStackId = '',
  [string]$ConfirmChangeSetName = '',
  [string]$ConfirmTemplateSha256 = '',
  [string]$ConfirmTemplateCanonicalSha256 = '',
  [string]$ConfirmExecutionPhrase = '',
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeLowCostNotFree,
  [switch]$AcknowledgeCleanupOnlyNoCell,
  [switch]$AcknowledgeManagerMfaSession,
  [switch]$AcknowledgeChangeSetReviewed,
  [switch]$AcknowledgeTwoLowCostLambdaInvocations,
  [switch]$AcknowledgeDeleteJanitorLogs
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedSourceProfile = 'techlong-sandbox-user'
$expectedManagerProfile = 'techlong-sandbox-cell-bootstrap-manager'
$expectedSourceArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$expectedSourceUserName = 'techlong-sandbox-dev'
$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa/techlong-sandbox-dev'
$managerRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellBootstrapManagerRole'
$managerSessionArn = 'arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellBootstrapManagerRole/techlong-sandbox-cell-bootstrap-manager'
$managerBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellBootstrapManagerBoundary'
$bootstrapExecutionRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellBootstrapCloudFormationExecutionRole'
$bootstrapExecutionBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellBootstrapCloudFormationExecutionBoundary'
$janitorBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellJanitorBoundary'
$schedulerBoundaryArn = 'arn:aws:iam::402010193138:policy/TechlongSandboxCellSchedulerInvokeBoundary'
$janitorRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole'
$schedulerRoleArn = 'arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole'
$managementStackName = 'techlong-s3-b5-cell-bootstrap-management'
$bootstrapStackName = 'techlong-s3-b5-cell-bootstrap'
$approvedCellStackName = 'techlong-sandbox-cell-sandbox-1'
$approvedClusterName = 'cell-sandbox-1'
$templateBucketName = 'techlong-sandbox-build-source-402010193138-ca-central-1'
$templateObjectKeyPrefix = 'b5-cell-bootstrap/templates/sha256'
$approvedResourceTypes = @(
  'AWS::Logs::LogGroup',
  'AWS::Lambda::Function',
  'AWS::Scheduler::ScheduleGroup',
  'AWS::Scheduler::Schedule'
)
$initialCreatePhrase = 'I_ACKNOWLEDGE_B5_J4C_PLAN_ONLY_BOOTSTRAP_CREATION'
$plannerUpdatePhrase = 'I_ACKNOWLEDGE_B5_J4C_PLAN_ONLY_BOOTSTRAP_UPDATE'
$authorityV2ConsumerUpdatePhrase = 'I_ACKNOWLEDGE_B5_J5G_G_PLAN_ONLY_AUTHORITY_V2_CONSUMER_UPDATE'
$authorityV2ConsumerRollbackPhrase = 'I_ACKNOWLEDGE_B5_J5G_G_PLAN_ONLY_AUTHORITY_V2_CONSUMER_ROLLBACK'
$executePhrase = switch ($DeploymentShape) {
  'PlannerUpdate' { $plannerUpdatePhrase }
  'AuthorityV2ConsumerUpdate' { $authorityV2ConsumerUpdatePhrase }
  'AuthorityV2ConsumerRollback' { $authorityV2ConsumerRollbackPhrase }
  default { $initialCreatePhrase }
}
$deletePhrase = 'I_ACKNOWLEDGE_B5_J4C_PLAN_ONLY_BOOTSTRAP_DELETION'
$root = Split-Path -Parent $PSScriptRoot
$renderer = Join-Path $root 'scripts\render-b5-cell-bootstrap.mjs'
$legacyRenderer = Join-Path $root 'scripts\render-b5-cell-bootstrap-j4b-legacy.mjs'
$deployedJ4cRenderer = Join-Path $root 'scripts\render-b5-cell-bootstrap-j4c-deployed.mjs'
$authorityV2Renderer = Join-Path $root 'scripts\render-b5-cell-bootstrap-j5gg-v2.mjs'
$managementRenderer = Join-Path $root 'scripts\render-b5-cell-bootstrap-management.mjs'
$validator = Join-Path $root 'scripts\validate-b5-cell-bootstrap.mjs'
$templateVerifier = Join-Path $root 'scripts\verify-change-set-template.mjs'
$jsonVerifier = Join-Path $root 'scripts\verify-json-equality.mjs'

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
  param(
    [string]$AwsCli,
    [string[]]$Arguments,
    [switch]$AllowEmptyObject
  )
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed with exit code $LASTEXITCODE."
  }
  $text = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($text)) {
    if ($AllowEmptyObject) { return [PSCustomObject]@{} }
    throw 'AWS CLI returned empty JSON.'
  }
  return ($text | ConvertFrom-Json -DateKind String)
}

function Invoke-AwsJsonFile {
  param([string]$AwsCli, [string[]]$Arguments, [string]$OutputPath)
  $output = & $AwsCli @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed with exit code $LASTEXITCODE."
  }
  $text = (($output | Out-String).Trim())
  if ([string]::IsNullOrWhiteSpace($text)) { throw 'AWS CLI returned empty JSON.' }
  [System.IO.File]::WriteAllText($OutputPath, $text, [System.Text.UTF8Encoding]::new($false))
}

function Write-JsonFile {
  param([object]$Value, [string]$Path)
  [System.IO.File]::WriteAllText(
    $Path,
    ($Value | ConvertTo-Json -Depth 100 -Compress),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-CanonicalTemplateHash {
  param([string]$TemplatePath)
  $output = & node $templateVerifier --hash-template $TemplatePath
  if ($LASTEXITCODE -ne 0) { throw 'Unable to canonicalize the rendered template.' }
  $hash = (($output | Out-String).Trim())
  if ($hash -cnotmatch '^[a-f0-9]{64}$') { throw 'Canonical template digest is invalid.' }
  return $hash
}

function Get-TemplateDigests {
  param([string]$TemplatePath)
  $raw = (Get-FileHash -LiteralPath $TemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $canonical = Get-CanonicalTemplateHash -TemplatePath $TemplatePath
  return @{ Raw = $raw; Canonical = $canonical }
}

function Get-TemplateObjectContract {
  param([hashtable]$Digests)
  if (
    $Digests.Raw -cnotmatch '^[a-f0-9]{64}$' -or
    $Digests.Canonical -cnotmatch '^[a-f0-9]{64}$'
  ) { throw 'Template object contract requires exact raw and canonical SHA-256 values.' }
  $key = "$templateObjectKeyPrefix/$($Digests.Raw).json"
  return [PSCustomObject]@{
    Bucket = $templateBucketName
    Key = $key
    Url = "https://$templateBucketName.s3.$expectedRegion.amazonaws.com/$key"
    ChecksumSha256 = [Convert]::ToBase64String([Convert]::FromHexString($Digests.Raw))
  }
}

function Assert-ExactTemplateObject {
  param(
    [string]$AwsCli,
    [string]$ReviewedTemplatePath,
    [hashtable]$Digests,
    [string]$TemporaryDirectory
  )
  $contract = Get-TemplateObjectContract -Digests $Digests
  $head = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'head-object', '--profile', $ManagerProfile,
    '--region', $expectedRegion, '--expected-bucket-owner', $expectedAccountId,
    '--bucket', $contract.Bucket, '--key', $contract.Key,
    '--checksum-mode', 'ENABLED', '--output', 'json'
  )
  $metadataProperties = @($head.Metadata.PSObject.Properties)
  if (
    [long]$head.ContentLength -ne (Get-Item -LiteralPath $ReviewedTemplatePath).Length -or
    [string]$head.ContentType -cne 'application/json' -or
    [string]$head.ServerSideEncryption -cne 'AES256' -or
    [string]$head.ChecksumSHA256 -cne $contract.ChecksumSha256 -or
    $metadataProperties.Count -ne 2 -or
    [string]$head.Metadata.'raw-sha256' -cne $Digests.Raw -or
    [string]$head.Metadata.'canonical-sha256' -cne $Digests.Canonical
  ) { throw 'Digest-addressed child template object metadata drifted.' }
  $downloadPath = Join-Path $TemporaryDirectory 'downloaded-child-template.json'
  $download = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-object', '--profile', $ManagerProfile,
    '--region', $expectedRegion, '--expected-bucket-owner', $expectedAccountId,
    '--bucket', $contract.Bucket, '--key', $contract.Key,
    '--checksum-mode', 'ENABLED', $downloadPath, '--output', 'json'
  )
  if (
    [string]$download.ServerSideEncryption -cne 'AES256' -or
    [string]$download.ChecksumSHA256 -cne $contract.ChecksumSha256
  ) { throw 'Digest-addressed child template download metadata drifted.' }
  $downloadedDigests = Get-TemplateDigests -TemplatePath $downloadPath
  if (
    $downloadedDigests.Raw -cne $Digests.Raw -or
    $downloadedDigests.Canonical -cne $Digests.Canonical
  ) { throw 'Digest-addressed child template object content drifted.' }
  return $contract
}

function New-ReadOnlyTemplateSnapshot {
  param([string]$DestinationPath)
  $renderOutput = ((& node $renderer --output $DestinationPath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to render the B5-J4c plan-only Bootstrap.' }
  if ([string]::IsNullOrWhiteSpace($renderOutput)) {
    throw 'The B5-J4c renderer returned no confirmation.'
  }
  $item = Get-Item -LiteralPath $DestinationPath
  if ($item.Length -le 0 -or $item.Length -gt 51200) { throw 'Rendered template size is invalid.' }
  $item.IsReadOnly = $true
  return Get-TemplateDigests -TemplatePath $DestinationPath
}

function New-LegacyJ4bReadOnlyTemplateSnapshot {
  param([string]$DestinationPath)
  $renderOutput = ((& node $legacyRenderer --output $DestinationPath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to reconstruct the fixed legacy B5-J4b child snapshot.' }
  $item = Get-Item -LiteralPath $DestinationPath
  if ($item.Length -le 0 -or $item.Length -gt 51200) {
    throw 'Reconstructed legacy B5-J4b child snapshot size is invalid.'
  }
  $digests = Get-TemplateDigests -TemplatePath $DestinationPath
  if (
    $digests.Raw -cne '8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f' -or
    $digests.Canonical -cne '2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389'
  ) { throw 'Reconstructed legacy B5-J4b child snapshot failed its fixed digests.' }
  $item.IsReadOnly = $true
  return $digests
}

function New-DeployedJ4cReadOnlyTemplateSnapshot {
  param([string]$DestinationPath)
  $renderOutput = ((& node $deployedJ4cRenderer --output $DestinationPath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to reconstruct the fixed deployed B5-J4c child snapshot.' }
  $item = Get-Item -LiteralPath $DestinationPath
  if ($item.Length -le 0 -or $item.Length -gt 51200) {
    throw 'Reconstructed deployed B5-J4c child snapshot size is invalid.'
  }
  $digests = Get-TemplateDigests -TemplatePath $DestinationPath
  if (
    $digests.Raw -cne 'a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986' -or
    $digests.Canonical -cne '74379232124d94b1d2ffb4322edaecd0bdb0534444b8961295175ecadc06c09c'
  ) { throw 'Reconstructed deployed B5-J4c child snapshot failed its fixed digests.' }
  $item.IsReadOnly = $true
  return $digests
}

function New-AuthorityV2ReadOnlyTemplateSnapshot {
  param([string]$DestinationPath)
  $renderOutput = ((& node $authorityV2Renderer --output $DestinationPath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to reconstruct the fixed J5g-g authority-v2 child snapshot.' }
  $item = Get-Item -LiteralPath $DestinationPath
  if ($item.Length -le 0 -or $item.Length -gt 51200) {
    throw 'Reconstructed J5g-g authority-v2 child snapshot size is invalid.'
  }
  $digests = Get-TemplateDigests -TemplatePath $DestinationPath
  if (
    $digests.Raw -cne 'a768753c50de3fd3e13a1366ac5493768f794a0635c54274438c9606c1ad11e6' -or
    $digests.Canonical -cne '4f42f95d7e0b43b309d87acf2fb4795b136a1b40643d433e84606849d46d4673'
  ) { throw 'Reconstructed J5g-g authority-v2 child snapshot failed its fixed digests.' }
  $item.IsReadOnly = $true
  return $digests
}

function Assert-SnapshotUnchanged {
  param([string]$TemplatePath, [hashtable]$ExpectedDigests)
  $observed = Get-TemplateDigests -TemplatePath $TemplatePath
  if (
    $observed.Raw -cne $ExpectedDigests.Raw -or
    $observed.Canonical -cne $ExpectedDigests.Canonical
  ) { throw 'The immutable reviewed template snapshot changed during this operation.' }
}

function Assert-ConfirmedTemplateDigests {
  param([hashtable]$Digests)
  if ($ConfirmTemplateSha256 -cne $Digests.Raw) {
    throw 'AWS write requires the exact snapshot -ConfirmTemplateSha256.'
  }
  if ($ConfirmTemplateCanonicalSha256 -cne $Digests.Canonical) {
    throw 'AWS write requires the exact snapshot -ConfirmTemplateCanonicalSha256.'
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
  foreach ($name in @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN')) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      throw "Refusing AWS access while $name is set."
    }
  }
  foreach ($key in [Environment]::GetEnvironmentVariables().Keys) {
    if ([string]$key -imatch '^AWS_ENDPOINT_URL(?:_|$)') {
      throw "Refusing AWS access while endpoint override $key is set."
    }
  }
  $sections = Read-AwsSharedConfigSections
  foreach ($sectionName in @('default', "profile $expectedSourceProfile", "profile $expectedManagerProfile")) {
    $normalized = $sectionName.ToLowerInvariant()
    if (-not $sections.ContainsKey($normalized)) { continue }
    foreach ($line in $sections[$normalized]) {
      if ($line -imatch '^\s*(?:endpoint_url|services)\s*=') {
        throw "AWS config section $sectionName contains a forbidden endpoint override."
      }
    }
  }
}

function Assert-ExactSourceSession {
  param([string]$AwsCli)
  if ($SourceReadbackProfile -cne $expectedSourceProfile) {
    throw "Use only source profile $expectedSourceProfile."
  }
  $loginSession = ((& $AwsCli configure get login_session --profile $SourceReadbackProfile) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $loginSession -cne $expectedSourceArn) {
    throw "Source profile must declare login_session = $expectedSourceArn."
  }
  $inventory = ((& $AwsCli configure list --profile $SourceReadbackProfile) | Out-String)
  if (
    $LASTEXITCODE -ne 0 -or
    $inventory -cnotmatch '(?m)^\s*access_key\s*:\s*\S+\s*:\s*login\s*:' -or
    $inventory -cnotmatch '(?m)^\s*secret_key\s*:\s*\S+\s*:\s*login\s*:'
  ) { throw 'Source credentials must resolve only from AWS CLI login.' }
  $identity = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity', '--profile', $SourceReadbackProfile, '--output', 'json'
  )
  $region = ((& $AwsCli configure get region --profile $SourceReadbackProfile) | Out-String).Trim()
  if (
    [string]$identity.Account -cne $expectedAccountId -or
    [string]$identity.Arn -cne $expectedSourceArn -or
    $region -cne $expectedRegion
  ) { throw 'Source login identity, account, or region drifted.' }
  $mfa = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-mfa-devices', '--profile', $SourceReadbackProfile,
    '--user-name', $expectedSourceUserName, '--output', 'json'
  )
  $devices = @($mfa.MFADevices)
  if (
    $devices.Count -ne 1 -or
    [string]$devices[0].UserName -cne $expectedSourceUserName -or
    [string]$devices[0].SerialNumber -cne $expectedMfaDeviceArn
  ) { throw "Source user must retain exactly MFA device $expectedMfaDeviceArn." }
}

function Assert-ExactManagerSession {
  param([string]$AwsCli)
  if ($ManagerProfile -cne $expectedManagerProfile) {
    throw "Use only manager profile $expectedManagerProfile."
  }
  $roleArn = ((& $AwsCli configure get role_arn --profile $ManagerProfile) | Out-String).Trim()
  $sourceProfile = ((& $AwsCli configure get source_profile --profile $ManagerProfile) | Out-String).Trim()
  $sessionName = ((& $AwsCli configure get role_session_name --profile $ManagerProfile) | Out-String).Trim()
  $mfaSerial = ((& $AwsCli configure get mfa_serial --profile $ManagerProfile) | Out-String).Trim()
  $region = ((& $AwsCli configure get region --profile $ManagerProfile) | Out-String).Trim()
  if (
    $roleArn -cne $managerRoleArn -or
    $sourceProfile -cne $expectedSourceProfile -or
    $sessionName -cne 'techlong-sandbox-cell-bootstrap-manager' -or
    $mfaSerial -cne $expectedMfaDeviceArn -or
    $region -cne $expectedRegion
  ) { throw 'Manager profile role, source, session name, MFA device, or region drifted.' }
  $identity = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity', '--profile', $ManagerProfile, '--output', 'json'
  )
  if (
    [string]$identity.Account -cne $expectedAccountId -or
    [string]$identity.Arn -cne $managerSessionArn
  ) { throw "Manager identity must be exactly $managerSessionArn." }
}

function Get-StackOrNull {
  param([string]$AwsCli, [string]$Profile, [string]$StackName)
  $output = & $AwsCli cloudformation describe-stacks --profile $Profile --region $expectedRegion `
    --stack-name $StackName --output json 2>&1
  if ($LASTEXITCODE -eq 0) {
    $response = (($output | Out-String).Trim()) | ConvertFrom-Json -DateKind String
    if (@($response.Stacks).Count -ne 1) { throw "Stack readback for $StackName was not singular." }
    return $response.Stacks[0]
  }
  $errorText = ($output | Out-String)
  if ($errorText -match 'ValidationError' -and $errorText -match 'does not exist') { return $null }
  throw "Unable to determine whether Stack $StackName exists."
}

function Convert-TemplateBodyToObject {
  param([object]$TemplateBody)
  if ($TemplateBody -is [string]) {
    return ($TemplateBody | ConvertFrom-Json -DateKind String)
  }
  return $TemplateBody
}

function Assert-ManagementState {
  param(
    [string]$AwsCli,
    [string[]]$AllowedStates,
    [string]$ExpectedChangeSetName = '',
    [string]$ExpectedTemplateSha256 = '',
    [string]$TemporaryDirectory
  )
  $stack = Get-StackOrNull -AwsCli $AwsCli -Profile $SourceReadbackProfile -StackName $managementStackName
  if (
    $null -eq $stack -or
    [string]$stack.StackName -cne $managementStackName -or
    [string]$stack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE') -or
    -not [string]::IsNullOrEmpty([string]$stack.RoleARN)
  ) { throw 'The exact source-controlled B5-J4c management Stack is unavailable.' }
  $tags = @{}
  foreach ($tag in @($stack.Tags)) { $tags[[string]$tag.Key] = [string]$tag.Value }
  if (
    $tags.Count -ne 3 -or
    $tags.Environment -cne 'aws-sandbox' -or
    $tags.ManagedBy -cne 'techlong-cell-bootstrap-manager' -or
    $tags.Component -cne 'b5-cell-bootstrap-management'
  ) { throw 'Management Stack ownership tags drifted.' }
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--stack-name', $managementStackName,
    '--template-stage', 'Original', '--output', 'json'
  )
  $body = Convert-TemplateBodyToObject -TemplateBody $response.TemplateBody
  $state = [string]$body.Metadata.SafetyBoundary.ManagerGrantState
  if ($state -cnotin $AllowedStates) {
    throw "Management Stack grant state $state is not one of: $($AllowedStates -join ', ')."
  }
  if ($state -cne 'LOCKED') {
    if ([string]$body.Metadata.SafetyBoundary.GrantExpiresAt -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') {
      throw 'Temporary management grant expiry is not canonical UTC.'
    }
    $expiry = [DateTimeOffset]::ParseExact(
      [string]$body.Metadata.SafetyBoundary.GrantExpiresAt,
      'yyyy-MM-ddTHH:mm:ss.fffZ',
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal
    )
    if ($expiry -le [DateTimeOffset]::UtcNow.AddMinutes(1)) {
      throw 'Temporary management grant is expired or too close to expiry.'
    }
  }
  if (
    $state -in @('AUTHORGRANT', 'EXECUTEGRANT') -and
    [string]$body.Metadata.SafetyBoundary.ApprovedChangeSetName -cne $ExpectedChangeSetName
  ) { throw 'Management grant is not bound to the exact digest-derived Change Set name.' }
  if (
    $state -in @('AUTHORGRANT', 'EXECUTEGRANT') -and
    [string]$body.Metadata.SafetyBoundary.ApprovedTemplateSha256 -cne $ExpectedTemplateSha256
  ) { throw 'Management grant is not bound to the exact child template SHA-256.' }

  $shape = switch ($state) {
    'LOCKED' { 'Locked' }
    'AUTHORGRANT' { 'AuthorGrant' }
    'EXECUTEGRANT' { 'ExecuteGrant' }
    'ROLLBACKGRANT' { 'RollbackGrant' }
    default { throw "Unsupported management grant state $state." }
  }
  $expectedPath = Join-Path $TemporaryDirectory 'expected-management-template.json'
  $actualPath = Join-Path $TemporaryDirectory 'actual-management-template.json'
  $rendererArguments = @(
    $managementRenderer,
    '--shape', $shape,
    '--output', $expectedPath
  )
  if ($state -in @('AUTHORGRANT', 'EXECUTEGRANT')) {
    $rendererArguments += @(
      '--approved-change-set-name', ([string]$body.Metadata.SafetyBoundary.ApprovedChangeSetName),
      '--approved-template-sha256', ([string]$body.Metadata.SafetyBoundary.ApprovedTemplateSha256),
      '--grant-expires-at', ([string]$body.Metadata.SafetyBoundary.GrantExpiresAt)
    )
  } elseif ($state -eq 'ROLLBACKGRANT') {
    $rendererArguments += @(
      '--grant-expires-at', ([string]$body.Metadata.SafetyBoundary.GrantExpiresAt)
    )
  }
  $renderOutput = ((& node @rendererArguments) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to render the expected management template.' }
  if ([string]::IsNullOrWhiteSpace($renderOutput)) {
    throw 'Management renderer returned no confirmation.'
  }
  Write-JsonFile -Value $body -Path $actualPath
  $managementHash = ((& node $jsonVerifier --expected $expectedPath --actual $actualPath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $managementHash -cnotmatch '^[a-f0-9]{64}$') {
    throw 'The live management template is not exactly source controlled.'
  }

  $inventory = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stack-resources', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--stack-name', $managementStackName, '--output', 'json'
  )
  if (-not [string]::IsNullOrEmpty([string]$inventory.NextToken)) {
    throw 'Unexpected pagination in the eight-resource management Stack inventory.'
  }
  $expectedResources = @{
    CellJanitorBoundary = @('AWS::IAM::ManagedPolicy', $janitorBoundaryArn)
    CellSchedulerInvokeBoundary = @('AWS::IAM::ManagedPolicy', $schedulerBoundaryArn)
    CellJanitorExecutionRole = @('AWS::IAM::Role', 'TechlongSandboxCellJanitorExecutionRole')
    CellSchedulerInvokeRole = @('AWS::IAM::Role', 'TechlongSandboxCellSchedulerInvokeRole')
    CellBootstrapManagerBoundary = @('AWS::IAM::ManagedPolicy', 'arn:aws:iam::402010193138:policy/TechlongSandboxCellBootstrapManagerBoundary')
    CellBootstrapManagerRole = @('AWS::IAM::Role', 'TechlongSandboxCellBootstrapManagerRole')
    CellBootstrapExecutionBoundary = @('AWS::IAM::ManagedPolicy', 'arn:aws:iam::402010193138:policy/TechlongSandboxCellBootstrapCloudFormationExecutionBoundary')
    CellBootstrapExecutionRole = @('AWS::IAM::Role', 'TechlongSandboxCellBootstrapCloudFormationExecutionRole')
  }
  $resources = @($inventory.StackResourceSummaries)
  if ($resources.Count -ne $expectedResources.Count) {
    throw 'Management Stack resource inventory count drifted.'
  }
  $seen = @{}
  foreach ($resource in $resources) {
    $logicalId = [string]$resource.LogicalResourceId
    if (-not $expectedResources.ContainsKey($logicalId) -or $seen.ContainsKey($logicalId)) {
      throw "Unexpected or duplicate management Stack resource $logicalId."
    }
    $seen[$logicalId] = $true
    if (
      [string]$resource.ResourceType -cne $expectedResources[$logicalId][0] -or
      [string]$resource.PhysicalResourceId -cne $expectedResources[$logicalId][1] -or
      [string]$resource.ResourceStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')
    ) { throw "Management Stack resource $logicalId drifted." }
  }
  Write-Host "Exact management template and eight-resource inventory passed: $managementHash"
  return $body
}

function Assert-WriteAcknowledgements {
  param([switch]$Delete)
  if ($ConfirmAccountId -cne $expectedAccountId) { throw "AWS write requires -ConfirmAccountId $expectedAccountId." }
  if ($ConfirmRegion -cne $expectedRegion) { throw "AWS write requires -ConfirmRegion $expectedRegion." }
  if ($ConfirmBootstrapStackName -cne $bootstrapStackName) {
    throw "AWS write requires -ConfirmBootstrapStackName $bootstrapStackName."
  }
  if (-not $AcknowledgeAwsWrite) { throw 'AWS write requires -AcknowledgeAwsWrite.' }
  if (-not $AcknowledgeLowCostNotFree) { throw 'AWS write requires -AcknowledgeLowCostNotFree.' }
  if (-not $AcknowledgeCleanupOnlyNoCell) {
    throw 'AWS write requires -AcknowledgeCleanupOnlyNoCell.'
  }
  if (-not $AcknowledgeManagerMfaSession) {
    throw 'AWS write requires -AcknowledgeManagerMfaSession.'
  }
  if ($Delete) {
    if ($ConfirmExecutionPhrase -cne $deletePhrase) {
      throw "Delete requires -ConfirmExecutionPhrase $deletePhrase."
    }
    if (-not $AcknowledgeDeleteJanitorLogs) { throw 'Delete requires -AcknowledgeDeleteJanitorLogs.' }
    if (-not $AcknowledgeTwoLowCostLambdaInvocations) {
      throw 'Delete requires -AcknowledgeTwoLowCostLambdaInvocations for the final empty probes.'
    }
  } elseif ($Mode -eq 'ExecuteChangeSet') {
    if (-not $AcknowledgeChangeSetReviewed) {
      throw 'ExecuteChangeSet requires -AcknowledgeChangeSetReviewed.'
    }
    if ($ConfirmExecutionPhrase -cne $executePhrase) {
      throw "ExecuteChangeSet for $DeploymentShape requires -ConfirmExecutionPhrase $executePhrase."
    }
  }
}

function Assert-ConfirmedStackId {
  if ($ConfirmStackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/[a-f0-9-]{36}$') {
    throw 'The exact B5-J4c -ConfirmStackId is required.'
  }
}

function Assert-NamedResourceAbsent {
  param([string]$AwsCli, [string[]]$Arguments, [string]$MissingPattern, [string]$Label)
  $output = & $AwsCli @Arguments 2>&1
  if ($LASTEXITCODE -eq 0) { throw "$Label already exists." }
  if (($output | Out-String) -notmatch $MissingPattern) {
    throw "Unable to prove that $Label is absent."
  }
}

function Assert-BootstrapNamedResourcesAbsent {
  param([string]$AwsCli)
  foreach ($roleName in @(
    'TechlongSandboxCellOperatorRole',
    'TechlongSandboxCellCloudFormationExecutionRole'
  )) {
    Assert-NamedResourceAbsent -AwsCli $AwsCli -Arguments @(
      'iam', 'get-role', '--profile', $SourceReadbackProfile, '--role-name', $roleName, '--output', 'json'
    ) -MissingPattern 'NoSuchEntity' -Label "IAM role $roleName"
  }
  foreach ($policyName in @(
    'TechlongSandboxCellOperatorBoundary',
    'TechlongSandboxCellCloudFormationExecutionBoundary'
  )) {
    $arn = "arn:aws:iam::$expectedAccountId`:policy/$policyName"
    Assert-NamedResourceAbsent -AwsCli $AwsCli -Arguments @(
      'iam', 'get-policy', '--profile', $SourceReadbackProfile, '--policy-arn', $arn, '--output', 'json'
    ) -MissingPattern 'NoSuchEntity' -Label "IAM policy $policyName"
  }
  Assert-NamedResourceAbsent -AwsCli $AwsCli -Arguments @(
    'lambda', 'get-function', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--function-name', 'techlong-sandbox-cell-janitor', '--output', 'json'
  ) -MissingPattern 'ResourceNotFoundException' -Label 'Cell Janitor Lambda'
  $groups = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-log-groups', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--log-group-name-prefix', '/aws/lambda/techlong-sandbox-cell-janitor', '--output', 'json'
  )
  if (@($groups.logGroups).Count -ne 0) { throw 'Cell Janitor LogGroup already exists.' }
  Assert-NamedResourceAbsent -AwsCli $AwsCli -Arguments @(
    'scheduler', 'get-schedule-group', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--name', 'techlong-sandbox-cell', '--output', 'json'
  ) -MissingPattern 'ResourceNotFoundException' -Label 'Cell Scheduler group'
}

function Assert-PaidCellAndTenantResourcesAbsent {
  param([string]$AwsCli)
  if ($null -ne (Get-StackOrNull -AwsCli $AwsCli -Profile $SourceReadbackProfile -StackName $approvedCellStackName)) {
    throw "Paid Cell Stack $approvedCellStackName must remain absent."
  }
  $clusters = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'ecs', 'describe-clusters', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--clusters', $approvedClusterName, '--include', 'TAGS', '--output', 'json'
  )
  if (@($clusters.clusters).Count -ne 0 -or @($clusters.failures).Count -ne 1) {
    throw "ECS Cluster $approvedClusterName must be exactly MISSING."
  }
  $dbClusters = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'rds', 'describe-db-clusters', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--query', "DBClusters[?DBClusterIdentifier=='techlong-sandbox-cell-sandbox-1']", '--output', 'json'
  )
  $dbInstances = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'rds', 'describe-db-instances', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--query', "DBInstances[?DBInstanceIdentifier=='techlong-sandbox-cell-sandbox-1-writer']", '--output', 'json'
  )
  if (@($dbClusters).Count -ne 0 -or @($dbInstances).Count -ne 0) {
    throw 'Aurora Cell resources must remain absent.'
  }
  $loadBalancers = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'elbv2', 'describe-load-balancers', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--query', "LoadBalancers[?contains(LoadBalancerName, 'cell-sandbox-1')]", '--output', 'json'
  )
  if (@($loadBalancers).Count -ne 0) { throw 'Cell load balancers must remain absent.' }
  $vpcs = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'ec2', 'describe-vpcs', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--filters', 'Name=tag:CellId,Values=cell-sandbox-1', '--output', 'json'
  )
  if (@($vpcs.Vpcs).Count -ne 0) { throw 'Cell-tagged VPCs must remain absent.' }
  $summaries = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stacks', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--stack-status-filter', 'CREATE_IN_PROGRESS', 'CREATE_COMPLETE', 'ROLLBACK_IN_PROGRESS',
    'ROLLBACK_FAILED', 'ROLLBACK_COMPLETE', 'DELETE_FAILED', 'UPDATE_IN_PROGRESS',
    'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_COMPLETE', 'UPDATE_FAILED',
    'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED',
    'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_ROLLBACK_COMPLETE',
    '--output', 'json'
  )
  foreach ($summary in @($summaries.StackSummaries)) {
    $name = [string]$summary.StackName
    if ($name -notmatch '^techlong-sandbox-tenant-[a-z0-9]{1,16}$') { continue }
    $tenantStack = Get-StackOrNull -AwsCli $AwsCli -Profile $SourceReadbackProfile -StackName $name
    $tags = @{}
    foreach ($tag in @($tenantStack.Tags)) { $tags[[string]$tag.Key] = [string]$tag.Value }
    if ($tags.CellId -ceq 'cell-sandbox-1') {
      throw "Owned tenant Stack $name must be removed before B5-J4c management."
    }
  }
}

function Get-ExactLambdaConfigurationAndVerifyInlineCode {
  param(
    [string]$AwsCli,
    [string]$ReviewedTemplatePath,
    [string]$TemporaryDirectory,
    [string]$ExpectedStackId
  )
  $before = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'lambda', 'get-function', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--function-name', 'techlong-sandbox-cell-janitor', '--output', 'json'
  )
  $configuration = $before.Configuration
  $codeLocation = [string]$before.Code.Location
  [Uri]$codeUri = $null
  if (-not [Uri]::TryCreate($codeLocation, [UriKind]::Absolute, [ref]$codeUri)) {
    throw 'Cell Janitor Lambda code location is not an absolute URI.'
  }
  if (
    $codeUri.Scheme -cne 'https' -or
    -not $codeUri.DnsSafeHost.EndsWith('.amazonaws.com', [StringComparison]::OrdinalIgnoreCase)
  ) { throw 'Cell Janitor Lambda code location is outside the exact AWS HTTPS boundary.' }
  if (
    [string]$before.Code.RepositoryType -cne 'S3' -or
    -not [string]::IsNullOrEmpty([string]$before.CodeSigningConfigArn)
  ) { throw 'Cell Janitor Lambda code repository or signing configuration drifted.' }
  $requiredBusinessTags = [System.Collections.Generic.Dictionary[string,string]]::new(
    [StringComparer]::Ordinal
  )
  $requiredBusinessTags.Add('Environment', 'aws-sandbox')
  $requiredBusinessTags.Add('ManagedBy', 'techlong-cell-bootstrap-manager')
  $requiredBusinessTags.Add('Component', 'cell-janitor')
  $allowedCloudFormationTags = [System.Collections.Generic.Dictionary[string,string]]::new(
    [StringComparer]::Ordinal
  )
  $allowedCloudFormationTags.Add('aws:cloudformation:logical-id', 'CellJanitorFunction')
  $allowedCloudFormationTags.Add('aws:cloudformation:stack-id', $ExpectedStackId)
  $allowedCloudFormationTags.Add('aws:cloudformation:stack-name', $bootstrapStackName)
  $observedLambdaTags = [System.Collections.Generic.Dictionary[string,string]]::new(
    [StringComparer]::Ordinal
  )
  foreach ($property in @($before.Tags.PSObject.Properties)) {
    $key = [string]$property.Name
    if ($observedLambdaTags.ContainsKey($key)) {
      throw "Duplicate Cell Janitor Lambda tag $key."
    }
    $observedLambdaTags[$key] = [string]$property.Value
  }
  foreach ($key in $requiredBusinessTags.Keys) {
    if (
      -not $observedLambdaTags.ContainsKey($key) -or
      $observedLambdaTags[$key] -cne $requiredBusinessTags[$key]
    ) { throw "Required Cell Janitor Lambda business tag $key drifted." }
  }
  foreach ($key in $observedLambdaTags.Keys) {
    if ($requiredBusinessTags.ContainsKey($key)) { continue }
    if (
      -not $allowedCloudFormationTags.ContainsKey($key) -or
      $observedLambdaTags[$key] -cne $allowedCloudFormationTags[$key]
    ) { throw "Unexpected or drifted Cell Janitor Lambda tag $key." }
  }

  $reviewedTemplate = Get-Content -Raw -LiteralPath $ReviewedTemplatePath | ConvertFrom-Json -Depth 100
  $expectedSource = [string]$reviewedTemplate.Resources.CellJanitorFunction.Properties.Code.ZipFile
  if ([string]::IsNullOrEmpty($expectedSource)) {
    throw 'Reviewed Cell Janitor inline source is missing.'
  }
  $expectedSourceBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($expectedSource)
  if ($expectedSourceBytes.Length -gt 51200) {
    throw 'Reviewed Cell Janitor inline source exceeds the direct-body boundary.'
  }
  $zipPath = Join-Path $TemporaryDirectory "lambda-code-$([Guid]::NewGuid().ToString('N')).zip"
  try {
    Invoke-WebRequest -Uri $codeUri -OutFile $zipPath -MaximumRedirection 0 `
      -ConnectionTimeoutSeconds 20 -OperationTimeoutSeconds 20
  } catch {
    throw 'Unable to download the exact Cell Janitor Lambda code artifact.'
  }
  $zipItem = Get-Item -LiteralPath $zipPath
  if ($zipItem.Length -le 0 -or $zipItem.Length -gt 1048576) {
    throw 'Downloaded Cell Janitor Lambda ZIP size is outside the reviewed boundary.'
  }
  if ([long]$configuration.CodeSize -ne [long]$zipItem.Length) {
    throw 'Downloaded Cell Janitor Lambda ZIP size drifted from AWS configuration.'
  }
  $zipBytes = [System.IO.File]::ReadAllBytes($zipPath)
  $observedCodeSha256 = [Convert]::ToBase64String(
    [System.Security.Cryptography.SHA256]::HashData($zipBytes)
  )
  if ($observedCodeSha256 -cne [string]$configuration.CodeSha256) {
    throw 'Downloaded Cell Janitor Lambda ZIP SHA-256 drifted from AWS configuration.'
  }

  $archive = $null
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $entries = @($archive.Entries)
    if ($entries.Count -ne 1 -or [string]$entries[0].FullName -cne 'index.js') {
      throw 'Cell Janitor Lambda ZIP must contain exactly the reviewed index.js entry.'
    }
    if (
      [long]$entries[0].Length -ne [long]$expectedSourceBytes.Length -or
      [long]$entries[0].Length -gt 51200
    ) { throw 'Cell Janitor Lambda index.js uncompressed length drifted.' }
    $stream = $entries[0].Open()
    try {
      $observedSourceBytes = [byte[]]::new($expectedSourceBytes.Length)
      $offset = 0
      while ($offset -lt $observedSourceBytes.Length) {
        $read = $stream.Read(
          $observedSourceBytes,
          $offset,
          $observedSourceBytes.Length - $offset
        )
        if ($read -eq 0) { break }
        $offset += $read
      }
      if ($offset -ne $observedSourceBytes.Length -or $stream.ReadByte() -ne -1) {
        throw 'Cell Janitor Lambda index.js exceeded or did not fill its exact byte boundary.'
      }
    } finally {
      $stream.Dispose()
    }
    if (
      $observedSourceBytes.Length -ne $expectedSourceBytes.Length -or
      [Convert]::ToBase64String($observedSourceBytes) -cne [Convert]::ToBase64String($expectedSourceBytes)
    ) { throw 'Deployed Cell Janitor index.js bytes are not the exact reviewed inline source.' }
  } finally {
    if ($null -ne $archive) { $archive.Dispose() }
  }

  $after = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'lambda', 'get-function-configuration', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--function-name', 'techlong-sandbox-cell-janitor', '--output', 'json'
  )
  if (
    [string]$configuration.RevisionId -cne [string]$after.RevisionId -or
    [string]$configuration.CodeSha256 -cne [string]$after.CodeSha256
  ) { throw 'Cell Janitor Lambda changed during exact code readback.' }
  Write-Host "Exact deployed Lambda ZIP and index.js bytes passed: $observedCodeSha256"
  return $after
}

function Assert-ExactLegacyJ4bChildStack {
  param(
    [string]$AwsCli,
    [string]$LegacyTemplatePath,
    [hashtable]$LegacyDigests,
    [string]$TemporaryDirectory
  )
  $stack = Get-StackOrNull -AwsCli $AwsCli -Profile $SourceReadbackProfile -StackName $bootstrapStackName
  if (
    $null -eq $stack -or
    [string]$stack.StackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/[a-f0-9-]{36}$' -or
    [string]$stack.StackName -cne $bootstrapStackName -or
    [string]$stack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE') -or
    [string]$stack.RoleARN -cne $bootstrapExecutionRoleArn -or
    $stack.EnableTerminationProtection -eq $true -or
    -not [string]::IsNullOrEmpty([string]$stack.ParentId) -or
    -not [string]::IsNullOrEmpty([string]$stack.RootId)
  ) { throw 'The exact legacy B5-J4b child Stack is unavailable for PlannerUpdate.' }
  if ($null -ne $stack.Capabilities -and @($stack.Capabilities).Count -ne 0) {
    throw 'The legacy non-IAM B5-J4b child Stack must declare zero capabilities.'
  }
  $parameters = @{}
  foreach ($parameter in @($stack.Parameters)) {
    $parameters[[string]$parameter.ParameterKey] = [string]$parameter.ParameterValue
  }
  if (
    $parameters.Count -ne 2 -or
    $parameters.ExpectedAccountId -cne $expectedAccountId -or
    $parameters.ExpectedRegion -cne $expectedRegion
  ) { throw 'Legacy B5-J4b child Stack parameters drifted.' }
  Assert-BusinessTags -Tags @($stack.Tags) -Component 'b5-cell-bootstrap'
  $outputs = @{}
  foreach ($output in @($stack.Outputs)) {
    $outputs[[string]$output.OutputKey] = [string]$output.OutputValue
  }
  if (
    $outputs.Count -ne 5 -or
    $outputs.CellJanitorFunctionArn -cne 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' -or
    $outputs.CellSchedulerInvokeRoleArn -cne $schedulerRoleArn -or
    $outputs.CellSchedulerGroupName -cne 'techlong-sandbox-cell' -or
    $outputs.ApprovedCellStackName -cne $approvedCellStackName -or
    $outputs.SafetyState -cne 'B5_J4B_EMPTY_SCAN_ONLY_CELL_APPLY_AND_DELETE_DISABLED'
  ) { throw 'Legacy B5-J4b child Stack outputs drifted.' }

  $inventory = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stack-resources', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--stack-name', ([string]$stack.StackId), '--output', 'json'
  )
  if (-not [string]::IsNullOrEmpty([string]$inventory.NextToken)) {
    throw 'Legacy B5-J4b child resource inventory unexpectedly paginated.'
  }
  $expectedResources = @{
    CellJanitorLogGroup = @('AWS::Logs::LogGroup', '/aws/lambda/techlong-sandbox-cell-janitor')
    CellJanitorFunction = @('AWS::Lambda::Function', 'techlong-sandbox-cell-janitor')
    CellSchedulerGroup = @('AWS::Scheduler::ScheduleGroup', 'techlong-sandbox-cell')
    CellGlobalJanitorSchedule = @('AWS::Scheduler::Schedule', '')
  }
  $seen = @{}
  foreach ($resource in @($inventory.StackResourceSummaries)) {
    $logicalId = [string]$resource.LogicalResourceId
    if (-not $expectedResources.ContainsKey($logicalId) -or $seen.ContainsKey($logicalId)) {
      throw "Legacy B5-J4b child contains unexpected or duplicate resource $logicalId."
    }
    if (
      [string]$resource.ResourceType -cne $expectedResources[$logicalId][0] -or
      [string]$resource.ResourceStatus -cne 'CREATE_COMPLETE' -or
      [string]::IsNullOrWhiteSpace([string]$resource.PhysicalResourceId)
    ) { throw "Legacy B5-J4b child resource $logicalId drifted." }
    if (
      -not [string]::IsNullOrEmpty($expectedResources[$logicalId][1]) -and
      [string]$resource.PhysicalResourceId -cne $expectedResources[$logicalId][1]
    ) { throw "Legacy B5-J4b child physical resource $logicalId drifted." }
    if (
      $logicalId -eq 'CellGlobalJanitorSchedule' -and
      [string]$resource.PhysicalResourceId -cnotmatch '^(?:arn:aws:scheduler:ca-central-1:402010193138:schedule/techlong-sandbox-cell/)?techlong-sandbox-cell-global-janitor$'
    ) { throw 'Legacy B5-J4b child Schedule physical ID drifted.' }
    $seen[$logicalId] = $true
  }
  if ($seen.Count -ne $expectedResources.Count) {
    throw 'Legacy B5-J4b child resource inventory is incomplete.'
  }

  $templateResponsePath = Join-Path $TemporaryDirectory 'legacy-j4b-stack-template.json'
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--stack-name', ([string]$stack.StackId),
    '--template-stage', 'Original', '--output', 'json'
  ) -OutputPath $templateResponsePath
  $verified = ((& node $templateVerifier --expected-template $LegacyTemplatePath `
    --get-template-response $templateResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verified -cne $LegacyDigests.Canonical) {
    throw 'Deployed child template is not the fixed legacy B5-J4b snapshot.'
  }
  Assert-SnapshotUnchanged -TemplatePath $LegacyTemplatePath -ExpectedDigests $LegacyDigests

  $lambda = Get-ExactLambdaConfigurationAndVerifyInlineCode -AwsCli $AwsCli `
    -ReviewedTemplatePath $LegacyTemplatePath -TemporaryDirectory $TemporaryDirectory `
    -ExpectedStackId ([string]$stack.StackId)
  $legacyEnvironment = @{
    EXPECTED_ACCOUNT_ID = $expectedAccountId
    EXPECTED_REGION = $expectedRegion
    EXPECTED_CELL_ID = 'cell-sandbox-1'
    CELL_MUTATION_ENABLED = 'false'
  }
  Assert-JsonEqualObjects -Expected $legacyEnvironment -Actual $lambda.Environment.Variables `
    -Label 'legacy B5-J4b Janitor environment' -TemporaryDirectory $TemporaryDirectory | Out-Null
  if (
    [string]$lambda.Role -cne $janitorRoleArn -or
    [string]$lambda.State -cne 'Active' -or
    [string]$lambda.LastUpdateStatus -cne 'Successful'
  ) { throw 'Legacy B5-J4b Janitor runtime is not stable and exact.' }

  $schedule = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'scheduler', 'get-schedule', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--group-name', 'techlong-sandbox-cell',
    '--name', 'techlong-sandbox-cell-global-janitor', '--output', 'json'
  )
  if (
    [string]$schedule.State -cne 'DISABLED' -or
    [string]$schedule.Target.Input -cne '{"schemaVersion":1,"action":"inspect_empty_shared_cell_inventory"}' -or
    [string]$schedule.Target.Arn -cne 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' -or
    [string]$schedule.Target.RoleArn -cne $schedulerRoleArn
  ) { throw 'Legacy B5-J4b disabled Schedule drifted.' }
  return $stack
}

function Assert-ExactDeployedJ4cChildStack {
  param(
    [string]$AwsCli,
    [string]$DeployedTemplatePath,
    [hashtable]$DeployedDigests,
    [string]$TemporaryDirectory,
    [object]$ManagementTemplate
  )
  $stack = Get-StackOrNull -AwsCli $AwsCli -Profile $SourceReadbackProfile -StackName $bootstrapStackName
  if (
    $null -eq $stack -or
    [string]$stack.StackStatus -cne 'UPDATE_COMPLETE'
  ) {
    throw 'The exact deployed B5-J4c child Stack is unavailable for AuthorityV2ConsumerUpdate.'
  }
  Assert-ExactStackAndResources -AwsCli $AwsCli -ExpectedStackId ([string]$stack.StackId) `
    -ReviewedTemplatePath $DeployedTemplatePath -Digests $DeployedDigests `
    -TemporaryDirectory $TemporaryDirectory -ManagementTemplate $ManagementTemplate | Out-Null
  Assert-SnapshotUnchanged -TemplatePath $DeployedTemplatePath -ExpectedDigests $DeployedDigests
  return $stack
}

function Assert-ExactAuthorityV2ConsumerChildStack {
  param(
    [string]$AwsCli,
    [string]$AuthorityV2TemplatePath,
    [hashtable]$AuthorityV2Digests,
    [string]$TemporaryDirectory,
    [object]$ManagementTemplate
  )
  $stack = Get-StackOrNull -AwsCli $AwsCli -Profile $SourceReadbackProfile -StackName $bootstrapStackName
  if (
    $null -eq $stack -or
    [string]$stack.StackStatus -cne 'UPDATE_COMPLETE'
  ) {
    throw 'The exact authority-v2 consumer child Stack is unavailable for AuthorityV2ConsumerRollback.'
  }
  Assert-ExactStackAndResources -AwsCli $AwsCli -ExpectedStackId ([string]$stack.StackId) `
    -ReviewedTemplatePath $AuthorityV2TemplatePath -Digests $AuthorityV2Digests `
    -TemporaryDirectory $TemporaryDirectory -ManagementTemplate $ManagementTemplate | Out-Null
  Assert-SnapshotUnchanged -TemplatePath $AuthorityV2TemplatePath -ExpectedDigests $AuthorityV2Digests
  return $stack
}

function Assert-ExactChangeSetTemplate {
  param(
    [string]$AwsCli,
    [string]$ChangeSetName,
    [string]$ReviewedTemplatePath,
    [string]$ExpectedCanonicalHash,
    [string]$ResponsePath
  )
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName, '--change-set-name', $ChangeSetName,
    '--template-stage', 'Original', '--output', 'json'
  ) -OutputPath $ResponsePath
  $verified = ((& node $templateVerifier --expected-template $ReviewedTemplatePath `
    --get-template-response $ResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verified -cne $ExpectedCanonicalHash) {
    throw 'Change Set TemplateBody is not the exact reviewed snapshot.'
  }
}

function Assert-ReviewedChangeSet {
  param(
    [string]$AwsCli,
    [string]$ChangeSetName,
    [string]$ExpectedDescription,
    [string]$ReviewedTemplatePath,
    [hashtable]$Digests,
    [string]$TemporaryDirectory
  )
  $changeSet = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'describe-change-set', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--stack-name', $bootstrapStackName,
    '--change-set-name', $ChangeSetName, '--include-property-values', '--output', 'json'
  )
  $metadataFailures = [System.Collections.Generic.List[string]]::new()
  if ([string]$changeSet.StackName -cne $bootstrapStackName) { $metadataFailures.Add('stack_name') }
  if ([string]$changeSet.ChangeSetName -cne $ChangeSetName) { $metadataFailures.Add('change_set_name') }
  if ([string]$changeSet.ChangeSetId -cnotmatch "^arn:aws:cloudformation:ca-central-1:402010193138:changeSet/$([regex]::Escape($ChangeSetName))/[a-f0-9-]{36}$") { $metadataFailures.Add('change_set_id') }
  if ([string]$changeSet.StackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/[a-f0-9-]{36}$') { $metadataFailures.Add('stack_id') }
  if ([string]$changeSet.Status -cne 'CREATE_COMPLETE') { $metadataFailures.Add('status') }
  if ([string]$changeSet.ExecutionStatus -cne 'AVAILABLE') { $metadataFailures.Add('execution_status') }
  if ([string]$changeSet.Description -cne $ExpectedDescription) { $metadataFailures.Add('description') }
  if (@($changeSet.NotificationARNs).Count -ne 0) { $metadataFailures.Add('notifications') }
  if (-not [string]::IsNullOrEmpty([string]$changeSet.ParentChangeSetId)) { $metadataFailures.Add('parent') }
  if (-not [string]::IsNullOrEmpty([string]$changeSet.RootChangeSetId)) { $metadataFailures.Add('root') }
  if ($changeSet.IncludeNestedStacks -ne $false) { $metadataFailures.Add('nested') }
  if ($changeSet.ImportExistingResources -eq $true) { $metadataFailures.Add('import') }
  if (
    ($DeploymentShape -eq 'InitialCreate' -and [string]$changeSet.OnStackFailure -cne 'DELETE') -or
    ($DeploymentShape -ne 'InitialCreate' -and -not [string]::IsNullOrEmpty([string]$changeSet.OnStackFailure))
  ) { $metadataFailures.Add('on_stack_failure') }
  $rollbackTriggerProperty = $changeSet.RollbackConfiguration.PSObject.Properties['RollbackTriggers']
  if ($null -ne $rollbackTriggerProperty -and @($rollbackTriggerProperty.Value).Count -ne 0) {
    $metadataFailures.Add('rollback_triggers')
  }
  if ($changeSet.DeploymentConfig.Mode -and [string]$changeSet.DeploymentConfig.Mode -cne 'STANDARD') { $metadataFailures.Add('deployment_mode') }
  if ($changeSet.DeploymentConfig.DisableRollback -eq $true) { $metadataFailures.Add('rollback_disabled') }
  if ($metadataFailures.Count -ne 0) {
    throw "Change Set metadata drifted: $($metadataFailures -join ', ')."
  }
  $stackResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'describe-stacks', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--stack-name', ([string]$changeSet.StackId), '--output', 'json'
  )
  $stacks = @($stackResponse.Stacks)
  $expectedStackStatus = switch ($DeploymentShape) {
    'InitialCreate' { 'REVIEW_IN_PROGRESS' }
    'PlannerUpdate' { 'CREATE_COMPLETE' }
    'AuthorityV2ConsumerUpdate' { 'UPDATE_COMPLETE' }
    'AuthorityV2ConsumerRollback' { 'UPDATE_COMPLETE' }
    default { throw "Unhandled deployment shape $DeploymentShape." }
  }
  if (
    $stacks.Count -ne 1 -or
    [string]$stacks[0].StackName -cne $bootstrapStackName -or
    [string]$stacks[0].StackId -cne [string]$changeSet.StackId -or
    [string]$stacks[0].StackStatus -cne $expectedStackStatus -or
    [string]$stacks[0].RoleARN -cne $bootstrapExecutionRoleArn
  ) {
    throw "The child $DeploymentShape Change Set is not bound to the exact stable Stack and execution role."
  }
  $parameters = @{}
  foreach ($parameter in @($changeSet.Parameters)) {
    $parameters[[string]$parameter.ParameterKey] = [string]$parameter.ParameterValue
  }
  if (
    $parameters.Count -ne 2 -or
    $parameters.ExpectedAccountId -cne $expectedAccountId -or
    $parameters.ExpectedRegion -cne $expectedRegion
  ) { throw 'Change Set parameters are not exact.' }
  $tags = @{}
  foreach ($tag in @($changeSet.Tags)) { $tags[[string]$tag.Key] = [string]$tag.Value }
  if (
    $tags.Count -ne 3 -or
    $tags.Environment -cne 'aws-sandbox' -or
    $tags.ManagedBy -cne 'techlong-cell-bootstrap-manager' -or
    $tags.Component -cne 'b5-cell-bootstrap'
  ) { throw 'Change Set tags are not exact.' }
  if ($null -ne $changeSet.Capabilities -and @($changeSet.Capabilities).Count -ne 0) {
    throw 'The non-IAM child Change Set must declare no capability.'
  }
  $expected = switch ($DeploymentShape) {
    'InitialCreate' {
      @{
        CellJanitorLogGroup = 'AWS::Logs::LogGroup'
        CellJanitorFunction = 'AWS::Lambda::Function'
        CellSchedulerGroup = 'AWS::Scheduler::ScheduleGroup'
        CellGlobalJanitorSchedule = 'AWS::Scheduler::Schedule'
      }
    }
    'PlannerUpdate' {
      @{
        CellJanitorFunction = 'AWS::Lambda::Function'
        CellGlobalJanitorSchedule = 'AWS::Scheduler::Schedule'
      }
    }
    'AuthorityV2ConsumerUpdate' {
      @{ CellJanitorFunction = 'AWS::Lambda::Function' }
    }
    'AuthorityV2ConsumerRollback' {
      @{ CellJanitorFunction = 'AWS::Lambda::Function' }
    }
    default { throw "Unhandled deployment shape $DeploymentShape." }
  }
  $observed = @{}
  foreach ($change in @($changeSet.Changes)) {
    $resource = $change.ResourceChange
    $logicalId = [string]$resource.LogicalResourceId
    if (-not $expected.ContainsKey($logicalId) -or [string]$resource.ResourceType -cne $expected[$logicalId]) {
      throw "Unapproved Change Set resource: $logicalId ($($resource.ResourceType))."
    }
    if ($observed.ContainsKey($logicalId)) { throw "Duplicate Change Set resource $logicalId." }
    if ($DeploymentShape -eq 'InitialCreate') {
      if ([string]$resource.Action -cne 'Add') { throw "InitialCreate must only Add $logicalId." }
      if ([string]$resource.Replacement -notin @('', 'False')) {
        throw "InitialCreate may not replace $logicalId."
      }
      if (@($resource.Scope).Count -ne 0) { throw "InitialCreate Scope drifted for $logicalId." }
    } else {
      if (
        [string]$resource.Action -cne 'Modify' -or
        [string]$resource.Replacement -cne 'False' -or
        @($resource.Scope).Count -ne 1 -or
        [string]$resource.Scope[0] -cne 'Properties' -or
        -not [string]::IsNullOrEmpty([string]$resource.PolicyAction)
      ) { throw "$DeploymentShape resource shape drifted for $logicalId." }
      if (
        $logicalId -eq 'CellJanitorFunction' -and
        [string]$resource.PhysicalResourceId -cne 'techlong-sandbox-cell-janitor'
      ) { throw "$DeploymentShape Lambda physical resource drifted." }
      if (
        $logicalId -eq 'CellGlobalJanitorSchedule' -and
        [string]$resource.PhysicalResourceId -cnotmatch '^(?:arn:aws:scheduler:ca-central-1:402010193138:schedule/techlong-sandbox-cell/)?techlong-sandbox-cell-global-janitor$'
      ) { throw 'PlannerUpdate Schedule physical resource drifted.' }
      if ($DeploymentShape -in @('AuthorityV2ConsumerUpdate', 'AuthorityV2ConsumerRollback')) {
        $details = @($resource.Details)
        if ($details.Count -lt 1) {
          throw "$DeploymentShape must expose at least one exact Lambda Code property detail."
        }
        foreach ($detail in $details) {
          $target = $detail.Target
          if (
            [string]$detail.ChangeSource -cne 'DirectModification' -or
            [string]$detail.Evaluation -cne 'Static' -or
            -not [string]::IsNullOrEmpty([string]$detail.CausingEntity) -or
            [string]$target.Attribute -cne 'Properties' -or
            [string]$target.Name -cne 'Code' -or
            [string]$target.RequiresRecreation -cne 'Never' -or
            [string]$target.AttributeChangeType -cne 'Modify' -or
            [string]$target.Path -cnotmatch '^/Properties/Code(?:/ZipFile)?$'
          ) { throw "$DeploymentShape contains a non-Code Lambda property detail." }
        }
      }
    }
    $observed[$logicalId] = $true
  }
  if ($observed.Count -ne $expected.Count) { throw "Change Set is missing a required $DeploymentShape resource." }
  Assert-ExactChangeSetTemplate -AwsCli $AwsCli -ChangeSetName $ChangeSetName `
    -ReviewedTemplatePath $ReviewedTemplatePath -ExpectedCanonicalHash $Digests.Canonical `
    -ResponsePath (Join-Path $TemporaryDirectory 'change-set-template.json')
  Assert-SnapshotUnchanged -TemplatePath $ReviewedTemplatePath -ExpectedDigests $Digests
  return $changeSet
}

function Assert-JsonEqualObjects {
  param([object]$Expected, [object]$Actual, [string]$Label, [string]$TemporaryDirectory)
  $token = [Guid]::NewGuid().ToString('N')
  $expectedPath = Join-Path $TemporaryDirectory "expected-$token.json"
  $actualPath = Join-Path $TemporaryDirectory "actual-$token.json"
  Write-JsonFile -Value $Expected -Path $expectedPath
  Write-JsonFile -Value $Actual -Path $actualPath
  $output = & node $jsonVerifier --expected $expectedPath --actual $actualPath
  if ($LASTEXITCODE -ne 0) { throw "$Label drifted." }
  return (($output | Out-String).Trim())
}

function Convert-TagsToMap {
  param([object[]]$Tags)
  $map = @{}
  foreach ($tag in @($Tags)) {
    $key = if ($null -ne $tag.Key) { [string]$tag.Key } else { [string]$tag.key }
    $value = if ($null -ne $tag.Value) { [string]$tag.Value } else { [string]$tag.value }
    if ($map.ContainsKey($key)) { throw "Duplicate tag $key." }
    $map[$key] = $value
  }
  return $map
}

function Assert-BusinessTags {
  param([object[]]$Tags, [string]$Component)
  $map = Convert-TagsToMap -Tags $Tags
  $business = @{}
  foreach ($key in $map.Keys) {
    if ($key -notmatch '^aws:') { $business[$key] = $map[$key] }
  }
  if (
    $business.Count -ne 3 -or
    $business.Environment -cne 'aws-sandbox' -or
    $business.ManagedBy -cne 'techlong-cell-bootstrap-manager' -or
    $business.Component -cne $Component
  ) { throw "Business tags for $Component drifted." }
}

function Assert-IamPolicy {
  param(
    [string]$AwsCli,
    [string]$PolicyName,
    [object]$ExpectedDocument,
    [string]$TemporaryDirectory,
    [switch]$AllowHistoricalVersions
  )
  $arn = "arn:aws:iam::$expectedAccountId`:policy/$PolicyName"
  $policy = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-policy', '--profile', $SourceReadbackProfile, '--policy-arn', $arn, '--output', 'json'
  )
  if (
    [string]$policy.Policy.PolicyName -cne $PolicyName -or
    [string]$policy.Policy.Arn -cne $arn -or
    [string]$policy.Policy.Path -cne '/' -or
    [string]$policy.Policy.DefaultVersionId -cnotmatch '^v[1-9][0-9]*$' -or
    $policy.Policy.IsAttachable -ne $true -or
    [int]$policy.Policy.AttachmentCount -ne 1 -or
    [int]$policy.Policy.PermissionsBoundaryUsageCount -ne 1
  ) { throw "IAM policy $PolicyName metadata drifted." }
  $versions = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-policy-versions', '--profile', $SourceReadbackProfile,
    '--policy-arn', $arn, '--no-paginate', '--output', 'json'
  )
  $observedVersions = @($versions.Versions)
  if (
    $versions.IsTruncated -eq $true -or
    -not [string]::IsNullOrEmpty([string]$versions.Marker) -or
    $observedVersions.Count -lt 1 -or $observedVersions.Count -gt 5
  ) {
    throw "IAM policy $PolicyName has unexpected policy versions."
  }
  $defaultVersions = @($observedVersions | Where-Object { $_.IsDefaultVersion -eq $true })
  if (
    $defaultVersions.Count -ne 1 -or
    [string]$defaultVersions[0].VersionId -cne [string]$policy.Policy.DefaultVersionId
  ) { throw "IAM policy $PolicyName default version metadata drifted." }
  if (
    -not $AllowHistoricalVersions -and
    $observedVersions.Count -ne 1
  ) { throw "Immutable IAM policy $PolicyName must retain only its current default version." }
  $version = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-policy-version', '--profile', $SourceReadbackProfile,
    '--policy-arn', $arn, '--version-id', ([string]$policy.Policy.DefaultVersionId), '--output', 'json'
  )
  Assert-JsonEqualObjects -Expected $ExpectedDocument -Actual $version.PolicyVersion.Document `
    -Label "IAM policy $PolicyName document" -TemporaryDirectory $TemporaryDirectory | Out-Null
  return $arn
}

function Assert-IamRole {
  param(
    [string]$AwsCli,
    [string]$RoleName,
    [string]$BoundaryArn,
    [object]$ExpectedTrust,
    [string]$Component,
    [string]$TemporaryDirectory
  )
  $roleArn = "arn:aws:iam::$expectedAccountId`:role/$RoleName"
  $role = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-role', '--profile', $SourceReadbackProfile, '--role-name', $RoleName, '--output', 'json'
  )
  if (
    [string]$role.Role.Arn -cne $roleArn -or
    [string]$role.Role.Path -cne '/' -or
    [int]$role.Role.MaxSessionDuration -ne 3600 -or
    [string]$role.Role.PermissionsBoundary.PermissionsBoundaryArn -cne $BoundaryArn -or
    [string]$role.Role.PermissionsBoundary.PermissionsBoundaryType -cne 'Policy'
  ) { throw "IAM role $RoleName metadata drifted." }
  Assert-BusinessTags -Tags @($role.Role.Tags) -Component $Component
  Assert-JsonEqualObjects -Expected $ExpectedTrust -Actual $role.Role.AssumeRolePolicyDocument `
    -Label "IAM role $RoleName trust" -TemporaryDirectory $TemporaryDirectory | Out-Null
  $attached = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-attached-role-policies', '--profile', $SourceReadbackProfile,
    '--role-name', $RoleName, '--output', 'json'
  )
  if (
    @($attached.AttachedPolicies).Count -ne 1 -or
    [string]$attached.AttachedPolicies[0].PolicyArn -cne $BoundaryArn
  ) { throw "IAM role $RoleName attached policies drifted." }
  $inline = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-role-policies', '--profile', $SourceReadbackProfile,
    '--role-name', $RoleName, '--output', 'json'
  )
  if (@($inline.PolicyNames).Count -ne 0) { throw "IAM role $RoleName has an inline policy." }
  return $roleArn
}

function Assert-ExternalRuntimeIdentities {
  param(
    [string]$AwsCli,
    [object]$ManagementTemplate,
    [string]$TemporaryDirectory
  )
  foreach ($logicalId in @(
    'CellJanitorBoundary',
    'CellSchedulerInvokeBoundary',
    'CellJanitorExecutionRole',
    'CellSchedulerInvokeRole'
  )) {
    if ($null -eq $ManagementTemplate.Resources.$logicalId) {
      throw "Management template is missing external runtime identity $logicalId."
    }
  }
  $observedJanitorBoundaryArn = Assert-IamPolicy -AwsCli $AwsCli `
    -PolicyName 'TechlongSandboxCellJanitorBoundary' `
    -ExpectedDocument $ManagementTemplate.Resources.CellJanitorBoundary.Properties.PolicyDocument `
    -TemporaryDirectory $TemporaryDirectory
  $observedSchedulerBoundaryArn = Assert-IamPolicy -AwsCli $AwsCli `
    -PolicyName 'TechlongSandboxCellSchedulerInvokeBoundary' `
    -ExpectedDocument $ManagementTemplate.Resources.CellSchedulerInvokeBoundary.Properties.PolicyDocument `
    -TemporaryDirectory $TemporaryDirectory
  if (
    $observedJanitorBoundaryArn -cne $janitorBoundaryArn -or
    $observedSchedulerBoundaryArn -cne $schedulerBoundaryArn
  ) { throw 'External runtime boundary ARN drifted.' }
  Assert-IamRole -AwsCli $AwsCli -RoleName 'TechlongSandboxCellJanitorExecutionRole' `
    -BoundaryArn $janitorBoundaryArn `
    -ExpectedTrust $ManagementTemplate.Resources.CellJanitorExecutionRole.Properties.AssumeRolePolicyDocument `
    -Component 'cell-janitor' -TemporaryDirectory $TemporaryDirectory | Out-Null
  Assert-IamRole -AwsCli $AwsCli -RoleName 'TechlongSandboxCellSchedulerInvokeRole' `
    -BoundaryArn $schedulerBoundaryArn `
    -ExpectedTrust $ManagementTemplate.Resources.CellSchedulerInvokeRole.Properties.AssumeRolePolicyDocument `
    -Component 'cell-scheduler' -TemporaryDirectory $TemporaryDirectory | Out-Null
}

function Assert-BootstrapExecutionIdentity {
  param(
    [string]$AwsCli,
    [object]$ManagementTemplate,
    [string]$TemporaryDirectory
  )
  if (
    $null -eq $ManagementTemplate.Resources.CellBootstrapExecutionBoundary -or
    $null -eq $ManagementTemplate.Resources.CellBootstrapExecutionRole
  ) { throw 'Management template is missing the child CloudFormation execution identity.' }
  $observedBoundaryArn = Assert-IamPolicy -AwsCli $AwsCli `
    -PolicyName 'TechlongSandboxCellBootstrapCloudFormationExecutionBoundary' `
    -ExpectedDocument $ManagementTemplate.Resources.CellBootstrapExecutionBoundary.Properties.PolicyDocument `
    -TemporaryDirectory $TemporaryDirectory
  if ($observedBoundaryArn -cne $bootstrapExecutionBoundaryArn) {
    throw 'Child CloudFormation execution boundary ARN drifted.'
  }
  Assert-IamRole -AwsCli $AwsCli `
    -RoleName 'TechlongSandboxCellBootstrapCloudFormationExecutionRole' `
    -BoundaryArn $bootstrapExecutionBoundaryArn `
    -ExpectedTrust $ManagementTemplate.Resources.CellBootstrapExecutionRole.Properties.AssumeRolePolicyDocument `
    -Component 'cell-bootstrap-cloudformation-execution' `
    -TemporaryDirectory $TemporaryDirectory | Out-Null
}

function Assert-ManagementControlIdentity {
  param(
    [string]$AwsCli,
    [object]$ManagementTemplate,
    [string]$TemporaryDirectory
  )
  if (
    $null -eq $ManagementTemplate.Resources.CellBootstrapManagerBoundary -or
    $null -eq $ManagementTemplate.Resources.CellBootstrapManagerRole
  ) { throw 'Management template is missing the manager control identity.' }
  $observedBoundaryArn = Assert-IamPolicy -AwsCli $AwsCli `
    -PolicyName 'TechlongSandboxCellBootstrapManagerBoundary' `
    -ExpectedDocument $ManagementTemplate.Resources.CellBootstrapManagerBoundary.Properties.PolicyDocument `
    -TemporaryDirectory $TemporaryDirectory -AllowHistoricalVersions
  if ($observedBoundaryArn -cne $managerBoundaryArn) {
    throw 'Cell Bootstrap manager boundary ARN drifted.'
  }
  $expectedManagerTrust = (
    $ManagementTemplate.Resources.CellBootstrapManagerRole.Properties.AssumeRolePolicyDocument |
      ConvertTo-Json -Depth 100 -Compress
  ) | ConvertFrom-Json
  $expectedManagerTrust.Statement[0].Principal.AWS = $expectedSourceArn
  Assert-IamRole -AwsCli $AwsCli `
    -RoleName 'TechlongSandboxCellBootstrapManagerRole' `
    -BoundaryArn $managerBoundaryArn `
    -ExpectedTrust $expectedManagerTrust `
    -Component 'cell-bootstrap-manager' `
    -TemporaryDirectory $TemporaryDirectory | Out-Null
}

function Assert-SimulationDecision {
  param(
    [string]$AwsCli,
    [string]$RoleArn,
    [string]$Action,
    [string]$Resource,
    [ValidateSet('allowed', 'implicitDeny', 'explicitDeny')][string]$ExpectedDecision,
    [switch]$IncludeRegion,
    [string[]]$AdditionalContextEntries = @()
  )
  $arguments = @(
    'iam', 'simulate-principal-policy', '--profile', $SourceReadbackProfile,
    '--policy-source-arn', $RoleArn, '--action-names', $Action,
    '--resource-arns', $Resource
  )
  $contextEntries = @()
  if ($IncludeRegion) {
    $contextEntries += 'ContextKeyName=aws:RequestedRegion,ContextKeyValues=ca-central-1,ContextKeyType=string'
  }
  $contextEntries += $AdditionalContextEntries
  if ($contextEntries.Count -gt 0) {
    $arguments += '--context-entries'
    $arguments += $contextEntries
  }
  $arguments += @('--output', 'json')
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments $arguments
  $results = @($response.EvaluationResults)
  if (
    $results.Count -ne 1 -or
    [string]$results[0].EvalActionName -cne $Action -or
    [string]$results[0].EvalResourceName -cne $Resource -or
    [string]$results[0].EvalDecision -cne $ExpectedDecision -or
    @($results[0].MissingContextValues).Count -ne 0
  ) { throw "IAM simulation for $RoleArn $Action did not return $ExpectedDecision." }
}

function Assert-IamSimulations {
  param([string]$AwsCli)
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $janitorRoleArn `
    -Action 'cloudformation:ListStacks' -Resource '*' -ExpectedDecision 'allowed' -IncludeRegion
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $janitorRoleArn `
    -Action 'cloudformation:DeleteStack' `
    -Resource 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/*' `
    -ExpectedDecision 'explicitDeny' -IncludeRegion
  foreach ($action in @(
    'cloudformation:DescribeStacks',
    'cloudformation:GetTemplate',
    'cloudformation:ListStackResources'
  )) {
    Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $janitorRoleArn `
      -Action $action `
      -Resource 'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/00000000-0000-0000-0000-000000000000' `
      -ExpectedDecision 'allowed' -IncludeRegion
  }
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $janitorRoleArn `
    -Action 'cloudformation:DescribeStacks' `
    -Resource 'arn:aws:cloudformation:ca-central-1:402010193138:stack/not-approved/00000000-0000-0000-0000-000000000000' `
    -ExpectedDecision 'implicitDeny' -IncludeRegion `
    -AdditionalContextEntries 'ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=cell:cell-sandbox-1,ContextKeyType=stringList'
  $authorityTableArn = 'arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority'
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $janitorRoleArn `
    -Action 'dynamodb:GetItem' -Resource $authorityTableArn -ExpectedDecision 'allowed' -IncludeRegion `
    -AdditionalContextEntries 'ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=cell:cell-sandbox-1,ContextKeyType=stringList'
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $janitorRoleArn `
    -Action 'dynamodb:GetItem' -Resource $authorityTableArn -ExpectedDecision 'implicitDeny' -IncludeRegion `
    -AdditionalContextEntries 'ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=cell:not-approved,ContextKeyType=stringList'
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $janitorRoleArn `
    -Action 'dynamodb:UpdateItem' -Resource $authorityTableArn -ExpectedDecision 'explicitDeny' -IncludeRegion `
    -AdditionalContextEntries 'ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=cell:cell-sandbox-1,ContextKeyType=stringList'
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $schedulerRoleArn `
    -Action 'lambda:InvokeFunction' `
    -Resource 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' `
    -ExpectedDecision 'allowed'
  Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $schedulerRoleArn `
    -Action 'lambda:InvokeFunction' `
    -Resource 'arn:aws:lambda:ca-central-1:402010193138:function:not-approved' `
    -ExpectedDecision 'implicitDeny'
  foreach ($check in @(
    @{ Action = 'lambda:UpdateFunctionCode'; Resource = 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' },
    @{ Action = 'lambda:UpdateFunctionConfiguration'; Resource = 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' },
    @{ Action = 'scheduler:UpdateSchedule'; Resource = 'arn:aws:scheduler:ca-central-1:402010193138:schedule/techlong-sandbox-cell/techlong-sandbox-cell-global-janitor' }
  )) {
    Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $bootstrapExecutionRoleArn `
      -Action $check.Action -Resource $check.Resource -ExpectedDecision 'allowed' -IncludeRegion
  }
  foreach ($action in @(
    'ec2:CreateVpc', 'ecs:CreateCluster', 'ecs:RunTask',
    'elasticloadbalancing:CreateLoadBalancer', 'rds:CreateDBCluster'
  )) {
    Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $bootstrapExecutionRoleArn `
      -Action $action -Resource '*' -ExpectedDecision 'explicitDeny' -IncludeRegion
  }
  foreach ($check in @(
    @{ Action = 'iam:CreatePolicyVersion'; Resource = $janitorBoundaryArn },
    @{ Action = 'iam:SetDefaultPolicyVersion'; Resource = $schedulerBoundaryArn },
    @{ Action = 'iam:PutRolePolicy'; Resource = $janitorRoleArn },
    @{ Action = 'iam:UpdateAssumeRolePolicy'; Resource = $schedulerRoleArn },
    @{ Action = 'iam:PutRolePermissionsBoundary'; Resource = $janitorRoleArn },
    @{ Action = 'iam:DeleteRolePermissionsBoundary'; Resource = $schedulerRoleArn }
  )) {
    Assert-SimulationDecision -AwsCli $AwsCli -RoleArn $bootstrapExecutionRoleArn `
      -Action $check.Action -Resource $check.Resource -ExpectedDecision 'explicitDeny'
  }
}

function Assert-ExactStackAndResources {
  param(
    [string]$AwsCli,
    [string]$ExpectedStackId,
    [string]$ReviewedTemplatePath,
    [hashtable]$Digests,
    [string]$TemporaryDirectory,
    [object]$ManagementTemplate
  )
  $stack = Get-StackOrNull -AwsCli $AwsCli -Profile $SourceReadbackProfile -StackName $ExpectedStackId
  if (
    $null -eq $stack -or
    [string]$stack.StackId -cne $ExpectedStackId -or
    [string]$stack.StackName -cne $bootstrapStackName -or
    [string]$stack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE') -or
    [string]$stack.RoleARN -cne $bootstrapExecutionRoleArn -or
    $stack.EnableTerminationProtection -eq $true -or
    -not [string]::IsNullOrEmpty([string]$stack.ParentId) -or
    -not [string]::IsNullOrEmpty([string]$stack.RootId)
  ) { throw 'B5-J4c Bootstrap Stack metadata drifted.' }
  if ($null -ne $stack.Capabilities -and @($stack.Capabilities).Count -ne 0) {
    throw 'The non-IAM B5-J4c Bootstrap Stack must declare no capability.'
  }
  $parameters = @{}
  foreach ($parameter in @($stack.Parameters)) {
    $parameters[[string]$parameter.ParameterKey] = [string]$parameter.ParameterValue
  }
  if (
    $parameters.Count -ne 2 -or
    $parameters.ExpectedAccountId -cne $expectedAccountId -or
    $parameters.ExpectedRegion -cne $expectedRegion
  ) { throw 'B5-J4c Stack parameters drifted.' }
  Assert-BusinessTags -Tags @($stack.Tags) -Component 'b5-cell-bootstrap'
  $outputs = @{}
  foreach ($output in @($stack.Outputs)) {
    $outputs[[string]$output.OutputKey] = [string]$output.OutputValue
  }
  if (
    $outputs.Count -ne 5 -or
    $outputs.CellJanitorFunctionArn -cne 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' -or
    $outputs.CellSchedulerInvokeRoleArn -cne 'arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole' -or
    $outputs.CellSchedulerGroupName -cne 'techlong-sandbox-cell' -or
    $outputs.ApprovedCellStackName -cne $approvedCellStackName -or
    $outputs.SafetyState -cne 'B5_J4C_OWNERSHIP_FENCED_PLAN_ONLY_ALL_MUTATIONS_DISABLED'
  ) { throw 'B5-J4c Stack outputs drifted.' }
  $inventory = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'list-stack-resources', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--stack-name', $ExpectedStackId, '--output', 'json'
  )
  if (-not [string]::IsNullOrEmpty([string]$inventory.NextToken)) {
    throw 'Unexpected pagination in the four-resource B5-J4c Stack inventory.'
  }
  $expectedTypes = @{
    CellJanitorLogGroup = 'AWS::Logs::LogGroup'
    CellJanitorFunction = 'AWS::Lambda::Function'
    CellSchedulerGroup = 'AWS::Scheduler::ScheduleGroup'
    CellGlobalJanitorSchedule = 'AWS::Scheduler::Schedule'
  }
  $observed = @{}
  foreach ($resource in @($inventory.StackResourceSummaries)) {
    $logicalId = [string]$resource.LogicalResourceId
    $expectedResourceStatus = if (
      [string]$stack.StackStatus -ceq 'UPDATE_COMPLETE' -and
      $logicalId -in @('CellJanitorFunction', 'CellGlobalJanitorSchedule')
    ) { 'UPDATE_COMPLETE' } else { 'CREATE_COMPLETE' }
    if (
      -not $expectedTypes.ContainsKey($logicalId) -or
      [string]$resource.ResourceType -cne $expectedTypes[$logicalId] -or
      [string]$resource.ResourceStatus -cne $expectedResourceStatus -or
      [string]::IsNullOrWhiteSpace([string]$resource.PhysicalResourceId)
    ) { throw "B5-J4c Stack resource $logicalId drifted." }
    if ($observed.ContainsKey($logicalId)) { throw "Duplicate Stack resource $logicalId." }
    $observed[$logicalId] = [string]$resource.PhysicalResourceId
  }
  if ($observed.Count -ne $expectedTypes.Count) { throw 'B5-J4c Stack resource inventory is incomplete.' }
  $expectedPhysical = @{
    CellJanitorLogGroup = '/aws/lambda/techlong-sandbox-cell-janitor'
    CellJanitorFunction = 'techlong-sandbox-cell-janitor'
    CellSchedulerGroup = 'techlong-sandbox-cell'
  }
  foreach ($logicalId in $expectedPhysical.Keys) {
    if ($observed[$logicalId] -cne $expectedPhysical[$logicalId]) {
      throw "Physical ID for $logicalId drifted."
    }
  }
  if ($observed.CellGlobalJanitorSchedule -cnotmatch '^(?:arn:aws:scheduler:ca-central-1:402010193138:schedule/techlong-sandbox-cell/)?techlong-sandbox-cell-global-janitor$') {
    throw 'Physical ID for CellGlobalJanitorSchedule drifted.'
  }
  $templateResponsePath = Join-Path $TemporaryDirectory 'stack-template.json'
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--stack-name', $ExpectedStackId, '--template-stage', 'Original', '--output', 'json'
  ) -OutputPath $templateResponsePath
  $verified = ((& node $templateVerifier --expected-template $ReviewedTemplatePath `
    --get-template-response $templateResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verified -cne $Digests.Canonical) {
    throw 'Deployed B5-J4c Stack template drifted.'
  }
  Assert-ExternalRuntimeIdentities -AwsCli $AwsCli `
    -ManagementTemplate $ManagementTemplate -TemporaryDirectory $TemporaryDirectory
  foreach ($forbiddenRole in @(
    'TechlongSandboxCellOperatorRole',
    'TechlongSandboxCellCloudFormationExecutionRole'
  )) {
    Assert-NamedResourceAbsent -AwsCli $AwsCli -Arguments @(
      'iam', 'get-role', '--profile', $SourceReadbackProfile,
      '--role-name', $forbiddenRole, '--output', 'json'
    ) -MissingPattern 'NoSuchEntity' -Label "forbidden IAM role $forbiddenRole"
  }
  $lambda = Get-ExactLambdaConfigurationAndVerifyInlineCode -AwsCli $AwsCli `
    -ReviewedTemplatePath $ReviewedTemplatePath -TemporaryDirectory $TemporaryDirectory `
    -ExpectedStackId $ExpectedStackId
  if (
    [string]$lambda.FunctionName -cne 'techlong-sandbox-cell-janitor' -or
    [string]$lambda.FunctionArn -cne 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' -or
    [string]$lambda.Runtime -cne 'nodejs22.x' -or
    [string]$lambda.Handler -cne 'index.handler' -or
    [string]$lambda.Description -cne 'Locked B5-J4c ownership-fenced cleanup planner for the exact Sandbox Shared Cell; no mutation commands are deployed.' -or
    [string]$lambda.PackageType -cne 'Zip' -or
    [string]$lambda.Version -cne '$LATEST' -or
    [string]$lambda.Role -cne 'arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole' -or
    [int]$lambda.MemorySize -ne 128 -or [int]$lambda.Timeout -ne 60 -or
    [string]$lambda.State -cne 'Active' -or [string]$lambda.LastUpdateStatus -cne 'Successful' -or
    @($lambda.Architectures).Count -ne 1 -or [string]$lambda.Architectures[0] -cne 'arm64' -or
    ($null -ne $lambda.Layers -and @($lambda.Layers).Count -ne 0) -or
    ($null -ne $lambda.FileSystemConfigs -and @($lambda.FileSystemConfigs).Count -ne 0) -or
    -not [string]::IsNullOrEmpty([string]$lambda.DeadLetterConfig.TargetArn) -or
    -not [string]::IsNullOrEmpty([string]$lambda.KMSKeyArn) -or
    -not [string]::IsNullOrEmpty([string]$lambda.VpcConfig.VpcId) -or
    [string]$lambda.TracingConfig.Mode -cne 'PassThrough' -or
    [int]$lambda.EphemeralStorage.Size -ne 512 -or
    [string]$lambda.LoggingConfig.LogFormat -cne 'Text' -or
    [string]$lambda.LoggingConfig.LogGroup -cne '/aws/lambda/techlong-sandbox-cell-janitor' -or
    [string]$lambda.RevisionId -cnotmatch '^[0-9a-f-]{36}$' -or
    [string]$lambda.CodeSha256 -cnotmatch '^[A-Za-z0-9+/]{43}=$'
  ) { throw 'Cell Janitor Lambda configuration drifted.' }
  $expectedEnvironment = @{
    EXPECTED_ACCOUNT_ID = '402010193138'
    EXPECTED_REGION = 'ca-central-1'
    EXPECTED_CELL_ID = 'cell-sandbox-1'
    CELL_CLEANUP_AUTHORITY_KEY = 'cell:cell-sandbox-1'
    CELL_CLEANUP_AUTHORITY_TABLE_ARN = 'arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority'
    CELL_CLEANUP_COORDINATOR_MODE = 'PLAN_ONLY'
  }
  Assert-JsonEqualObjects -Expected $expectedEnvironment -Actual $lambda.Environment.Variables `
    -Label 'Cell Janitor environment' -TemporaryDirectory $TemporaryDirectory | Out-Null
  $concurrency = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'lambda', 'get-function-concurrency', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--function-name', 'techlong-sandbox-cell-janitor', '--output', 'json'
  ) -AllowEmptyObject
  if ($null -ne $concurrency.PSObject.Properties['ReservedConcurrentExecutions']) {
    throw 'Cell Janitor must not reserve account concurrency in this quota-constrained Sandbox.'
  }
  $logGroups = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-log-groups', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--log-group-name-prefix', '/aws/lambda/techlong-sandbox-cell-janitor', '--output', 'json'
  )
  $exactGroups = @($logGroups.logGroups | Where-Object { $_.logGroupName -ceq '/aws/lambda/techlong-sandbox-cell-janitor' })
  if (
    $exactGroups.Count -ne 1 -or
    [string]$exactGroups[0].logGroupClass -cne 'STANDARD' -or
    [int]$exactGroups[0].retentionInDays -ne 1 -or
    -not [string]::IsNullOrEmpty([string]$exactGroups[0].kmsKeyId) -or
    -not [string]::IsNullOrEmpty([string]$exactGroups[0].dataProtectionStatus) -or
    ($null -ne $exactGroups[0].inheritedProperties -and
      @($exactGroups[0].inheritedProperties).Count -ne 0)
  ) { throw 'Cell Janitor LogGroup drifted.' }
  $logArn = 'arn:aws:logs:ca-central-1:402010193138:log-group:/aws/lambda/techlong-sandbox-cell-janitor'
  $logTags = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'list-tags-for-resource', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
    '--resource-arn', $logArn, '--output', 'json'
  )
  $tagObjects = @()
  foreach ($property in $logTags.tags.PSObject.Properties) {
    $tagObjects += [pscustomobject]@{ Key = $property.Name; Value = [string]$property.Value }
  }
  Assert-BusinessTags -Tags $tagObjects -Component 'cell-janitor'
  $subscriptions = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-subscription-filters', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--log-group-name', '/aws/lambda/techlong-sandbox-cell-janitor', '--output', 'json'
  )
  $metrics = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-metric-filters', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--log-group-name', '/aws/lambda/techlong-sandbox-cell-janitor', '--output', 'json'
  )
  if (@($subscriptions.subscriptionFilters).Count -ne 0 -or @($metrics.metricFilters).Count -ne 0) {
    throw 'Cell Janitor LogGroup contains an unreviewed filter.'
  }
  $accountPolicies = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'logs', 'describe-account-policies', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--policy-type', 'SUBSCRIPTION_FILTER_POLICY', '--output', 'json'
  )
  if (@($accountPolicies.accountPolicies).Count -ne 0) { throw 'Account subscription policy must remain absent.' }
  $group = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'scheduler', 'get-schedule-group', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--name', 'techlong-sandbox-cell', '--output', 'json'
  )
  if (
    [string]$group.Name -cne 'techlong-sandbox-cell' -or
    [string]$group.Arn -cne 'arn:aws:scheduler:ca-central-1:402010193138:schedule-group/techlong-sandbox-cell' -or
    [string]$group.State -cne 'ACTIVE'
  ) { throw 'Cell Scheduler group drifted.' }
  $schedule = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'scheduler', 'get-schedule', '--profile', $SourceReadbackProfile,
    '--region', $expectedRegion, '--group-name', 'techlong-sandbox-cell',
    '--name', 'techlong-sandbox-cell-global-janitor', '--output', 'json'
  )
  if (
    [string]$schedule.Name -cne 'techlong-sandbox-cell-global-janitor' -or
    [string]$schedule.GroupName -cne 'techlong-sandbox-cell' -or
    [string]$schedule.State -cne 'DISABLED' -or
    [string]$schedule.ScheduleExpression -cne 'rate(15 minutes)' -or
    [string]$schedule.FlexibleTimeWindow.Mode -cne 'OFF' -or
    [string]$schedule.Target.Arn -cne 'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor' -or
    [string]$schedule.Target.RoleArn -cne 'arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole' -or
    [int]$schedule.Target.RetryPolicy.MaximumRetryAttempts -ne 0 -or
    [int]$schedule.Target.RetryPolicy.MaximumEventAgeInSeconds -ne 3600 -or
    [string]$schedule.Target.Input -cne '{"schemaVersion":1,"action":"inspect_cell_cleanup_plan"}'
  ) { throw 'Cell cleanup planner Schedule drifted.' }
  Assert-IamSimulations -AwsCli $AwsCli
  Assert-PaidCellAndTenantResourcesAbsent -AwsCli $AwsCli
  Assert-SnapshotUnchanged -TemplatePath $ReviewedTemplatePath -ExpectedDigests $Digests
  $evidence = [ordered]@{
    schemaVersion = 1
    stackId = $ExpectedStackId
    templateCanonicalSha256 = $Digests.Canonical
    resourceCount = 4
    managerRole = $managerSessionArn
    cloudFormationRole = $bootstrapExecutionRoleArn
    cellApplyRoles = 0
    coordinatorMode = 'PLAN_ONLY'
    authorityReadOnly = $true
    mutationPerformed = $false
    janitorMutationEnabled = $false
    janitorCodeSha256 = [string]$lambda.CodeSha256
    janitorScheduleState = 'DISABLED'
    janitorReservedConcurrencyConfigured = $false
    cellStack = 'MISSING'
    ecsCluster = 'MISSING'
    aurora = 'MISSING'
    loadBalancer = 'MISSING'
    cellVpc = 'MISSING'
    ownedTenantStacks = 0
    registrationReady = $false
    liveReadbackReady = $false
    applyRuntimeReady = $false
    cleanupRuntimeReady = $false
  }
  $evidencePath = Join-Path $TemporaryDirectory 'readback-evidence.json'
  Write-JsonFile -Value $evidence -Path $evidencePath
  $evidenceHash = ((& node $jsonVerifier --hash $evidencePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $evidenceHash -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Unable to hash B5-J4c readback evidence.'
  }
  Write-Host "B5-J4c readback evidence canonical SHA-256: $evidenceHash"
  Write-Host 'registrationReady=false; liveReadbackReady=false; applyRuntimeReady=false; cleanupRuntimeReady=false.'
  return $evidenceHash
}

function Invoke-PlanOnlyJanitorProbeTwice {
  param([string]$AwsCli, [string]$TemporaryDirectory)
  Assert-PaidCellAndTenantResourcesAbsent -AwsCli $AwsCli
  $payloadPath = Join-Path $TemporaryDirectory 'plan-only-probe-request.json'
  Write-JsonFile -Value ([ordered]@{
    schemaVersion = 1
    action = 'inspect_cell_cleanup_plan'
  }) -Path $payloadPath
  $expectedPayload = [ordered]@{
    schemaVersion = 1
    action = 'inspect_cell_cleanup_plan'
    coordinatorMode = 'PLAN_ONLY'
    decision = 'ABSENT_SAFE'
    mutationPerformed = $false
    cellStack = 'MISSING'
    tenantStacks = @()
  }
  $results = @()
  foreach ($index in 1..2) {
    $outputPath = Join-Path $TemporaryDirectory "plan-only-probe-response-$index.json"
    $metadata = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
      'lambda', 'invoke', '--profile', $SourceReadbackProfile, '--region', $expectedRegion,
      '--function-name', 'techlong-sandbox-cell-janitor', '--invocation-type', 'RequestResponse',
      '--cli-binary-format', 'raw-in-base64-out', '--payload', "fileb://$payloadPath",
      $outputPath, '--output', 'json'
    )
    if (
      [int]$metadata.StatusCode -ne 200 -or
      -not [string]::IsNullOrEmpty([string]$metadata.FunctionError)
    ) { throw "Janitor plan-only probe $index failed." }
    $payload = (Get-Content -Raw -LiteralPath $outputPath) | ConvertFrom-Json
    Assert-JsonEqualObjects -Expected $expectedPayload -Actual $payload `
      -Label "Janitor plan-only probe $index" -TemporaryDirectory $TemporaryDirectory | Out-Null
    $results += $payload
  }
  Assert-JsonEqualObjects -Expected $results[0] -Actual $results[1] `
    -Label 'two Janitor plan-only probes' -TemporaryDirectory $TemporaryDirectory | Out-Null
  Assert-PaidCellAndTenantResourcesAbsent -AwsCli $AwsCli
  $evidencePath = Join-Path $TemporaryDirectory 'plan-only-probe-evidence.json'
  Write-JsonFile -Value $results -Path $evidencePath
  $hash = ((& node $jsonVerifier --hash $evidencePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $hash -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Unable to hash Janitor plan-only probe evidence.'
  }
  Write-Host "Two exact, identical Janitor ABSENT_SAFE plans passed. Evidence canonical SHA-256: $hash"
  return $hash
}

Write-Host 'Running local B5-J4c ownership-fenced plan-only Bootstrap validation...'
& node $validator
if ($LASTEXITCODE -ne 0) { throw 'Local B5-J4c Bootstrap validation failed.' }
if ($Mode -eq 'LocalValidate') {
  $localSnapshotPath = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-b5j4c-local-$([Guid]::NewGuid().ToString('N')).json"
  )
  $localLegacySnapshotPath = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-b5j4b-legacy-$([Guid]::NewGuid().ToString('N')).json"
  )
  $localDeployedJ4cSnapshotPath = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-b5j4c-deployed-$([Guid]::NewGuid().ToString('N')).json"
  )
  $localAuthorityV2SnapshotPath = [System.IO.Path]::Combine(
    [System.IO.Path]::GetTempPath(),
    "techlong-b5j5gg-authority-v2-$([Guid]::NewGuid().ToString('N')).json"
  )
  try {
    $localDigests = New-ReadOnlyTemplateSnapshot -DestinationPath $localSnapshotPath
    $localLegacyDigests = New-LegacyJ4bReadOnlyTemplateSnapshot -DestinationPath $localLegacySnapshotPath
    $localDeployedJ4cDigests = New-DeployedJ4cReadOnlyTemplateSnapshot `
      -DestinationPath $localDeployedJ4cSnapshotPath
    $localAuthorityV2Digests = New-AuthorityV2ReadOnlyTemplateSnapshot `
      -DestinationPath $localAuthorityV2SnapshotPath
    & node $validator --template $localSnapshotPath
    if ($LASTEXITCODE -ne 0) { throw 'Rendered local B5-J4c snapshot validation failed.' }
    Write-Host "Template SHA-256: $($localDigests.Raw)"
    Write-Host "Template canonical SHA-256: $($localDigests.Canonical)"
    Write-Host "Fixed legacy J4b raw SHA-256: $($localLegacyDigests.Raw)"
    Write-Host "Fixed legacy J4b canonical SHA-256: $($localLegacyDigests.Canonical)"
    Write-Host "Fixed deployed J4c raw SHA-256: $($localDeployedJ4cDigests.Raw)"
    Write-Host "Fixed deployed J4c canonical SHA-256: $($localDeployedJ4cDigests.Canonical)"
    Write-Host "Fixed J5g-g authority-v2 raw SHA-256: $($localAuthorityV2Digests.Raw)"
    Write-Host "Fixed J5g-g authority-v2 canonical SHA-256: $($localAuthorityV2Digests.Canonical)"
    Write-Host "Dormant rollback Change Set name: techlong-s3-b5-cell-bootstrap-rollback-$($localDeployedJ4cDigests.Raw.Substring(0, 16))"
    Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
    exit 0
  } finally {
    foreach ($path in @(
      $localSnapshotPath,
      $localLegacySnapshotPath,
      $localDeployedJ4cSnapshotPath,
      $localAuthorityV2SnapshotPath
    )) {
      if (Test-Path -LiteralPath $path) {
        (Get-Item -LiteralPath $path).IsReadOnly = $false
        Remove-Item -LiteralPath $path -Force
      }
    }
  }
}

if ($ManagerProfile -cne $expectedManagerProfile -or $SourceReadbackProfile -cne $expectedSourceProfile) {
  throw 'Only the reviewed manager and source profile names are accepted.'
}
if ($Mode -in @('CreateChangeSet', 'ExecuteChangeSet', 'Delete')) {
  Assert-WriteAcknowledgements -Delete:($Mode -eq 'Delete')
}
if ($Mode -eq 'Readback' -or $Mode -eq 'ProbeJanitor' -or $Mode -eq 'Delete') {
  Assert-ConfirmedStackId
}
if ($Mode -eq 'ProbeJanitor' -and -not $AcknowledgeTwoLowCostLambdaInvocations) {
  throw 'ProbeJanitor requires -AcknowledgeTwoLowCostLambdaInvocations.'
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) `
  "techlong-b5j4c-bootstrap-$([Guid]::NewGuid().ToString('N'))"
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
$templateSnapshotPath = Join-Path $temporaryDirectory 'reviewed-template.json'
$legacyTemplateSnapshotPath = Join-Path $temporaryDirectory 'legacy-j4b-template.json'
$deployedJ4cTemplateSnapshotPath = Join-Path $temporaryDirectory 'deployed-j4c-template.json'
$authorityV2TemplateSnapshotPath = Join-Path $temporaryDirectory 'authority-v2-template.json'
try {
  $digests = if ($DeploymentShape -eq 'AuthorityV2ConsumerRollback') {
    New-DeployedJ4cReadOnlyTemplateSnapshot -DestinationPath $templateSnapshotPath
  } else {
    New-ReadOnlyTemplateSnapshot -DestinationPath $templateSnapshotPath
  }
  if ($DeploymentShape -ne 'AuthorityV2ConsumerRollback') {
    & node $validator --template $templateSnapshotPath
    if ($LASTEXITCODE -ne 0) { throw 'Rendered B5-J4c snapshot validation failed.' }
  }
  $legacyDigests = if ($DeploymentShape -eq 'PlannerUpdate') {
    New-LegacyJ4bReadOnlyTemplateSnapshot -DestinationPath $legacyTemplateSnapshotPath
  } else { $null }
  $deployedJ4cDigests = if ($DeploymentShape -eq 'AuthorityV2ConsumerUpdate') {
    New-DeployedJ4cReadOnlyTemplateSnapshot -DestinationPath $deployedJ4cTemplateSnapshotPath
  } else { $null }
  $authorityV2Digests = if ($DeploymentShape -eq 'AuthorityV2ConsumerRollback') {
    New-AuthorityV2ReadOnlyTemplateSnapshot -DestinationPath $authorityV2TemplateSnapshotPath
  } else { $null }
  $changeSetName = if ($DeploymentShape -eq 'AuthorityV2ConsumerRollback') {
    "techlong-s3-b5-cell-bootstrap-rollback-$($digests.Raw.Substring(0, 16))"
  } else {
    "techlong-s3-b5-cell-bootstrap-$($digests.Raw.Substring(0, 16))"
  }
  $description = if ($DeploymentShape -eq 'AuthorityV2ConsumerRollback') {
    "B5-J5g-g plan-only authority-v2 consumer rollback raw=$($digests.Raw) canonical=$($digests.Canonical)"
  } else {
    "B5-J4c plan-only cleanup planner raw=$($digests.Raw) canonical=$($digests.Canonical)"
  }
  $templateObject = Get-TemplateObjectContract -Digests $digests
  Write-Host "Template SHA-256: $($digests.Raw)"
  Write-Host "Template canonical SHA-256: $($digests.Canonical)"
  Write-Host "Digest-bound Change Set name: $changeSetName"

  $awsCli = Resolve-AwsCli
  Assert-NoCredentialOrEndpointOverrides
  Assert-ExactSourceSession -AwsCli $awsCli
  Assert-ExactManagerSession -AwsCli $awsCli

  $allowedManagementStates = if ($Mode -eq 'CreateChangeSet') {
    @('AUTHORGRANT')
  } elseif ($Mode -eq 'ExecuteChangeSet') {
    @('EXECUTEGRANT')
  } elseif ($Mode -eq 'Delete') {
    @('ROLLBACKGRANT')
  } elseif ($Mode -eq 'InspectChangeSet') {
    @('LOCKED', 'AUTHORGRANT', 'EXECUTEGRANT')
  } else {
    @('LOCKED')
  }
  $managementTemplate = Assert-ManagementState -AwsCli $awsCli `
    -AllowedStates $allowedManagementStates -ExpectedChangeSetName $changeSetName `
    -ExpectedTemplateSha256 $digests.Raw `
    -TemporaryDirectory $temporaryDirectory
  Assert-ManagementControlIdentity -AwsCli $awsCli `
    -ManagementTemplate $managementTemplate -TemporaryDirectory $temporaryDirectory
  Assert-ExternalRuntimeIdentities -AwsCli $awsCli `
    -ManagementTemplate $managementTemplate -TemporaryDirectory $temporaryDirectory
  Assert-BootstrapExecutionIdentity -AwsCli $awsCli `
    -ManagementTemplate $managementTemplate -TemporaryDirectory $temporaryDirectory
  Assert-IamSimulations -AwsCli $awsCli
  Assert-PaidCellAndTenantResourcesAbsent -AwsCli $awsCli

  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template', '--profile', $ManagerProfile,
    '--region', $expectedRegion, '--template-body', "file://$templateSnapshotPath"
  )
  $predecessorStack = if ($Mode -in @('OnlineValidate', 'CreateChangeSet', 'InspectChangeSet', 'ExecuteChangeSet')) {
    switch ($DeploymentShape) {
      'PlannerUpdate' {
        Assert-ExactLegacyJ4bChildStack -AwsCli $awsCli `
          -LegacyTemplatePath $legacyTemplateSnapshotPath -LegacyDigests $legacyDigests `
          -TemporaryDirectory $temporaryDirectory
      }
      'AuthorityV2ConsumerUpdate' {
        Assert-ExactDeployedJ4cChildStack -AwsCli $awsCli `
          -DeployedTemplatePath $deployedJ4cTemplateSnapshotPath `
          -DeployedDigests $deployedJ4cDigests -TemporaryDirectory $temporaryDirectory `
          -ManagementTemplate $managementTemplate
      }
      'AuthorityV2ConsumerRollback' {
        Assert-ExactAuthorityV2ConsumerChildStack -AwsCli $awsCli `
          -AuthorityV2TemplatePath $authorityV2TemplateSnapshotPath `
          -AuthorityV2Digests $authorityV2Digests -TemporaryDirectory $temporaryDirectory `
          -ManagementTemplate $managementTemplate
      }
      default { $null }
    }
  } else { $null }
  if ($Mode -eq 'OnlineValidate') {
    if ($DeploymentShape -eq 'InitialCreate') {
      if ($null -ne (Get-StackOrNull -AwsCli $awsCli -Profile $SourceReadbackProfile -StackName $bootstrapStackName)) {
        throw "Stack $bootstrapStackName already exists; use PlannerUpdate or Readback."
      }
      Assert-BootstrapNamedResourcesAbsent -AwsCli $awsCli
    } elseif ($null -eq $predecessorStack) {
      throw "$DeploymentShape requires its exact fixed predecessor child Stack."
    }
    Write-Host "Online validation for $DeploymentShape passed under locked management. No AWS resource was changed."
    exit 0
  }

  if ($Mode -eq 'CreateChangeSet') {
    Assert-ConfirmedTemplateDigests -Digests $digests
    if ($ConfirmChangeSetName -cne $changeSetName) {
      throw "CreateChangeSet requires -ConfirmChangeSetName $changeSetName."
    }
    if ($DeploymentShape -eq 'InitialCreate') {
      if ($null -ne (Get-StackOrNull -AwsCli $awsCli -Profile $SourceReadbackProfile -StackName $bootstrapStackName)) {
        throw 'Initial B5-J4c Bootstrap is CREATE-only; the Stack already exists.'
      }
      Assert-BootstrapNamedResourcesAbsent -AwsCli $awsCli
    } elseif ($null -eq $predecessorStack) {
      throw "$DeploymentShape requires its exact fixed predecessor child Stack."
    }
    Assert-SnapshotUnchanged -TemplatePath $templateSnapshotPath -ExpectedDigests $digests
    $observedTemplateObject = Assert-ExactTemplateObject -AwsCli $awsCli `
      -ReviewedTemplatePath $templateSnapshotPath -Digests $digests `
      -TemporaryDirectory $temporaryDirectory
    if ($observedTemplateObject.Url -cne $templateObject.Url) {
      throw 'Digest-addressed child template URL drifted.'
    }
    $changeSetType = if ($DeploymentShape -eq 'InitialCreate') { 'CREATE' } else { 'UPDATE' }
    $createChangeSetArguments = @(
      'cloudformation', 'create-change-set', '--profile', $ManagerProfile,
      '--region', $expectedRegion, '--stack-name', $bootstrapStackName,
      '--change-set-name', $changeSetName, '--change-set-type', $changeSetType,
      '--description', $description, '--template-url', $templateObject.Url,
      '--role-arn', $bootstrapExecutionRoleArn,
      '--resource-types'
    ) + $approvedResourceTypes + @(
      '--parameters', "ParameterKey=ExpectedAccountId,ParameterValue=$expectedAccountId",
      "ParameterKey=ExpectedRegion,ParameterValue=$expectedRegion",
      '--tags', 'Key=Environment,Value=aws-sandbox',
      'Key=ManagedBy,Value=techlong-cell-bootstrap-manager',
      'Key=Component,Value=b5-cell-bootstrap',
      '--no-include-nested-stacks',
      '--client-token', "b5j4c-$($DeploymentShape.ToLowerInvariant())-author-$($digests.Raw.Substring(0, 32))"
    )
    if ($DeploymentShape -eq 'InitialCreate') {
      $createChangeSetArguments += @('--on-stack-failure', 'DELETE')
    }
    Invoke-AwsChecked -AwsCli $awsCli -Arguments $createChangeSetArguments
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', 'change-set-create-complete', '--profile', $SourceReadbackProfile,
      '--region', $expectedRegion, '--stack-name', $bootstrapStackName,
      '--change-set-name', $changeSetName
    )
    $reviewedChangeSet = Assert-ReviewedChangeSet -AwsCli $awsCli -ChangeSetName $changeSetName `
      -ExpectedDescription $description -ReviewedTemplatePath $templateSnapshotPath `
      -Digests $digests -TemporaryDirectory $temporaryDirectory
    if (
      $DeploymentShape -ne 'InitialCreate' -and
      [string]$reviewedChangeSet.StackId -cne [string]$predecessorStack.StackId
    ) { throw "Created $DeploymentShape Change Set is not bound to the verified predecessor child StackId." }
    Write-Host "Created and verified Change Set $changeSetName; it was NOT executed."
    Write-Host 'Immediately revoke BootstrapAuthorGrant, inspect again while Locked, then grant only Execute for this exact Change Set.'
    exit 0
  }

  if ($Mode -eq 'InspectChangeSet' -or $Mode -eq 'ExecuteChangeSet') {
    if ($ConfirmChangeSetName -cne $changeSetName) {
      throw "$Mode requires -ConfirmChangeSetName $changeSetName."
    }
    if ($ConfirmTemplateSha256 -and $ConfirmTemplateSha256 -cne $digests.Raw) {
      throw 'Confirmed raw template digest drifted.'
    }
    if ($ConfirmTemplateCanonicalSha256 -and $ConfirmTemplateCanonicalSha256 -cne $digests.Canonical) {
      throw 'Confirmed canonical template digest drifted.'
    }
    $changeSet = Assert-ReviewedChangeSet -AwsCli $awsCli -ChangeSetName $changeSetName `
      -ExpectedDescription $description -ReviewedTemplatePath $templateSnapshotPath `
      -Digests $digests -TemporaryDirectory $temporaryDirectory
    if (
      $DeploymentShape -ne 'InitialCreate' -and
      [string]$changeSet.StackId -cne [string]$predecessorStack.StackId
    ) { throw "$DeploymentShape Change Set StackId is not the exact verified predecessor child StackId." }
    if ($Mode -eq 'InspectChangeSet') {
      Write-Host "Change Set $changeSetName is exact, available, and NOT executed."
      exit 0
    }
    Assert-ConfirmedTemplateDigests -Digests $digests
    Assert-SnapshotUnchanged -TemplatePath $templateSnapshotPath -ExpectedDigests $digests
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'execute-change-set', '--profile', $ManagerProfile,
      '--region', $expectedRegion, '--stack-name', $bootstrapStackName,
      '--change-set-name', $changeSetName,
      '--client-request-token', "b5j4c-$($DeploymentShape.ToLowerInvariant())-execute-$($digests.Raw.Substring(0, 32))"
    )
    $waiter = if ($DeploymentShape -eq 'InitialCreate') {
      'stack-create-complete'
    } else { 'stack-update-complete' }
    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'wait', $waiter, '--profile', $SourceReadbackProfile,
      '--region', $expectedRegion, '--stack-name', ([string]$changeSet.StackId)
    )
    Assert-ExactStackAndResources -AwsCli $awsCli -ExpectedStackId ([string]$changeSet.StackId) `
      -ReviewedTemplatePath $templateSnapshotPath -Digests $digests `
      -TemporaryDirectory $temporaryDirectory -ManagementTemplate $managementTemplate | Out-Null
    $verb = if ($DeploymentShape -eq 'InitialCreate') { 'Created' } else { 'Updated' }
    Write-Host "$verb exact B5-J4c plan-only Bootstrap Stack: $($changeSet.StackId)"
    Write-Host 'Immediately revoke BootstrapExecuteGrant. No Cell, VPC, ALB, ECS, Aurora, tenant Stack, or RunTask was created.'
    exit 0
  }

  Assert-ExactStackAndResources -AwsCli $awsCli -ExpectedStackId $ConfirmStackId `
    -ReviewedTemplatePath $templateSnapshotPath -Digests $digests `
    -TemporaryDirectory $temporaryDirectory -ManagementTemplate $managementTemplate | Out-Null
  if ($Mode -eq 'Readback') {
    Write-Host 'Exact locked B5-J4c plan-only Bootstrap readback passed.'
    exit 0
  }
  if ($Mode -eq 'ProbeJanitor') {
    Invoke-PlanOnlyJanitorProbeTwice -AwsCli $awsCli -TemporaryDirectory $temporaryDirectory | Out-Null
    Write-Host 'Janitor remained read-only; the disabled Schedule was not enabled.'
    exit 0
  }

  Assert-ConfirmedTemplateDigests -Digests $digests
  Assert-SnapshotUnchanged -TemplatePath $templateSnapshotPath -ExpectedDigests $digests
  Invoke-PlanOnlyJanitorProbeTwice -AwsCli $awsCli -TemporaryDirectory $temporaryDirectory | Out-Null
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'delete-stack', '--profile', $ManagerProfile, '--region', $expectedRegion,
    '--stack-name', $ConfirmStackId, '--role-arn', $bootstrapExecutionRoleArn,
    '--client-request-token', "b5j4c-delete-$($digests.Raw.Substring(0, 32))"
  )
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'wait', 'stack-delete-complete', '--profile', $ManagerProfile,
    '--region', $expectedRegion, '--stack-name', $ConfirmStackId
  )
  if ($null -ne (Get-StackOrNull -AwsCli $awsCli -Profile $SourceReadbackProfile -StackName $bootstrapStackName)) {
    throw 'B5-J4c Bootstrap Stack still exists after Delete.'
  }
  Assert-BootstrapNamedResourcesAbsent -AwsCli $awsCli
  Assert-PaidCellAndTenantResourcesAbsent -AwsCli $awsCli
  Write-Host "Deleted exact plan-only B5-J4c Bootstrap Stack: $ConfirmStackId"
  Write-Host 'Immediately revoke BootstrapRollbackGrant.'
} finally {
  foreach ($path in @(
    $templateSnapshotPath,
    $legacyTemplateSnapshotPath,
    $deployedJ4cTemplateSnapshotPath,
    $authorityV2TemplateSnapshotPath
  )) {
    if (Test-Path -LiteralPath $path) {
      (Get-Item -LiteralPath $path).IsReadOnly = $false
    }
  }
  $resolvedTemp = [System.IO.Path]::GetFullPath($temporaryDirectory)
  $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if (
    $resolvedTemp.StartsWith($expectedTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
    (Split-Path -Leaf $resolvedTemp) -match '^techlong-b5j4c-bootstrap-[a-f0-9]{32}$' -and
    (Test-Path -LiteralPath $resolvedTemp)
  ) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
