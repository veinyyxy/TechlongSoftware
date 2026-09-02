[CmdletBinding()]
param(
  [ValidateSet(
    'LocalValidate',
    'OnlineValidate',
    'CreateChangeSet',
    'InspectChangeSet',
    'ExecuteChangeSet',
    'CreateRollbackChangeSet',
    'InspectRollbackChangeSet',
    'ExecuteRollbackChangeSet'
  )]
  [string]$Mode = 'LocalValidate',
  [ValidateSet(
    'InitialB5Support',
    'CodeBuildImagePull',
    'LifecycleReadback',
    'LifecycleTaskRegistrationGrant',
    'LifecycleTaskRegistrationRevoke',
    'SharedCellProvisionAuthorityInstallGrant',
    'SharedCellProvisionAuthorityInstallRevoke'
  )]
  [string]$UpdateShape = 'InitialB5Support',
  [string]$Profile = 'techlong-sandbox-user',
  [string]$GrantExpiresAt = '',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmRegion = '',
  [string]$ConfirmBootstrapStackName = '',
  [string]$ConfirmExecutionPhrase = '',
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeLowCostNotFree,
  [switch]$AcknowledgeSourceUserBootstrapRisk,
  [switch]$AcknowledgeMfaSession,
  [switch]$AcknowledgeChangeSetReviewed,
  [switch]$AcknowledgeDeleteAllReceipts,
  [switch]$AcknowledgeDeleteAuthorityRecords
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$expectedUserName = 'techlong-sandbox-dev'
$expectedMfaDeviceArn = 'arn:aws:iam::402010193138:mfa/techlong-sandbox-dev'
$bootstrapStackName = 'techlong-s3-bootstrap'
$receiptBucketName = 'techlong-sandbox-402010193138-ca-central-1-tenant-receipts'
$authorityTableName = 'techlong-sandbox-tenant-external-epoch-authority'
$authorityTableArn = "arn:aws:dynamodb:${expectedRegion}:${expectedAccountId}:table/$authorityTableName"
$provisionerRoleArn = "arn:aws:iam::${expectedAccountId}:role/TechlongSandboxProvisionerRole"
$provisionerBoundaryArn = "arn:aws:iam::${expectedAccountId}:policy/TechlongSandboxProvisionerBoundary"
$sharedCellRootStackArn = "arn:aws:cloudformation:${expectedRegion}:${expectedAccountId}:stack/techlong-sandbox-cell-sandbox-1/*"
$sharedCellAuthorityKey = 'cell:cell-sandbox-1'
$grantExpiryPattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
$root = Split-Path -Parent $PSScriptRoot
$validator = Join-Path $root 'scripts\validate-b5-support.mjs'
$renderer = Join-Path $root 'scripts\render-bootstrap.mjs'
$rollbackRenderer = Join-Path $root 'scripts\render-b5-support-rollback.mjs'
$templateVerifier = Join-Path $root 'scripts\verify-change-set-template.mjs'
$managedPolicyVerifier = Join-Path $root 'scripts\verify-managed-policy-document.mjs'
$supportInfrastructureWriteReady = $true
$reviewedUpdateShape = if ($UpdateShape -ieq 'CodeBuildImagePull') {
  'CodeBuildImagePull'
} elseif ($UpdateShape -ieq 'LifecycleReadback') {
  'LifecycleReadback'
} elseif ($UpdateShape -ieq 'LifecycleTaskRegistrationGrant') {
  'LifecycleTaskRegistrationGrant'
} elseif ($UpdateShape -ieq 'LifecycleTaskRegistrationRevoke') {
  'LifecycleTaskRegistrationRevoke'
} elseif ($UpdateShape -ieq 'SharedCellProvisionAuthorityInstallGrant') {
  'SharedCellProvisionAuthorityInstallGrant'
} elseif ($UpdateShape -ieq 'SharedCellProvisionAuthorityInstallRevoke') {
  'SharedCellProvisionAuthorityInstallRevoke'
} else {
  'InitialB5Support'
}
$rollbackModes = @(
  'CreateRollbackChangeSet',
  'InspectRollbackChangeSet',
  'ExecuteRollbackChangeSet'
)
if ($Mode -in $rollbackModes -and $reviewedUpdateShape -ne 'InitialB5Support') {
  throw 'Rollback modes only support -UpdateShape InitialB5Support; incremental IAM update shapes have no standalone rollback shape.'
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

function Assert-SharedCellProvisionAuthorityShapeInputs {
  $isGrant = $reviewedUpdateShape -ceq 'SharedCellProvisionAuthorityInstallGrant'
  $isRevoke = $reviewedUpdateShape -ceq 'SharedCellProvisionAuthorityInstallRevoke'
  if ($isGrant) {
    $expiry = ConvertFrom-CanonicalGrantExpiry -Value $GrantExpiresAt
    if ($Mode -ne 'LocalValidate') {
      $remaining = $expiry - [DateTime]::UtcNow
      $minimumMinutes = if ($Mode -eq 'ExecuteChangeSet') { 10 } else { 15 }
      if ($remaining.TotalMinutes -le $minimumMinutes -or $remaining.TotalMinutes -gt 60) {
        throw "The temporary install grant must have more than $minimumMinutes and no more than 60 minutes remaining."
      }
    }
  } elseif ($isRevoke) {
    if (-not [string]::IsNullOrEmpty($GrantExpiresAt)) {
      throw 'SharedCellProvisionAuthorityInstallRevoke does not accept -GrantExpiresAt.'
    }
  } elseif (-not [string]::IsNullOrEmpty($GrantExpiresAt)) {
    throw "$reviewedUpdateShape does not accept -GrantExpiresAt."
  }
}

Assert-SharedCellProvisionAuthorityShapeInputs

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
  return (($output | Out-String) | ConvertFrom-Json)
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
    throw 'Unable to canonicalize the locally rendered template.'
  }
  $hash = (($output | Out-String).Trim())
  if ($hash -cnotmatch '^[a-f0-9]{64}$') {
    throw 'The local canonical template digest is invalid.'
  }
  return $hash
}

