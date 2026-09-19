[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate')]
  [string]$Mode = 'LocalValidate',
  [string]$Profile = 'techlong-sandbox-user',
  [string]$CertificateArn = '',
  [string]$ControlTrustStoreArn = ''
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedProfile = 'techlong-sandbox-user'
$expectedPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$expectedUserName = 'techlong-sandbox-dev'
$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa/techlong-sandbox-dev'
$managementStackName = 'techlong-s3-b5-cell-lifecycle-management'
$cellStackName = 'techlong-sandbox-cell-sandbox-1'
$authorityTableName = 'techlong-sandbox-tenant-external-epoch-authority'
$authorityKey = 'cell:cell-sandbox-1'
$bootstrapStackName = 'techlong-s3-b5-cell-bootstrap'
$bootstrapExecutionRoleArn =
  'arn:aws:iam::402010193138:role/TechlongSandboxCellBootstrapCloudFormationExecutionRole'
$cellJanitorFunctionArn =
  'arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor'
$cellSchedulerInvokeRoleArn =
  'arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole'
$cellSchedulerGroupName = 'techlong-sandbox-cell'
$cellGlobalJanitorScheduleName = 'techlong-sandbox-cell-global-janitor'
$templateBucketName = 'techlong-sandbox-build-source-402010193138-ca-central-1'
$templatePrefix = 'b5-shared-cell/templates/sha256'
$immutableTemplatePolicySid = 'DenyMutableSharedCellTemplateOperation'
$expectedAvailabilityZones = @('ca-central-1a', 'ca-central-1b')
$expectedEngine = 'aurora-postgresql'
$expectedEngineVersion = '16.14'
$expectedDbInstanceClass = 'db.serverless'
$validator = Join-Path $PSScriptRoot 'validate-b5-shared-cell-prerequisite-preflight.mjs'
$lifecycleController = Join-Path $PSScriptRoot 's3-b5-cell-lifecycle-management.ps1'

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $knownPath = 'D:\Amazon\AWSCLIV2\aws.exe'
  if (Test-Path -LiteralPath $knownPath -PathType Leaf) { return $knownPath }
  throw 'AWS CLI v2 was not found.'
}

function Resolve-PowerShell {
  $command = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'PowerShell 7 (pwsh) was not found.'
}

function Add-AwsReadTimeoutArguments {
  param([Parameter(Mandatory)][string[]]$Arguments)
  return $Arguments + @(
    '--cli-connect-timeout', '10',
    '--cli-read-timeout', '30',
    '--no-cli-pager'
  )
}

function ConvertFrom-ExactJson {
  param([Parameter(Mandatory)][string]$Json)
  return ($Json | ConvertFrom-Json -Depth 100)
}

function Invoke-AwsReadJson {
  param(
    [Parameter(Mandatory)][string]$AwsCli,
    [Parameter(Mandatory)][string[]]$Arguments,
    [switch]$AllowEmptyObject
  )
  $safeArguments = Add-AwsReadTimeoutArguments -Arguments ($Arguments + @('--output', 'json'))
  $output = & $AwsCli @safeArguments 2>&1
  $exitCode = $LASTEXITCODE
  $text = (($output | Out-String).Trim())
  if ($exitCode -ne 0) {
    throw "AWS read failed with exit code ${exitCode}: $text"
  }
  if ([string]::IsNullOrWhiteSpace($text)) {
    if ($AllowEmptyObject) { return [PSCustomObject]@{} }
    throw 'AWS read returned no JSON.'
  }
  return (ConvertFrom-ExactJson -Json $text)
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
      throw "Refusing AWS access while override $name is set."
    }
  }
  foreach ($key in [Environment]::GetEnvironmentVariables().Keys) {
    if ([string]$key -imatch '^AWS_ENDPOINT_URL(?:_|$)') {
      throw "Refusing AWS access while endpoint override $key is set."
    }
  }
  $sections = Read-AwsSharedConfigSections
  foreach ($sectionName in @('default', $expectedProfile, "profile $expectedProfile")) {
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
    [Parameter(Mandatory)][string]$Key
  )
  $value = ((& $AwsCli configure get $Key --profile $Profile) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Unable to read AWS profile setting $Key." }
  return $value
}