function Assert-ExactSourceLoginSession {
  param([string]$AwsCli)
  foreach ($credentialVariable in @(
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN'
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
    throw 'AWS profile credentials must resolve from AWS CLI login; environment, shared-credentials-file, config static keys, credential_process, and assume-role sources are rejected.'
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
  $pendingProfiles = [System.Collections.Generic.Stack[string]]::new()
  $pendingProfiles.Push($Profile)
  $pendingProfiles.Push('default')
  $visitedProfiles = @{}
  while ($pendingProfiles.Count -gt 0) {
    $profileName = $pendingProfiles.Pop()
    if ($visitedProfiles.ContainsKey($profileName)) { continue }
    $visitedProfiles[$profileName] = $true

    if ($profileName -notmatch '^[A-Za-z0-9_-]{1,64}$') {
      throw "AWS source profile name $profileName contains unsupported characters."
    }
    $candidateSections = if ($profileName -eq 'default') {
      @('default')
    } else {
      @("profile $profileName", $profileName)
    }
    $profileLines = [System.Collections.Generic.List[string]]::new()
    foreach ($candidateSection in $candidateSections) {
      $normalizedSection = $candidateSection.ToLowerInvariant()
      if ($sections.ContainsKey($normalizedSection)) {
        $profileLines.AddRange([string[]]$sections[$normalizedSection])
      }
    }
    if ($profileName -eq $Profile -and $profileLines.Count -eq 0) {
      throw "AWS profile $Profile was not found in the shared config file."
    }

    foreach ($line in $profileLines) {
      if ($line -imatch '^\s*endpoint_url\s*=') {
        throw "AWS profile $profileName contains a forbidden endpoint_url override."
      }
      if ($line -imatch '^\s*services\s*=\s*([^#;\s].*?)\s*(?:[#;].*)?$') {
        throw "AWS profile $profileName contains a forbidden services endpoint configuration."
      }
      if ($line -imatch '^\s*source_profile\s*=\s*([^#;]+?)\s*(?:[#;].*)?$') {
        $sourceProfile = $Matches[1].Trim()
        if ($sourceProfile -notmatch '^[A-Za-z0-9_-]{1,64}$') {
          throw "AWS source profile name $sourceProfile contains unsupported characters."
        }
        $pendingProfiles.Push($sourceProfile)
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

function Assert-ExactChangeSetTemplate {
  param(
    [string]$AwsCli,
    [string]$ChangeSetName,
    [string]$ExpectedTemplatePath,
    [string]$ExpectedCanonicalHash,
    [string]$ResponsePath
  )
  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'cloudformation', 'get-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName,
    '--change-set-name', $ChangeSetName,
    '--template-stage', 'Original',
    '--output', 'json'
  ) -OutputPath $ResponsePath
  $verifiedHash = ((& node $templateVerifier `
    --expected-template $ExpectedTemplatePath `
    --get-template-response $ResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $verifiedHash -cne $ExpectedCanonicalHash) {
    throw 'Change Set TemplateBody is not the exact locally rendered reviewed template.'
  }
  Write-Host "Verified Change Set canonical template SHA-256: $verifiedHash"
}

function Assert-WriteAcknowledgements {
  if (-not $supportInfrastructureWriteReady) {
    throw 'B5 support infrastructure writes are disabled before any AWS API call.'
  }
  if ($ConfirmAccountId -ne $expectedAccountId) {
    throw "AWS writes require -ConfirmAccountId $expectedAccountId."
  }
  if ($ConfirmRegion -ne $expectedRegion) {
    throw "AWS writes require -ConfirmRegion $expectedRegion."
  }
  if ($ConfirmBootstrapStackName -ne $bootstrapStackName) {
    throw "AWS writes require -ConfirmBootstrapStackName $bootstrapStackName."
  }
  if (-not $AcknowledgeAwsWrite) {
    throw 'AWS writes require -AcknowledgeAwsWrite.'
  }
  if (-not $AcknowledgeLowCostNotFree) {
    throw 'AWS writes require -AcknowledgeLowCostNotFree.'
  }
  if (-not $AcknowledgeSourceUserBootstrapRisk) {
    throw 'AWS writes require -AcknowledgeSourceUserBootstrapRisk for this one controlled bootstrap update.'
  }
  if (-not $AcknowledgeMfaSession) {
    throw 'AWS writes require -AcknowledgeMfaSession as a supplemental human review after the script verifies the login_session profile and exact attached MFA device.'
  }
}

function Assert-ExecuteAcknowledgements {
  param([bool]$Rollback)
  if (-not $AcknowledgeChangeSetReviewed) {
    throw 'Change Set execution requires -AcknowledgeChangeSetReviewed.'
  }
  $expectedPhrase = if ($Rollback) {
    'I_ACKNOWLEDGE_B5_SUPPORT_ROLLBACK_DATA_DELETION'
  } else {
    'I_ACKNOWLEDGE_B5_SUPPORT_BOOTSTRAP_AWS_CHANGES'
  }
  if ($ConfirmExecutionPhrase -cne $expectedPhrase) {
    throw "Change Set execution requires -ConfirmExecutionPhrase $expectedPhrase."
  }
  if ($Rollback) {
    if (-not $AcknowledgeDeleteAllReceipts) {
      throw 'Rollback requires -AcknowledgeDeleteAllReceipts.'
    }
    if (-not $AcknowledgeDeleteAuthorityRecords) {
      throw 'Rollback requires -AcknowledgeDeleteAuthorityRecords.'
    }
  }
}

function Assert-ExactBootstrapStack {
  param([object]$Stack)
  if (
    $Stack.StackName -ne $bootstrapStackName -or
    $Stack.StackId -notmatch '^arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-bootstrap/[0-9a-f-]{36}$' -or
    $Stack.StackStatus -notin @(
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE',
      'UPDATE_ROLLBACK_COMPLETE'
    ) -or
    -not [string]::IsNullOrEmpty([string]$Stack.RoleARN)
  ) {
    throw 'The exact stable Sandbox bootstrap Stack is unavailable for a source-user reviewed update, or it retains a CloudFormation service RoleARN that must be reviewed separately.'
  }
  $tags = @{}
  foreach ($tag in @($Stack.Tags)) { $tags[$tag.Key] = $tag.Value }
  if (
    $tags.Environment -ne 'aws-sandbox' -or
    $tags.ManagedBy -ne 'techlong-provisioner' -or
    $tags.Component -ne 's3-bootstrap'
  ) {
    throw 'The bootstrap Stack ownership tags do not match the reviewed Sandbox contract.'
  }
}

function Assert-ExactCodeBuildImagePullResourceChange {
  param([object]$Resource)

  $scope = @($Resource.Scope)
  $details = @($Resource.Details)
  if ($scope.Count -ne 1 -or $scope[0] -cne 'Properties' -or $details.Count -ne 1) {
    throw "CodeBuildImagePull change details drifted for $($Resource.LogicalResourceId)."
  }
  $detail = $details[0]
  $target = $detail.Target
  if ($Resource.LogicalResourceId -ceq 'CodeBuildRole') {
    if (
      $Resource.PhysicalResourceId -cne 'TechlongSandboxCodeBuildRole' -or
      $Resource.Replacement -cne 'False' -or
      $target.Attribute -cne 'Properties' -or
      $target.Name -cne 'Policies' -or
      $target.RequiresRecreation -cne 'Never' -or
      $detail.Evaluation -cne 'Static' -or
      $detail.ChangeSource -cne 'DirectModification' -or
      -not [string]::IsNullOrEmpty([string]$detail.CausingEntity)
    ) {
      throw 'CodeBuildImagePull may only modify the existing CodeBuild Role inline policy without replacement.'
    }
    return
  }
  if ($Resource.LogicalResourceId -ceq 'SandboxCodeBuildProject') {
    if (
      $Resource.PhysicalResourceId -cne 'techlong-sandbox-speedfeast-image' -or
      $Resource.Replacement -cne 'Conditional' -or
      $target.Attribute -cne 'Properties' -or
      $target.Name -cne 'ServiceRole' -or
      $target.RequiresRecreation -cne 'Conditionally' -or
      $detail.Evaluation -cne 'Dynamic' -or
      $detail.ChangeSource -cne 'ResourceAttribute' -or
      $detail.CausingEntity -cne 'CodeBuildRole.Arn'
    ) {
      throw 'CodeBuildImagePull may only accept the exact dynamic CodeBuild Role ARN dependency on the existing Project.'
    }
    return
  }
  throw "CodeBuildImagePull contains an unexpected resource: $($Resource.LogicalResourceId)."
}

function Assert-ExactProvisionAuthorityBoundaryResourceChange {
  param([object]$Resource)
  if (
    [string]$Resource.LogicalResourceId -cne 'ProvisionerBoundary' -or
    [string]$Resource.ResourceType -cne 'AWS::IAM::ManagedPolicy' -or
    [string]$Resource.PhysicalResourceId -cne $provisionerBoundaryArn -or
    [string]$Resource.Replacement -cne 'False'
  ) {
    throw 'Shared Cell provision-authority grant/revoke may only modify the exact existing ProvisionerBoundary without replacement.'
  }
  $scope = @($Resource.Scope)
  if ($scope.Count -ne 1 -or [string]$scope[0] -cne 'Properties') {
    throw 'Shared Cell provision-authority grant/revoke may only change ProvisionerBoundary properties.'
  }
  $details = @($Resource.Details)
  if ($details.Count -ne 1) {
    throw 'Shared Cell provision-authority grant/revoke must contain one exact policy-document detail.'
  }
  $detail = $details[0]
  if (
    [string]$detail.Target.Attribute -cne 'Properties' -or
    [string]$detail.Target.Name -cne 'PolicyDocument' -or
    [string]$detail.Target.RequiresRecreation -cne 'Never' -or
    [string]$detail.Evaluation -cne 'Static' -or
    [string]$detail.ChangeSource -cne 'DirectModification' -or
    -not [string]::IsNullOrEmpty([string]$detail.CausingEntity)
  ) {
    throw 'Shared Cell provision-authority grant/revoke detail is not the exact direct PolicyDocument modification.'
  }
}

function Assert-ExactProvisionerBoundaryReadback {
  param(
    [string]$AwsCli,
    [string]$ExpectedTemplatePath,
    [string]$PolicyVersionResponsePath
  )
  $policyResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-policy',
    '--profile', $Profile,
    '--policy-arn', $provisionerBoundaryArn,
    '--output', 'json'
  )
  $policy = $policyResponse.Policy
  if (
    [string]$policy.Arn -cne $provisionerBoundaryArn -or
    [string]$policy.PolicyName -cne 'TechlongSandboxProvisionerBoundary' -or
    [string]$policy.Path -cne '/' -or
    [string]$policy.DefaultVersionId -cnotmatch '^v[1-9][0-9]*$' -or
    $policy.IsAttachable -ne $true -or
    [int]$policy.AttachmentCount -ne 1 -or
    [int]$policy.PermissionsBoundaryUsageCount -ne 1
  ) {
    throw 'ProvisionerBoundary managed-policy identity, default version, or usage drifted.'
  }

  Invoke-AwsJsonFile -AwsCli $AwsCli -Arguments @(
    'iam', 'get-policy-version',
    '--profile', $Profile,
    '--policy-arn', $provisionerBoundaryArn,
    '--version-id', [string]$policy.DefaultVersionId,
    '--output', 'json'
  ) -OutputPath $PolicyVersionResponsePath
  $policyHash = ((& node $managedPolicyVerifier `
    --expected-template $ExpectedTemplatePath `
    --get-policy-version-response $PolicyVersionResponsePath) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $policyHash -cnotmatch '^[a-f0-9]{64}$') {
    throw 'ProvisionerBoundary default policy document does not match the exact rendered template.'
  }

  $roleResponse = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'get-role',
    '--profile', $Profile,
    '--role-name', 'TechlongSandboxProvisionerRole',
    '--output', 'json'
  )
  $role = $roleResponse.Role
  if (
    [string]$role.Arn -cne $provisionerRoleArn -or
    [string]$role.RoleName -cne 'TechlongSandboxProvisionerRole' -or
    [int]$role.MaxSessionDuration -ne 3600 -or
    [string]$role.PermissionsBoundary.PermissionsBoundaryArn -cne $provisionerBoundaryArn -or
    [string]$role.PermissionsBoundary.PermissionsBoundaryType -cne 'Policy'
  ) {
    throw 'Provisioner Role identity, session duration, or permissions boundary drifted.'
  }
  $tags = @{}
  foreach ($tag in @($role.Tags)) { $tags[[string]$tag.Key] = [string]$tag.Value }
  if (
    $tags.Count -ne 3 -or
    $tags.Environment -cne 'aws-sandbox' -or
    $tags.ManagedBy -cne 'techlong-provisioner' -or
    $tags.Component -cne 'provisioner'
  ) {
    throw 'Provisioner Role ownership tags drifted.'
  }

  $attached = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-attached-role-policies',
    '--profile', $Profile,
    '--role-name', 'TechlongSandboxProvisionerRole',
    '--no-paginate',
    '--output', 'json'
  )
  $attachedPolicies = @($attached.AttachedPolicies)
  if (
    $attached.IsTruncated -eq $true -or
    $attachedPolicies.Count -ne 1 -or
    [string]$attachedPolicies[0].PolicyArn -cne $provisionerBoundaryArn -or
    [string]$attachedPolicies[0].PolicyName -cne 'TechlongSandboxProvisionerBoundary'
  ) {
    throw 'Provisioner Role attached managed policies drifted.'
  }
  $inline = Invoke-AwsJson -AwsCli $AwsCli -Arguments @(
    'iam', 'list-role-policies',
    '--profile', $Profile,
    '--role-name', 'TechlongSandboxProvisionerRole',
    '--no-paginate',
    '--output', 'json'
  )
  if ($inline.IsTruncated -eq $true -or @($inline.PolicyNames).Count -ne 0) {
    throw 'Provisioner Role must retain zero inline policies.'
  }
  Write-Host "Verified exact ProvisionerBoundary policy document SHA-256: $policyHash"
}

function Assert-ProvisionerSimulationDecision {
  param(
    [string]$AwsCli,
    [string]$Action,
    [string]$Resource,
    [string[]]$ContextEntries,
    [ValidateSet('allowed', 'implicitDeny', 'explicitDeny')]
    [string]$ExpectedDecision
  )
  $arguments = @(
    'iam', 'simulate-principal-policy',
    '--profile', $Profile,
    '--policy-source-arn', $provisionerRoleArn,
    '--action-names', $Action,
    '--resource-arns', $Resource
  )
  if (@($ContextEntries).Count -gt 0) {
    $arguments += '--context-entries'
    $arguments += $ContextEntries
  }
  $arguments += @('--output', 'json')
  $response = Invoke-AwsJson -AwsCli $AwsCli -Arguments $arguments
  $evaluations = @($response.EvaluationResults)
  if (
    $response.IsTruncated -eq $true -or
    $evaluations.Count -ne 1 -or
    [string]$evaluations[0].EvalActionName -cne $Action -or
    [string]$evaluations[0].EvalResourceName -cne $Resource -or
    [string]$evaluations[0].EvalDecision -cne $ExpectedDecision -or
    (
      $ExpectedDecision -ceq 'implicitDeny' -and
      @($evaluations[0].MatchedStatements).Count -ne 0
    ) -or
    (
      $ExpectedDecision -ceq 'allowed' -and
      @($evaluations[0].MissingContextValues).Count -ne 0
    )
  ) {
    throw "Provisioner IAM simulation for $Action did not return exact decision $ExpectedDecision."
  }
}

function Assert-ExactProvisionAuthorityIamSimulation {
  param([string]$AwsCli, [bool]$GrantExpected)
  $regionContext =
    'ContextKeyName=aws:RequestedRegion,ContextKeyValues=ca-central-1,ContextKeyType=string'
  $exactKeyContext =
    "ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=$sharedCellAuthorityKey,ContextKeyType=stringList"
  $exactAttributesContext =
    'ContextKeyName=dynamodb:Attributes,ContextKeyValues=authority_key,schema_version,revision,record_json,ContextKeyType=stringList'
  $now = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $currentTimeContext =
    "ContextKeyName=aws:CurrentTime,ContextKeyValues=$now,ContextKeyType=date"
  $exactStackArn = $sharedCellRootStackArn.Replace(
    '*',
    '00000000-0000-0000-0000-000000000000'
  )

  foreach ($action in @(
    'cloudformation:DescribeStacks',
    'cloudformation:GetTemplate',
    'cloudformation:ListStackResources'
  )) {
    Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
      -Action $action -Resource $exactStackArn `
      -ContextEntries @($regionContext) -ExpectedDecision 'allowed'
  }
  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'cloudformation:DescribeStacks' `
    -Resource 'arn:aws:cloudformation:ca-central-1:402010193138:stack/not-approved/00000000-0000-0000-0000-000000000000' `
    -ContextEntries @($regionContext) -ExpectedDecision 'implicitDeny'
  foreach ($action in @(
    'cloudformation:CreateStack',
    'cloudformation:DeleteStack',
    'cloudformation:UpdateStack'
  )) {
    Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
      -Action $action -Resource $exactStackArn `
      -ContextEntries @($regionContext) -ExpectedDecision 'implicitDeny'
  }

  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'dynamodb:GetItem' -Resource $authorityTableArn `
    -ContextEntries @($regionContext, $exactKeyContext) -ExpectedDecision 'allowed'
  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'dynamodb:GetItem' -Resource $authorityTableArn `
    -ContextEntries @(
      $regionContext,
      'ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=cell:not-approved,ContextKeyType=stringList'
    ) -ExpectedDecision 'implicitDeny'
  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'dynamodb:GetItem' -Resource $authorityTableArn `
    -ContextEntries @(
      'ContextKeyName=aws:RequestedRegion,ContextKeyValues=us-east-1,ContextKeyType=string',
      $exactKeyContext
    ) -ExpectedDecision 'implicitDeny'

  $putDecision = if ($GrantExpected) { 'allowed' } else { 'implicitDeny' }
  $putContext = @(
    $regionContext,
    $exactKeyContext,
    $exactAttributesContext,
    $currentTimeContext
  )
  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'dynamodb:PutItem' -Resource $authorityTableArn `
    -ContextEntries $putContext -ExpectedDecision $putDecision
  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'dynamodb:PutItem' -Resource $authorityTableArn `
    -ContextEntries @(
      $regionContext,
      'ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=cell:not-approved,ContextKeyType=stringList',
      $exactAttributesContext,
      $currentTimeContext
    ) -ExpectedDecision 'implicitDeny'
  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'dynamodb:PutItem' `
    -Resource 'arn:aws:dynamodb:ca-central-1:402010193138:table/not-approved' `
    -ContextEntries $putContext -ExpectedDecision 'implicitDeny'
  Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
    -Action 'dynamodb:PutItem' -Resource $authorityTableArn `
    -ContextEntries @(
      $regionContext,
      $exactKeyContext,
      'ContextKeyName=dynamodb:Attributes,ContextKeyValues=authority_key,schema_version,revision,record_json,unexpected,ContextKeyType=stringList',
      $currentTimeContext
    ) -ExpectedDecision 'implicitDeny'
  foreach ($action in @(
    'dynamodb:BatchWriteItem',
    'dynamodb:DeleteItem',
    'dynamodb:TransactWriteItems',
    'dynamodb:UpdateItem'
  )) {
    Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
      -Action $action -Resource $authorityTableArn `
      -ContextEntries $putContext -ExpectedDecision 'implicitDeny'
  }
  if ($GrantExpected) {
    $expired = (ConvertFrom-CanonicalGrantExpiry -Value $GrantExpiresAt).AddMilliseconds(1).ToString(
      'yyyy-MM-ddTHH:mm:ss.fffZ'
    )
    $expiredContext = @(
      $regionContext,
      $exactKeyContext,
      $exactAttributesContext,
      "ContextKeyName=aws:CurrentTime,ContextKeyValues=$expired,ContextKeyType=date"
    )
    Assert-ProvisionerSimulationDecision -AwsCli $AwsCli `
      -Action 'dynamodb:PutItem' -Resource $authorityTableArn `
      -ContextEntries $expiredContext -ExpectedDecision 'implicitDeny'
  }
  Write-Host 'Verified exact Provisioner IAM simulation decisions.'
}

function Assert-ReviewedChangeSet {
  param(
    [object]$ChangeSet,
    [string]$ExpectedName,
    [string]$ExpectedDescription,
    [ValidateSet(
      'InitialB5Support',
      'CodeBuildImagePull',
      'LifecycleReadback',
      'LifecycleTaskRegistrationGrant',
      'LifecycleTaskRegistrationRevoke',
      'SharedCellProvisionAuthorityInstallGrant',
      'SharedCellProvisionAuthorityInstallRevoke'
    )]
    [string]$UpdateShape,
    [bool]$Rollback
  )
  $metadataFailures = [System.Collections.Generic.List[string]]::new()
  if ($ChangeSet.StackName -ne $bootstrapStackName) { $metadataFailures.Add('stack_name') }
  if ($ChangeSet.ChangeSetName -ne $ExpectedName) { $metadataFailures.Add('change_set_name') }
  if ($ChangeSet.Status -ne 'CREATE_COMPLETE') { $metadataFailures.Add('status') }
  if ($ChangeSet.ExecutionStatus -ne 'AVAILABLE') { $metadataFailures.Add('execution_status') }
  if ($ChangeSet.Description -ne $ExpectedDescription) { $metadataFailures.Add('description') }
  if (-not [string]::IsNullOrEmpty([string]$ChangeSet.RoleARN)) {
    $metadataFailures.Add('role_arn')
  }
  if (@($ChangeSet.NotificationARNs).Count -ne 0) { $metadataFailures.Add('notifications') }
  if (-not [string]::IsNullOrEmpty([string]$ChangeSet.ParentChangeSetId)) {
    $metadataFailures.Add('parent_change_set')
  }
  if (-not [string]::IsNullOrEmpty([string]$ChangeSet.RootChangeSetId)) {
    $metadataFailures.Add('root_change_set')
  }
  if ($ChangeSet.IncludeNestedStacks -ne $false) { $metadataFailures.Add('nested_stacks') }
  if ($ChangeSet.ImportExistingResources -eq $true) { $metadataFailures.Add('resource_import') }
  if (-not [string]::IsNullOrEmpty([string]$ChangeSet.OnStackFailure)) {
    $metadataFailures.Add('on_stack_failure')
  }
  if (
    $null -ne $ChangeSet.RollbackConfiguration.RollbackTriggers -and
    @($ChangeSet.RollbackConfiguration.RollbackTriggers).Count -ne 0
  ) {
    $metadataFailures.Add('rollback_triggers')
  }
  if ($ChangeSet.DeploymentConfig.Mode -ne 'STANDARD') {
    $metadataFailures.Add('deployment_mode')
  }
  if ($ChangeSet.DeploymentConfig.DisableRollback -ne $false) {
    $metadataFailures.Add('rollback_disabled')
  }
  if ($metadataFailures.Count -ne 0) {
    throw "The Change Set metadata is not the exact reviewed B5 support update: $($metadataFailures -join ', ')."
  }

  $parameters = @{}
  foreach ($parameter in @($ChangeSet.Parameters)) {
    $parameters[$parameter.ParameterKey] = $parameter.ParameterValue
  }
  $expectedParameters = @{
    ExpectedAccountId = '402010193138'
    ExpectedRegion = 'ca-central-1'
    ProvisionerPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
    ScheduleGroupName = 'techlong-sandbox'
    EcrRepositoryName = 'techlong-sandbox-speedfeast'
    CodeBuildProjectName = 'techlong-sandbox-speedfeast-image'
  }
  foreach ($key in $expectedParameters.Keys) {
    if ($parameters[$key] -ne $expectedParameters[$key]) {
      throw "Change Set parameter $key does not match the reviewed value."
    }
  }
  if ($parameters.Count -ne $expectedParameters.Count) {
    throw 'Change Set contains an unexpected parameter.'
  }

  $tags = @{}
  foreach ($tag in @($ChangeSet.Tags)) { $tags[$tag.Key] = $tag.Value }
  if (
    $tags.Count -ne 3 -or
    $tags.Environment -ne 'aws-sandbox' -or
    $tags.ManagedBy -ne 'techlong-provisioner' -or
    $tags.Component -ne 's3-bootstrap'
  ) {
    throw 'Change Set tags do not match the exact Bootstrap ownership contract.'
  }
  if (
    @($ChangeSet.Capabilities).Count -ne 1 -or
    @($ChangeSet.Capabilities)[0] -ne 'CAPABILITY_NAMED_IAM'
  ) {
    throw 'Change Set capabilities do not match the reviewed named-IAM update.'
  }

  $requiredInitialB5SupportChanges = @{
    GlobalJanitorSchedule = @{ Type = 'AWS::Scheduler::Schedule'; Action = 'Modify' }
    JanitorFunction = @{ Type = 'AWS::Lambda::Function'; Action = 'Modify' }
    SchedulerInvokeRole = @{ Type = 'AWS::IAM::Role'; Action = 'Modify' }
    ServiceRoleBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
    TaskRole = @{ Type = 'AWS::IAM::Role'; Action = 'Modify' }
    ProvisionerBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
    TenantLifecycleReceiptBucket = @{ Type = 'AWS::S3::Bucket'; Action = 'Add' }
    TenantLifecycleReceiptBucketPolicy = @{ Type = 'AWS::S3::BucketPolicy'; Action = 'Add' }
    TenantExternalEpochAuthorityTable = @{ Type = 'AWS::DynamoDB::Table'; Action = 'Add' }
    TenantLifecycleTaskRole = @{ Type = 'AWS::IAM::Role'; Action = 'Add' }
    DeploymentWorkerRole = @{ Type = 'AWS::IAM::Role'; Action = 'Add' }
  }
  $requiredLifecycleReadbackChanges = @{
    ServiceRoleBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
    ProvisionerBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
    TenantLifecycleTaskRole = @{ Type = 'AWS::IAM::Role'; Action = 'Modify' }
    DeploymentWorkerRole = @{ Type = 'AWS::IAM::Role'; Action = 'Modify' }
  }
  $requiredCodeBuildImagePullChanges = @{
    CodeBuildRole = @{ Type = 'AWS::IAM::Role'; Action = 'Modify' }
    SandboxCodeBuildProject = @{ Type = 'AWS::CodeBuild::Project'; Action = 'Modify' }
  }
  $requiredLifecycleTaskRegistrationRevokeChanges = @{
    ExecutionRoleBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
  }
  $requiredLifecycleTaskRegistrationGrantChanges = @{
    ExecutionRoleBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
  }
  $requiredSharedCellProvisionAuthorityInstallGrantChanges = @{
    ProvisionerBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
  }
  $requiredSharedCellProvisionAuthorityInstallRevokeChanges = @{
    ProvisionerBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
  }
  $requiredRollbackChanges = @{
    ServiceRoleBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
    ProvisionerBoundary = @{ Type = 'AWS::IAM::ManagedPolicy'; Action = 'Modify' }
    TenantLifecycleReceiptBucket = @{ Type = 'AWS::S3::Bucket'; Action = 'Remove' }
    TenantLifecycleReceiptBucketPolicy = @{ Type = 'AWS::S3::BucketPolicy'; Action = 'Remove' }
    TenantExternalEpochAuthorityTable = @{ Type = 'AWS::DynamoDB::Table'; Action = 'Remove' }
    TenantLifecycleTaskRole = @{ Type = 'AWS::IAM::Role'; Action = 'Remove' }
    DeploymentWorkerRole = @{ Type = 'AWS::IAM::Role'; Action = 'Remove' }
  }
  $requiredChanges = if ($Rollback) {
    if ($UpdateShape -ne 'InitialB5Support') {
      throw 'Rollback Change Sets are only reviewed against the InitialB5Support shape.'
    }
    $requiredRollbackChanges
  } elseif ($UpdateShape -eq 'LifecycleTaskRegistrationGrant') {
    $requiredLifecycleTaskRegistrationGrantChanges
  } elseif ($UpdateShape -eq 'LifecycleTaskRegistrationRevoke') {
    $requiredLifecycleTaskRegistrationRevokeChanges
  } elseif ($UpdateShape -eq 'SharedCellProvisionAuthorityInstallGrant') {
    $requiredSharedCellProvisionAuthorityInstallGrantChanges
  } elseif ($UpdateShape -eq 'SharedCellProvisionAuthorityInstallRevoke') {
    $requiredSharedCellProvisionAuthorityInstallRevokeChanges
  } elseif ($UpdateShape -eq 'CodeBuildImagePull') {
    $requiredCodeBuildImagePullChanges
  } elseif ($UpdateShape -eq 'LifecycleReadback') {
    $requiredLifecycleReadbackChanges
  } else {
    $requiredInitialB5SupportChanges
  }
  $observed = @{}
  foreach ($change in @($ChangeSet.Changes)) {
    $resource = $change.ResourceChange
    $logicalId = [string]$resource.LogicalResourceId
    $expected = $requiredChanges[$logicalId]
    if (-not $expected -or $resource.ResourceType -ne $expected.Type) {
      throw "Change Set contains an unapproved resource change: $logicalId ($($resource.ResourceType))."
    }
    if ($observed.ContainsKey($logicalId)) {
      throw "Change Set contains a duplicate resource change for $logicalId."
    }
    if ($resource.Action -ne $expected.Action) {
      throw "Change Set must $($expected.Action) the exact reviewed resource $logicalId."
    }
    if ($UpdateShape -eq 'CodeBuildImagePull') {
      Assert-ExactCodeBuildImagePullResourceChange -Resource $resource
    } elseif ($UpdateShape -in @(
      'SharedCellProvisionAuthorityInstallGrant',
      'SharedCellProvisionAuthorityInstallRevoke'
    )) {
      Assert-ExactProvisionAuthorityBoundaryResourceChange -Resource $resource
    } elseif ($resource.Replacement -in @('True', 'Conditional')) {
      throw "Change Set may not replace $logicalId."
    }
    $observed[$logicalId] = [string]$resource.Action
  }
  foreach ($logicalId in $requiredChanges.Keys) {
    if ($observed[$logicalId] -ne $requiredChanges[$logicalId].Action) {
      throw "Change Set is missing the required $($requiredChanges[$logicalId].Action) for $logicalId."
    }
  }
}

Write-Host 'Running local B5 support resource and deployment-entry validation...'
& node $validator
if ($LASTEXITCODE -ne 0) { throw 'Local B5 support validation failed.' }

if ($Mode -eq 'LocalValidate') {
  Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
  exit 0
}

if ($Profile -notmatch '^[A-Za-z0-9_-]{1,64}$') {
  throw 'AWS profile name contains unsupported characters.'
}

$writeModes = @(
  'CreateChangeSet',
  'ExecuteChangeSet',
  'CreateRollbackChangeSet',
  'ExecuteRollbackChangeSet'
)
if ($Mode -in $writeModes) {
  Assert-WriteAcknowledgements
}
if ($Mode -eq 'ExecuteChangeSet') {
  Assert-ExecuteAcknowledgements -Rollback $false
}
if ($Mode -eq 'ExecuteRollbackChangeSet') {
  Assert-ExecuteAcknowledgements -Rollback $true
}

$renderedTemplate = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-support-$([Guid]::NewGuid().ToString('N')).yaml"
)
$rollbackTemplate = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-support-rollback-$([Guid]::NewGuid().ToString('N')).yaml"
)
$changeSetTemplateResponse = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-support-change-set-template-$([Guid]::NewGuid().ToString('N')).json"
)
$policyVersionResponse = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-support-provisioner-policy-$([Guid]::NewGuid().ToString('N')).json"
)
$previousIgnoreConfiguredEndpointUrls =
  [Environment]::GetEnvironmentVariable('AWS_IGNORE_CONFIGURED_ENDPOINT_URLS')

try {
  $renderArguments = @('--output', $renderedTemplate)
  if ($reviewedUpdateShape -eq 'LifecycleTaskRegistrationGrant') {
    $renderArguments += '--lifecycle-task-registration-grant'
  } elseif ($reviewedUpdateShape -eq 'SharedCellProvisionAuthorityInstallGrant') {
    $renderArguments += @(
      '--shared-cell-provision-authority-grant-expires-at',
      $GrantExpiresAt
    )
  }
  & node $renderer @renderArguments
  if ($LASTEXITCODE -ne 0) { throw 'Unable to render the reviewed bootstrap template.' }
  & node $rollbackRenderer --output $rollbackTemplate
  if ($LASTEXITCODE -ne 0) { throw 'Unable to render the reviewed B5 support rollback template.' }

  $templateHash = (Get-FileHash -LiteralPath $renderedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
  $rollbackHash = (Get-FileHash -LiteralPath $rollbackTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
  $templateCanonicalHash = Get-CanonicalTemplateHash -TemplatePath $renderedTemplate
  $rollbackCanonicalHash = Get-CanonicalTemplateHash -TemplatePath $rollbackTemplate
  $updateShapeToken = if ($reviewedUpdateShape -eq 'CodeBuildImagePull') {
    'codebuild-image-pull'
  } elseif ($reviewedUpdateShape -eq 'LifecycleReadback') {
    'lifecycle-readback'
  } elseif ($reviewedUpdateShape -eq 'LifecycleTaskRegistrationGrant') {
    'lifecycle-task-registration-grant'
  } elseif ($reviewedUpdateShape -eq 'LifecycleTaskRegistrationRevoke') {
    'lifecycle-task-registration-revoke'
  } elseif ($reviewedUpdateShape -eq 'SharedCellProvisionAuthorityInstallGrant') {
    'shared-cell-provision-authority-install-grant'
  } elseif ($reviewedUpdateShape -eq 'SharedCellProvisionAuthorityInstallRevoke') {
    'shared-cell-provision-authority-install-revoke'
  } else {
    'initial'
  }
  $changeSetName = "techlong-s3-b5-support-$updateShapeToken-$($templateHash.Substring(0, 16))"
  $rollbackChangeSetName = "techlong-s3-b5-support-rollback-initial-$($rollbackHash.Substring(0, 16))"
  $changeSetDescription = "B5 support update; update-shape=$reviewedUpdateShape; template-sha256=$templateHash; canonical-sha256=$templateCanonicalHash"
  $rollbackDescription = "B5 support rollback; update-shape=InitialB5Support; template-sha256=$rollbackHash; canonical-sha256=$rollbackCanonicalHash; deletes receipts and authority records"

  Assert-NoAwsEndpointOverrides
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    'true',
    [EnvironmentVariableTarget]::Process
  )
  $awsCli = Resolve-AwsCli
  Assert-ExactSourceLoginSession -AwsCli $awsCli
  $identity = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
    'sts', 'get-caller-identity', '--profile', $Profile, '--output', 'json'
  )
  if ($identity.Account -ne $expectedAccountId -or $identity.Arn -ne $expectedPrincipalArn) {
    throw "Refusing AWS access: expected $expectedPrincipalArn in account $expectedAccountId."
  }
  Assert-ExactMfaDevice -AwsCli $awsCli
  $configuredRegion = (& $awsCli configure get region --profile $Profile).Trim()
  if ($LASTEXITCODE -ne 0 -or $configuredRegion -ne $expectedRegion) {
    throw "Refusing AWS access: profile region must be $expectedRegion."
  }

  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--template-body', "file://$renderedTemplate"
  )
  if ($Mode -eq 'OnlineValidate') {
    Write-Host 'Online template validation complete. No Stack or resource was changed.'
    exit 0
  }

  $stackResponse = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
    'cloudformation', 'describe-stacks',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName,
    '--output', 'json'
  )
  $stack = @($stackResponse.Stacks)[0]
  Assert-ExactBootstrapStack -Stack $stack

  $parameters = @(
    'ParameterKey=ExpectedAccountId,ParameterValue=402010193138',
    'ParameterKey=ExpectedRegion,ParameterValue=ca-central-1',
    'ParameterKey=ProvisionerPrincipalArn,ParameterValue=arn:aws:iam::402010193138:user/techlong-sandbox-dev',
    'ParameterKey=ScheduleGroupName,ParameterValue=techlong-sandbox',
    'ParameterKey=EcrRepositoryName,ParameterValue=techlong-sandbox-speedfeast',
    'ParameterKey=CodeBuildProjectName,ParameterValue=techlong-sandbox-speedfeast-image'
  )

  if ($Mode -eq 'CreateChangeSet' -or $Mode -eq 'CreateRollbackChangeSet') {
    $isRollback = $Mode -eq 'CreateRollbackChangeSet'
    $selectedTemplate = if ($isRollback) { $rollbackTemplate } else { $renderedTemplate }
    $selectedName = if ($isRollback) { $rollbackChangeSetName } else { $changeSetName }
    $selectedDescription = if ($isRollback) { $rollbackDescription } else { $changeSetDescription }
    $selectedHash = if ($isRollback) { $rollbackHash } else { $templateHash }
    $selectedCanonicalHash = if ($isRollback) { $rollbackCanonicalHash } else { $templateCanonicalHash }
    $createArguments = @(
      'cloudformation', 'create-change-set',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $bootstrapStackName,
      '--change-set-name', $selectedName,
      '--change-set-type', 'UPDATE',
      '--description', $selectedDescription,
      '--template-body', "file://$selectedTemplate",
      '--capabilities', 'CAPABILITY_NAMED_IAM',
      '--parameters'
    ) + $parameters + @(
      '--tags',
      'Key=Environment,Value=aws-sandbox',
      'Key=ManagedBy,Value=techlong-provisioner',
      'Key=Component,Value=s3-bootstrap',
      '--client-token', "b5-support-$selectedName"
    )
    Invoke-AwsChecked -AwsCli $awsCli -Arguments $createArguments
    Write-Host "Change Set $selectedName was created but NOT executed."
    Write-Host "Local rendered template SHA-256: $selectedHash"
    Write-Host "Local canonical template SHA-256: $selectedCanonicalHash"
    Write-Host 'Run the matching Inspect mode, review every change, then use the matching Execute mode in a separate command.'
    exit 0
  }

  $isRollback = $Mode -in @('InspectRollbackChangeSet', 'ExecuteRollbackChangeSet')
  $selectedName = if ($isRollback) { $rollbackChangeSetName } else { $changeSetName }
  $selectedDescription = if ($isRollback) { $rollbackDescription } else { $changeSetDescription }
  $selectedTemplate = if ($isRollback) { $rollbackTemplate } else { $renderedTemplate }
  $selectedHash = if ($isRollback) { $rollbackHash } else { $templateHash }
  $selectedCanonicalHash = if ($isRollback) { $rollbackCanonicalHash } else { $templateCanonicalHash }
  $changeSet = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
    'cloudformation', 'describe-change-set',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName,
    '--change-set-name', $selectedName,
    '--output', 'json'
  )

  $changeSetId = [string]$changeSet.ChangeSetId
  $changeSetIdPattern =
    '\Aarn:aws:cloudformation:ca-central-1:402010193138:changeSet/' +
    [regex]::Escape($selectedName) +
    '/(?<Uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\z'
  $changeSetIdMatch = [regex]::Match($changeSetId, $changeSetIdPattern)
  if (-not $changeSetIdMatch.Success) {
    throw 'Change Set ARN is not the exact reviewed account, region, name, and UUID.'
  }
  $changeSetUuid = $changeSetIdMatch.Groups['Uuid'].Value
  $executeClientRequestToken = "b5-support-execute-$changeSetUuid"

  Assert-ExactChangeSetTemplate `
    -AwsCli $awsCli `
    -ChangeSetName $changeSetId `
    -ExpectedTemplatePath $selectedTemplate `
    -ExpectedCanonicalHash $selectedCanonicalHash `
    -ResponsePath $changeSetTemplateResponse
  Assert-ReviewedChangeSet `
    -ChangeSet $changeSet `
    -ExpectedName $selectedName `
    -ExpectedDescription $selectedDescription `
    -UpdateShape $reviewedUpdateShape `
    -Rollback $isRollback

  if ($Mode -eq 'InspectChangeSet' -or $Mode -eq 'InspectRollbackChangeSet') {
    Write-Host "Change Set: $selectedName"
    Write-Host "Status: $($changeSet.Status) / $($changeSet.ExecutionStatus)"
    Write-Host "Description: $($changeSet.Description)"
    Write-Host "Local rendered template SHA-256: $selectedHash"
    Write-Host "Verified canonical template SHA-256: $selectedCanonicalHash"
    @($changeSet.Changes) | ForEach-Object {
      [PSCustomObject]@{
        Action = $_.ResourceChange.Action
        LogicalId = $_.ResourceChange.LogicalResourceId
        ResourceType = $_.ResourceChange.ResourceType
        Replacement = $_.ResourceChange.Replacement
      }
    } | Format-Table -AutoSize
    Write-Host 'Inspection is read-only. No Change Set was executed.'
    exit 0
  }

  if ($isRollback) {
    $inventory = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
      's3api', 'list-objects-v2',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--bucket', $receiptBucketName,
      '--expected-bucket-owner', $expectedAccountId,
      '--max-items', '1',
      '--output', 'json'
    )
    if ([int]$inventory.KeyCount -gt 0) {
      Write-Warning "Deleting every receipt under s3://$receiptBucketName/tenant-lifecycle/v1/ before the reviewed rollback."
      for ($batch = 0; $batch -lt 100; $batch += 1) {
        $receiptPage = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
          's3api', 'list-objects-v2',
          '--profile', $Profile,
          '--region', $expectedRegion,
          '--bucket', $receiptBucketName,
          '--prefix', 'tenant-lifecycle/v1/',
          '--expected-bucket-owner', $expectedAccountId,
          '--max-keys', '1000',
          '--output', 'json'
        )
        $receiptObjects = @($receiptPage.Contents)
        if ($receiptObjects.Count -eq 0) { break }
        $deleteRequest = @{
          Objects = @($receiptObjects | ForEach-Object { @{ Key = [string]$_.Key } })
          Quiet = $true
        } | ConvertTo-Json -Compress -Depth 5
        $deleteResponse = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
          's3api', 'delete-objects',
          '--profile', $Profile,
          '--region', $expectedRegion,
          '--bucket', $receiptBucketName,
          '--expected-bucket-owner', $expectedAccountId,
          '--delete', $deleteRequest,
          '--output', 'json'
        )
        if (@($deleteResponse.Errors).Count -ne 0) {
          throw 'Rollback stopped because S3 reported one or more receipt deletion errors.'
        }
      }
      $remaining = Invoke-AwsJson -AwsCli $awsCli -Arguments @(
        's3api', 'list-objects-v2',
        '--profile', $Profile,
        '--region', $expectedRegion,
        '--bucket', $receiptBucketName,
        '--expected-bucket-owner', $expectedAccountId,
        '--max-items', '1',
        '--output', 'json'
      )
      if ([int]$remaining.KeyCount -ne 0) {
        throw 'Rollback stopped because the exact receipt Bucket is not empty.'
      }
    }
    Write-Warning "Executing rollback will delete DynamoDB table $authorityTableName and every authority record in it."
  }

  if ($reviewedUpdateShape -eq 'SharedCellProvisionAuthorityInstallGrant') {
    $remainingAtExecute =
      (ConvertFrom-CanonicalGrantExpiry -Value $GrantExpiresAt) - [DateTime]::UtcNow
    if ($remainingAtExecute.TotalMinutes -le 10) {
      throw 'The temporary install grant has 10 minutes or less remaining immediately before execution; create a fresh Change Set instead.'
    }
  }

  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'execute-change-set',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName,
    '--change-set-name', $changeSetId,
    '--client-request-token', $executeClientRequestToken
  )
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'wait', 'stack-update-complete',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName
  )
  if ($reviewedUpdateShape -in @(
    'SharedCellProvisionAuthorityInstallGrant',
    'SharedCellProvisionAuthorityInstallRevoke'
  )) {
    $iamVerificationComplete = $false
    for ($iamAttempt = 1; $iamAttempt -le 3; $iamAttempt += 1) {
      try {
        Assert-ExactProvisionerBoundaryReadback `
          -AwsCli $awsCli `
          -ExpectedTemplatePath $renderedTemplate `
          -PolicyVersionResponsePath $policyVersionResponse
        Assert-ExactProvisionAuthorityIamSimulation `
          -AwsCli $awsCli `
          -GrantExpected ($reviewedUpdateShape -eq 'SharedCellProvisionAuthorityInstallGrant')
        Assert-ExactProvisionerBoundaryReadback `
          -AwsCli $awsCli `
          -ExpectedTemplatePath $renderedTemplate `
          -PolicyVersionResponsePath $policyVersionResponse
        $iamVerificationComplete = $true
        break
      } catch {
        if ($iamAttempt -eq 3) { throw }
        Write-Warning "IAM readback/simulation has not converged (attempt $iamAttempt of 3); retrying after 2 seconds."
        Start-Sleep -Seconds 2
      }
    }
    if (-not $iamVerificationComplete) {
      throw 'Exact Provisioner IAM verification did not complete.'
    }
  }
  if ($isRollback) {
    Write-Host 'Reviewed B5 support rollback completed. Existing Sandbox bootstrap resources were retained.'
  } else {
    Write-Host 'Reviewed B5 support bootstrap update completed.'
    Write-Host 'applyRuntimeReady=false and cleanupRuntimeReady=false remain unchanged; no Cell was created.'
  }
} finally {
  [Environment]::SetEnvironmentVariable(
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
    $previousIgnoreConfiguredEndpointUrls,
    [EnvironmentVariableTarget]::Process
  )
  foreach ($temporaryPath in @(
    $renderedTemplate,
    $rollbackTemplate,
    $changeSetTemplateResponse,
    $policyVersionResponse
  )) {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}