function Assert-ExactSourceIdentity {
  param([Parameter(Mandatory)][string]$AwsCli)
  if ($Profile -cne $expectedProfile) {
    throw "Use only the reviewed Source profile $expectedProfile."
  }
  $loginSession = Get-AwsConfigValue -AwsCli $AwsCli -Key 'login_session'
  $region = Get-AwsConfigValue -AwsCli $AwsCli -Key 'region'
  if ($loginSession -cne $expectedPrincipalArn -or $region -cne $expectedRegion) {
    throw 'Source profile login_session or Region drifted.'
  }
  $credentialInventory = ((& $AwsCli configure list --profile $Profile) | Out-String)
  if (
    $LASTEXITCODE -ne 0 -or
    $credentialInventory -cnotmatch '(?m)^\s*access_key\s*:\s*\S+\s*:\s*login\s*:' -or
    $credentialInventory -cnotmatch '(?m)^\s*secret_key\s*:\s*\S+\s*:\s*login\s*:'
  ) {
    throw 'Source credentials must resolve from the reviewed AWS CLI login session.'
  }
  $identity = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'sts', 'get-caller-identity', '--profile', $Profile, '--region', $expectedRegion
  )
  if (
    [string]$identity.Account -cne $expectedAccountId -or
    [string]$identity.Arn -cne $expectedPrincipalArn
  ) {
    throw "Caller must be exactly $expectedPrincipalArn in account $expectedAccountId."
  }
  $mfa = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-mfa-devices', '--profile', $Profile, '--user-name', $expectedUserName
  )
  $devices = @($mfa.MFADevices)
  if (
    $devices.Count -ne 1 -or
    [string]$devices[0].UserName -cne $expectedUserName -or
    [string]$devices[0].SerialNumber -cne $expectedMfaDeviceArn
  ) {
    throw "Source user must have exactly MFA device $expectedMfaDeviceArn."
  }
}

function Invoke-LockedManagementReadback {
  param([Parameter(Mandatory)][string]$PowerShell)
  $output = & $PowerShell `
    -NoLogo -NoProfile -NonInteractive `
    -File $lifecycleController `
    -Mode Readback `
    -UpdateShape InitialLocked `
    -Profile $Profile 2>&1
  $exitCode = $LASTEXITCODE
  $text = (($output | Out-String).Trim())
  if ($exitCode -ne 0) {
    throw "Exact Locked management-root readback failed with exit code ${exitCode}: $text"
  }
  if (
    $text -cnotmatch 'Strict Locked management Stack readback passed:' -or
    $text -cnotmatch 'Readback passed for exact InitialLocked IAM management root\.'
  ) {
    throw 'Lifecycle controller did not emit its exact Locked readback attestations.'
  }
}

function Assert-ExactMissingStackRead {
  param(
    [Parameter(Mandatory)][string]$AwsCli,
    [Parameter(Mandatory)][string]$Operation,
    [Parameter(Mandatory)][string[]]$Arguments
  )
  $safeArguments = Add-AwsReadTimeoutArguments -Arguments $Arguments
  $output = & $AwsCli @safeArguments 2>&1
  $exitCode = $LASTEXITCODE
  $errorText = (($output | Out-String).Trim())
  if ($exitCode -eq 0) {
    throw "CloudFormation $Operation unexpectedly found the Shared Cell Stack."
  }
  if ($errorText -match '(?i)(AccessDenied|Unauthorized|not authorized)') {
    throw "CloudFormation $Operation was denied; denial is never accepted as MISSING."
  }
  if (
    $errorText -notmatch '(?i)\(ValidationError\)' -or
    $errorText -notmatch "(?i)when calling the $([regex]::Escape($Operation)) operation" -or
    $errorText -notmatch "(?i)$([regex]::Escape($cellStackName)).*does not exist"
  ) {
    throw "CloudFormation $Operation did not return the exact MISSING result: $errorText"
  }
}

function Assert-SharedCellStackMissing {
  param([Parameter(Mandatory)][string]$AwsCli)
  Assert-ExactMissingStackRead -AwsCli $AwsCli -Operation 'DescribeStacks' -Arguments @(
    'cloudformation', 'describe-stacks', '--profile', $Profile, '--region', $expectedRegion,
    '--stack-name', $cellStackName, '--output', 'json'
  )
  Assert-ExactMissingStackRead -AwsCli $AwsCli -Operation 'GetTemplate' -Arguments @(
    'cloudformation', 'get-template', '--profile', $Profile, '--region', $expectedRegion,
    '--stack-name', $cellStackName, '--template-stage', 'Original', '--output', 'json'
  )
  Assert-ExactMissingStackRead -AwsCli $AwsCli -Operation 'ListStackResources' -Arguments @(
    'cloudformation', 'list-stack-resources', '--profile', $Profile, '--region', $expectedRegion,
    '--stack-name', $cellStackName, '--no-paginate', '--output', 'json'
  )
}

function Assert-AuthorityAbsent {
  param([Parameter(Mandatory)][string]$AwsCli)
  $keyDocument = '{"authority_key":{"S":"cell:cell-sandbox-1"}}'
  $response = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'dynamodb', 'get-item', '--profile', $Profile, '--region', $expectedRegion,
    '--table-name', $authorityTableName, '--key', $keyDocument,
    '--consistent-read', '--return-consumed-capacity', 'NONE'
  ) -AllowEmptyObject
  $properties = @($response.PSObject.Properties.Name)
  if ($properties -contains 'Item') {
    throw "Authority key $authorityKey is PRESENT; its value was not displayed."
  }
  if ($properties.Count -ne 0) {
    throw 'Authority GetItem returned an unexpected response shape.'
  }
}

function ConvertTo-UniqueMap {
  param(
    [object[]]$Entries,
    [Parameter(Mandatory)][string]$KeyProperty,
    [Parameter(Mandatory)][string]$ValueProperty,
    [Parameter(Mandatory)][string]$Label
  )
  $result = @{}
  foreach ($entry in @($Entries)) {
    $key = [string]$entry.$KeyProperty
    if ([string]::IsNullOrWhiteSpace($key) -or $result.ContainsKey($key)) {
      throw "$Label contains an empty or duplicate key."
    }
    $result[$key] = [string]$entry.$ValueProperty
  }
  return $result
}

function Assert-ExactMap {
  param(
    [hashtable]$Actual,
    [hashtable]$Expected,
    [Parameter(Mandatory)][string]$Label
  )
  if ($Actual.Count -ne $Expected.Count) { throw "$Label count drifted." }
  foreach ($key in $Expected.Keys) {
    if (-not $Actual.ContainsKey($key) -or [string]$Actual[$key] -cne [string]$Expected[$key]) {
      throw "$Label value for $key drifted."
    }
  }
}

function Assert-ExistingPlanOnlyJanitor {
  param([Parameter(Mandatory)][string]$AwsCli)
  $stackResponse = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'describe-stacks', '--profile', $Profile, '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName
  )
  $stacks = @($stackResponse.Stacks)
  if ($stacks.Count -ne 1) { throw 'Bootstrap Stack count drifted.' }
  $stack = $stacks[0]
  if (
    [string]$stack.StackName -cne $bootstrapStackName -or
    [string]$stack.StackId -cnotmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/[0-9a-f-]{36}$' -or
    [string]$stack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE') -or
    [string]$stack.RoleARN -cne $bootstrapExecutionRoleArn
  ) {
    throw 'Bootstrap Stack identity, status, or execution role drifted.'
  }
  $outputs = ConvertTo-UniqueMap `
    -Entries @($stack.Outputs) -KeyProperty 'OutputKey' -ValueProperty 'OutputValue' `
    -Label 'Bootstrap Stack output'
  Assert-ExactMap -Actual $outputs -Expected @{
    CellJanitorFunctionArn = $cellJanitorFunctionArn
    CellSchedulerInvokeRoleArn = $cellSchedulerInvokeRoleArn
    CellSchedulerGroupName = $cellSchedulerGroupName
    ApprovedCellStackName = $cellStackName
    SafetyState = 'B5_J4C_OWNERSHIP_FENCED_PLAN_ONLY_ALL_MUTATIONS_DISABLED'
  } -Label 'Bootstrap Stack output'

  $lambda = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'lambda', 'get-function-configuration', '--profile', $Profile, '--region', $expectedRegion,
    '--function-name', 'techlong-sandbox-cell-janitor'
  )
  if (
    [string]$lambda.FunctionArn -cne $cellJanitorFunctionArn -or
    [string]$lambda.Role -cne 'arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole' -or
    [string]$lambda.State -cne 'Active' -or
    [string]$lambda.LastUpdateStatus -cne 'Successful' -or
    [string]$lambda.Environment.Variables.CELL_CLEANUP_COORDINATOR_MODE -cne 'PLAN_ONLY' -or
    [string]$lambda.Environment.Variables.EXPECTED_ACCOUNT_ID -cne $expectedAccountId -or
    [string]$lambda.Environment.Variables.EXPECTED_REGION -cne $expectedRegion -or
    [string]$lambda.Environment.Variables.EXPECTED_CELL_ID -cne 'cell-sandbox-1' -or
    [string]$lambda.Environment.Variables.CELL_CLEANUP_AUTHORITY_KEY -cne $authorityKey
  ) {
    throw 'Cell Janitor Lambda identity, health, or PLAN_ONLY environment drifted.'
  }

  $group = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'scheduler', 'get-schedule-group', '--profile', $Profile, '--region', $expectedRegion,
    '--name', $cellSchedulerGroupName
  )
  if (
    [string]$group.Name -cne $cellSchedulerGroupName -or
    [string]$group.Arn -cne 'arn:aws:scheduler:ca-central-1:402010193138:schedule-group/techlong-sandbox-cell' -or
    [string]$group.State -cne 'ACTIVE'
  ) { throw 'Cell Scheduler group identity or state drifted.' }

  $schedule = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'scheduler', 'get-schedule', '--profile', $Profile, '--region', $expectedRegion,
    '--group-name', $cellSchedulerGroupName, '--name', $cellGlobalJanitorScheduleName
  )
  if (
    [string]$schedule.Name -cne $cellGlobalJanitorScheduleName -or
    [string]$schedule.GroupName -cne $cellSchedulerGroupName -or
    [string]$schedule.State -cne 'DISABLED' -or
    [string]$schedule.ScheduleExpression -cne 'rate(15 minutes)' -or
    [string]$schedule.FlexibleTimeWindow.Mode -cne 'OFF' -or
    [string]$schedule.Target.Arn -cne $cellJanitorFunctionArn -or
    [string]$schedule.Target.RoleArn -cne $cellSchedulerInvokeRoleArn -or
    [int]$schedule.Target.RetryPolicy.MaximumRetryAttempts -ne 0 -or
    [string]$schedule.Target.Input -cne '{"schemaVersion":1,"action":"inspect_cell_cleanup_plan"}'
  ) {
    throw 'Global Cell Janitor Schedule is not the exact DISABLED PLAN_ONLY target.'
  }
}

function Assert-ExactAvailabilityZones {
  param([Parameter(Mandatory)][string]$AwsCli)
  $response = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'ec2', 'describe-availability-zones', '--profile', $Profile, '--region', $expectedRegion,
    '--filters',
    "Name=region-name,Values=$expectedRegion",
    'Name=zone-type,Values=availability-zone',
    'Name=state,Values=available'
  )
  $available = @($response.AvailabilityZones)
  foreach ($expectedZone in $expectedAvailabilityZones) {
    $matches = @($available | Where-Object { [string]$_.ZoneName -ceq $expectedZone })
    if (
      $matches.Count -ne 1 -or
      [string]$matches[0].RegionName -cne $expectedRegion -or
      [string]$matches[0].ZoneType -cne 'availability-zone' -or
      [string]$matches[0].State -cne 'available' -or
      [string]$matches[0].OptInStatus -notin @('opt-in-not-required', 'opted-in') -or
      [string]$matches[0].ZoneId -cnotmatch '^cac1-az[0-9]+$'
    ) {
      throw "Availability Zone $expectedZone is not exact, available, and opted in."
    }
    Write-Host "AZ $expectedZone => $([string]$matches[0].ZoneId)"
  }
  $zoneIds = @(
    $available |
      Where-Object { [string]$_.ZoneName -in $expectedAvailabilityZones } |
      ForEach-Object { [string]$_.ZoneId }
  )
  if (@($zoneIds | Select-Object -Unique).Count -ne 2) {
    throw 'The two reviewed availability-zone names do not map to two unique ZoneIds.'
  }
}

function Assert-ExactCertificate {
  param([Parameter(Mandatory)][string]$AwsCli)
  $response = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'acm', 'describe-certificate', '--profile', $Profile, '--region', $expectedRegion,
    '--certificate-arn', $CertificateArn
  )
  $certificate = $response.Certificate
  if (
    [string]$certificate.CertificateArn -cne $CertificateArn -or
    [string]$certificate.Status -cne 'ISSUED' -or
    [string]$certificate.Type -notin @('AMAZON_ISSUED', 'IMPORTED') -or
    [string]$certificate.KeyAlgorithm -notin @(
      'RSA_2048', 'RSA_3072', 'RSA_4096', 'EC_prime256v1', 'EC_secp384r1'
    ) -or
    @($certificate.SubjectAlternativeNames) -cnotcontains '*.sandbox.techlong.cloud'
  ) {
    throw 'ACM certificate is not the exact issued, ALB-compatible Sandbox wildcard certificate.'
  }
  $notAfter = [DateTimeOffset]::Parse(
    [string]$certificate.NotAfter,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
  )
  if ($notAfter -le [DateTimeOffset]::UtcNow.AddHours(4)) {
    throw 'ACM certificate expires before the complete Shared Cell TTL safety window.'
  }
}

function Assert-ExactTrustStore {
  param([Parameter(Mandatory)][string]$AwsCli)
  $response = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'elbv2', 'describe-trust-stores', '--profile', $Profile, '--region', $expectedRegion,
    '--trust-store-arns', $ControlTrustStoreArn
  )
  $trustStores = @($response.TrustStores)
  if (
    $trustStores.Count -ne 1 -or
    [string]$trustStores[0].TrustStoreArn -cne $ControlTrustStoreArn -or
    [string]$trustStores[0].Status -cne 'ACTIVE' -or
    [string]$trustStores[0].Name -cnotmatch '^[A-Za-z0-9._-]{1,32}$' -or
    [int]$trustStores[0].NumberOfCaCertificates -lt 1
  ) {
    throw 'ELB trust store is not the exact ACTIVE store with at least one CA certificate.'
  }
}

function Assert-ExactRdsServerlessSupport {
  param([Parameter(Mandatory)][string]$AwsCli)
  $versions = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'rds', 'describe-db-engine-versions', '--profile', $Profile, '--region', $expectedRegion,
    '--engine', $expectedEngine, '--engine-version', $expectedEngineVersion, '--include-all'
  )
  $matches = @(
    $versions.DBEngineVersions |
      Where-Object {
        [string]$_.Engine -ceq $expectedEngine -and
        [string]$_.EngineVersion -ceq $expectedEngineVersion
      }
  )
  if ($matches.Count -ne 1) { throw 'RDS did not return exactly Aurora PostgreSQL 16.14.' }
  $engine = $matches[0]
  if (
    [string]$engine.Status -cne 'available' -or
    [string]$engine.DBParameterGroupFamily -cne 'aurora-postgresql16' -or
    @($engine.SupportedEngineModes) -cnotcontains 'provisioned' -or
    @($engine.SupportsLogExportsToCloudwatchLogs) -cnotcontains 'postgresql' -or
    $null -eq $engine.ServerlessV2FeaturesSupport -or
    [double]$engine.ServerlessV2FeaturesSupport.MinCapacity -gt 0 -or
    [double]$engine.ServerlessV2FeaturesSupport.MaxCapacity -lt 1
  ) {
    throw 'Aurora PostgreSQL 16.14 lacks the reviewed Serverless v2 or log-export contract.'
  }

  $orderable = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    'rds', 'describe-orderable-db-instance-options',
    '--profile', $Profile, '--region', $expectedRegion,
    '--engine', $expectedEngine, '--engine-version', $expectedEngineVersion,
    '--db-instance-class', $expectedDbInstanceClass, '--vpc'
  )
  $supported = @(
    $orderable.OrderableDBInstanceOptions |
      Where-Object {
        [string]$_.Engine -ceq $expectedEngine -and
        [string]$_.EngineVersion -ceq $expectedEngineVersion -and
        [string]$_.DBInstanceClass -ceq $expectedDbInstanceClass -and
        @($_.AvailabilityZones.Name) -contains $expectedAvailabilityZones[0] -and
        @($_.AvailabilityZones.Name) -contains $expectedAvailabilityZones[1]
      }
  )
  if ($supported.Count -lt 1) {
    throw 'db.serverless for Aurora PostgreSQL 16.14 is not orderable in both reviewed AZs.'
  }
}

function Assert-RequiredServiceLinkedRoles {
  param([Parameter(Mandatory)][string]$AwsCli)
  $contracts = @(
    [PSCustomObject]@{
      Name = 'AWSServiceRoleForElasticLoadBalancing'
      Service = 'elasticloadbalancing.amazonaws.com'
    },
    [PSCustomObject]@{
      Name = 'AWSServiceRoleForECS'
      Service = 'ecs.amazonaws.com'
    },
    [PSCustomObject]@{
      Name = 'AWSServiceRoleForRDS'
      Service = 'rds.amazonaws.com'
    }
  )
  foreach ($contract in $contracts) {
    $response = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
      'iam', 'get-role', '--profile', $Profile, '--role-name', $contract.Name
    )
    $expectedPath = "/aws-service-role/$($contract.Service)/"
    $expectedArn = "arn:aws:iam::$expectedAccountId`:role$expectedPath$($contract.Name)"
    if (
      [string]$response.Role.RoleName -cne $contract.Name -or
      [string]$response.Role.Path -cne $expectedPath -or
      [string]$response.Role.Arn -cne $expectedArn
    ) {
      throw "Required service-linked role $($contract.Name) drifted."
    }
  }
}

function Assert-ImmutableTemplateBucketPolicy {
  param([Parameter(Mandatory)][string]$AwsCli)
  $response = Invoke-AwsReadJson -AwsCli $AwsCli -Arguments @(
    's3api', 'get-bucket-policy', '--profile', $Profile, '--region', $expectedRegion,
    '--bucket', $templateBucketName, '--expected-bucket-owner', $expectedAccountId
  )
  if ([string]::IsNullOrWhiteSpace([string]$response.Policy)) {
    throw 'Build-source Bucket Policy body is missing.'
  }
  $policy = ConvertFrom-ExactJson -Json ([string]$response.Policy)
  if ([string]$policy.Version -cne '2012-10-17') {
    throw 'Build-source Bucket Policy version drifted.'
  }
  $matches = @($policy.Statement | Where-Object {
    [string]$_.Sid -ceq $immutableTemplatePolicySid
  })
  if ($matches.Count -ne 1) {
    throw "Build-source Bucket Policy must contain exactly one $immutableTemplatePolicySid statement."
  }
  $deny = $matches[0]
  $actions = @($deny.Action)
  $conditionOperators = @($deny.Condition.PSObject.Properties.Name)
  $conditionKeys = @($deny.Condition.StringNotEquals.PSObject.Properties.Name)
  if (
    [string]$deny.Effect -cne 'Deny' -or
    [string]$deny.Principal -cne '*' -or
    $actions.Count -ne 2 -or
    $actions -cnotcontains 's3:PutObject' -or
    $actions -cnotcontains 's3:DeleteObject' -or
    [string]$deny.Resource -cne "arn:aws:s3:::$templateBucketName/$templatePrefix/*" -or
    $conditionOperators.Count -ne 1 -or
    [string]$conditionOperators[0] -cne 'StringNotEquals' -or
    $conditionKeys.Count -ne 1 -or
    [string]$conditionKeys[0] -cne 's3:if-none-match' -or
    [string]$deny.Condition.StringNotEquals.'s3:if-none-match' -cne '*'
  ) {
    throw "$immutableTemplatePolicySid is not the exact create-if-absent/write-and-delete deny."
  }
}

function Invoke-PreflightCheck {
  param(
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][scriptblock]$Check,
    [Parameter(Mandatory)][System.Collections.Generic.List[string]]$Blockers
  )
  try {
    & $Check
    Write-Host "PASS [$Label]"
  } catch {
    $message = $_.Exception.Message.Trim()
    $Blockers.Add("$Label :: $message")
    Write-Host "BLOCKER [$Label] $message"
  }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found.' }
foreach ($requiredPath in @($validator, $lifecycleController)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required preflight file was not found at $requiredPath."
  }
}

& $nodeCommand.Source $validator
if ($LASTEXITCODE -ne 0) {
  throw 'Shared Cell prerequisite preflight local validation failed.'
}

if ($Mode -eq 'LocalValidate') {
  if (
    -not [string]::IsNullOrEmpty($CertificateArn) -or
    -not [string]::IsNullOrEmpty($ControlTrustStoreArn) -or
    $Profile -cne $expectedProfile
  ) {
    throw 'LocalValidate accepts no online ARN or alternate-profile arguments.'
  }
  Write-Host 'Local validation complete. No AWS API was called.'
  exit 0
}

if (
  $Profile -cne $expectedProfile -or
  $Profile -cnotmatch '^[A-Za-z0-9_-]{1,64}$'
) { throw "OnlineValidate requires exact Source profile $expectedProfile." }
if ($CertificateArn -cnotmatch '^arn:aws:acm:ca-central-1:402010193138:certificate/[0-9a-f-]{36}$') {
  throw 'OnlineValidate requires an exact ca-central-1 Sandbox ACM certificate ARN.'
}
if ($ControlTrustStoreArn -cnotmatch '^arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/[A-Za-z0-9._-]+/[a-z0-9]+$') {
  throw 'OnlineValidate requires an exact ca-central-1 Sandbox ELB trust-store ARN.'
}

Assert-NoCredentialOrEndpointOverrides
$previousEnvironment = @{
  AWS_IGNORE_CONFIGURED_ENDPOINT_URLS =
    [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')
  AWS_PAGER = [Environment]::GetEnvironmentVariable('AWS_PAGER')
  AWS_CLI_AUTO_PROMPT = [Environment]::GetEnvironmentVariable('AWS_CLI_AUTO_PROMPT')
  AWS_MAX_ATTEMPTS = [Environment]::GetEnvironmentVariable('AWS_MAX_ATTEMPTS')
}

try {
  [Environment]::SetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS', 'true')
  [Environment]::SetEnvironmentVariable('AWS_PAGER', '')
  [Environment]::SetEnvironmentVariable('AWS_CLI_AUTO_PROMPT', 'off')
  [Environment]::SetEnvironmentVariable('AWS_MAX_ATTEMPTS', '3')
  $awsCli = Resolve-AwsCli
  $powerShell = Resolve-PowerShell
  $blockers = [System.Collections.Generic.List[string]]::new()

  try {
    Assert-ExactSourceIdentity -AwsCli $awsCli
    Write-Host 'PASS [SourceIdentityAndMfaLoginSession]'
  } catch {
    $message = $_.Exception.Message.Trim()
    Write-Host "BLOCKER [SourceIdentityAndMfaLoginSession] $message"
    throw 'Source identity precondition failed; no further AWS prerequisite reads were attempted.'
  }

  Invoke-PreflightCheck -Label 'LockedManagementRootAndFourIamResources' -Blockers $blockers -Check {
    Invoke-LockedManagementReadback -PowerShell $powerShell
  }
  Invoke-PreflightCheck -Label 'SharedCellStackMissing' -Blockers $blockers -Check {
    Assert-SharedCellStackMissing -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'CellAuthorityAbsent' -Blockers $blockers -Check {
    Assert-AuthorityAbsent -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'PlanOnlyJanitorAndDisabledScheduler' -Blockers $blockers -Check {
    Assert-ExistingPlanOnlyJanitor -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'ExecutableTtlJanitorCompatibility' -Blockers $blockers -Check {
    throw 'PLAN_ONLY_JANITOR_EVENT_INCOMPATIBLE: deployed Janitor accepts inspect_cell_cleanup_plan, while the candidate Schedule emits delete_shared_cell_stack.'
  }
  Invoke-PreflightCheck -Label 'TwoAvailabilityZones' -Blockers $blockers -Check {
    Assert-ExactAvailabilityZones -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'AcmCertificate' -Blockers $blockers -Check {
    Assert-ExactCertificate -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'ElbTrustStore' -Blockers $blockers -Check {
    Assert-ExactTrustStore -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'AuroraPostgresql16_14ServerlessV2' -Blockers $blockers -Check {
    Assert-ExactRdsServerlessSupport -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'RequiredServiceLinkedRoles' -Blockers $blockers -Check {
    Assert-RequiredServiceLinkedRoles -AwsCli $awsCli
  }
  Invoke-PreflightCheck -Label 'ImmutableSharedCellTemplateObjectPolicy' -Blockers $blockers -Check {
    Assert-ImmutableTemplateBucketPolicy -AwsCli $awsCli
  }

  if ($blockers.Count -ne 0) {
    Write-Host "ONLINE PREFLIGHT BLOCKED: $($blockers.Count) prerequisite blocker(s)."
    foreach ($blocker in $blockers) { Write-Host " - $blocker" }
    throw 'Shared Cell prerequisite preflight did not pass.'
  }
  Write-Host 'ONLINE PREFLIGHT PASSED: all reviewed prerequisites are present.'
  Write-Host 'No Change Set, Stack, IAM policy, Cell, database, network, certificate, trust store, Schedule, or authority item was created or changed.'
} finally {
  foreach ($entry in $previousEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value)
  }
}
