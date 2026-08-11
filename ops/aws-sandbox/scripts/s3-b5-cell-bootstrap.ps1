[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'ExecuteChangeSet')]
  [string]$Mode = 'LocalValidate',
  [string]$Profile = 'techlong-sandbox-user',
  [string]$ChangeSetName = '',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmRegion = '',
  [string]$ConfirmBootstrapStackName = '',
  [string]$ConfirmExecutionPhrase = '',
  [switch]$AcknowledgeAwsWrite,
  [switch]$AcknowledgeCreatesIamAndSchedulerResources,
  [switch]$AcknowledgeAdministratorBreakGlassRisk,
  [switch]$AcknowledgeChangeSetReviewed
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$bootstrapStackName = 'techlong-s3-b5-cell-bootstrap'
$approvedCellStackName = 'techlong-sandbox-cell-sandbox-1'
$executionPhrase = 'I_ACKNOWLEDGE_B5_CELL_BOOTSTRAP_AWS_CHANGES'
$cloudWriteReady = $false
$changeSetNamePattern = '^techlong-s3-b5-cell-bootstrap-[a-z0-9](?:[a-z0-9-]{6,38}[a-z0-9])$'
$root = Split-Path -Parent $PSScriptRoot
$renderer = Join-Path $root 'scripts\render-b5-cell-bootstrap.mjs'
$validator = Join-Path $root 'scripts\validate-b5-cell-bootstrap.mjs'

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

function Assert-WriteAcknowledgements {
  if ($ConfirmAccountId -ne $expectedAccountId) {
    throw "AWS write requires -ConfirmAccountId $expectedAccountId."
  }
  if ($ConfirmRegion -ne $expectedRegion) {
    throw "AWS write requires -ConfirmRegion $expectedRegion."
  }
  if ($ConfirmBootstrapStackName -ne $bootstrapStackName) {
    throw "AWS write requires -ConfirmBootstrapStackName $bootstrapStackName."
  }
  if (-not $AcknowledgeAwsWrite) {
    throw 'AWS write requires -AcknowledgeAwsWrite.'
  }
  if (-not $AcknowledgeCreatesIamAndSchedulerResources) {
    throw 'AWS write requires -AcknowledgeCreatesIamAndSchedulerResources.'
  }
  if (-not $AcknowledgeAdministratorBreakGlassRisk) {
    throw 'AWS write requires -AcknowledgeAdministratorBreakGlassRisk.'
  }
  if ($ChangeSetName -notmatch $changeSetNamePattern) {
    throw '-ChangeSetName must use the reviewed techlong-s3-b5-cell-bootstrap- prefix.'
  }
}

Write-Host 'Running local B5 Cell Bootstrap static validation...'
& node $validator
if ($LASTEXITCODE -ne 0) { throw 'Local B5 Cell Bootstrap validation failed.' }

if ($Mode -eq 'LocalValidate') {
  Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
  exit 0
}

if ($Mode -eq 'CreateChangeSet' -or $Mode -eq 'ExecuteChangeSet') {
  if (-not $cloudWriteReady) {
    throw 'B5 Cell Bootstrap cloud writes are hard-disabled before any AWS API call. IAM scope, MFA execution identity, template digest binding, and external cleanup must be approved first.'
  }
  Assert-WriteAcknowledgements
}
if ($Mode -eq 'ExecuteChangeSet') {
  if (-not $AcknowledgeChangeSetReviewed) {
    throw 'ExecuteChangeSet requires -AcknowledgeChangeSetReviewed after reviewing every resource change.'
  }
  if ($ConfirmExecutionPhrase -ne $executionPhrase) {
    throw "ExecuteChangeSet requires -ConfirmExecutionPhrase $executionPhrase."
  }
}

if ($Profile -notmatch '^[A-Za-z0-9_-]{1,64}$') {
  throw 'AWS profile name contains unsupported characters.'
}

$renderedTemplate = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-b5-cell-bootstrap-$([Guid]::NewGuid().ToString('N')).json"
)

try {
  & node $renderer --output $renderedTemplate
  if ($LASTEXITCODE -ne 0) { throw 'Unable to render the B5 Cell Bootstrap.' }

  $awsCli = Resolve-AwsCli
  $identityJson = & $awsCli sts get-caller-identity --profile $Profile --output json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the AWS caller identity.' }
  $identity = $identityJson | ConvertFrom-Json
  if ($identity.Account -ne $expectedAccountId -or $identity.Arn -ne $expectedPrincipalArn) {
    throw "Refusing AWS access: expected $expectedPrincipalArn in account $expectedAccountId."
  }
  $configuredRegion = (& $awsCli configure get region --profile $Profile).Trim()
  if ($configuredRegion -ne $expectedRegion) {
    throw "Refusing AWS access: profile region must be $expectedRegion."
  }

  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--template-body', "file://$renderedTemplate"
  )

  if ($Mode -eq 'OnlineValidate') {
    Write-Host 'Online template validation complete. No stack or resource was changed.'
    exit 0
  }

  Write-Warning 'This bootstrap changes IAM, Lambda, Logs and EventBridge Scheduler resources.'
  Write-Warning 'The existing IAM user Administrator access remains a break-glass bypass until separately removed.'
  Write-Warning "This bootstrap only prepares $approvedCellStackName; it does not create the Shared Cell or enable the SaaS Worker Apply gate."

  if ($Mode -eq 'CreateChangeSet') {
    $stackExists = $true
    $describeOutput = & $awsCli cloudformation describe-stacks `
      --profile $Profile `
      --region $expectedRegion `
      --stack-name $bootstrapStackName `
      --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
      $describeError = $describeOutput | Out-String
      if ($describeError -notmatch 'ValidationError' -or $describeError -notmatch 'does not exist') {
        throw 'Unable to determine whether the exact B5 Cell Bootstrap Stack exists.'
      }
      $stackExists = $false
    }
    $changeSetType = if ($stackExists) { 'UPDATE' } else { 'CREATE' }

    Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
      'cloudformation', 'create-change-set',
      '--profile', $Profile,
      '--region', $expectedRegion,
      '--stack-name', $bootstrapStackName,
      '--change-set-name', $ChangeSetName,
      '--change-set-type', $changeSetType,
      '--description', 'B5 Cell Bootstrap only; review every IAM and Scheduler change before separate execution.',
      '--template-body', "file://$renderedTemplate",
      '--capabilities', 'CAPABILITY_NAMED_IAM',
      '--parameters',
      "ParameterKey=ExpectedAccountId,ParameterValue=$expectedAccountId",
      "ParameterKey=ExpectedRegion,ParameterValue=$expectedRegion",
      "ParameterKey=CellOperatorPrincipalArn,ParameterValue=$expectedPrincipalArn",
      '--tags',
      'Key=Environment,Value=aws-sandbox',
      'Key=ManagedBy,Value=techlong-cell-bootstrap',
      'Key=Component,Value=b5-cell-bootstrap'
    )
    Write-Host "Change Set $ChangeSetName was created but NOT executed."
    Write-Host 'Wait for CREATE_COMPLETE, inspect every change, then use ExecuteChangeSet with the separate review acknowledgement and exact execution phrase.'
    exit 0
  }

  $changeSetJson = & $awsCli cloudformation describe-change-set `
    --profile $Profile `
    --region $expectedRegion `
    --stack-name $bootstrapStackName `
    --change-set-name $ChangeSetName `
    --output json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to describe the reviewed Change Set.' }
  $changeSet = $changeSetJson | ConvertFrom-Json
  if (
    $changeSet.StackName -ne $bootstrapStackName -or
    $changeSet.ChangeSetName -ne $ChangeSetName -or
    $changeSet.Status -ne 'CREATE_COMPLETE' -or
    $changeSet.ExecutionStatus -ne 'AVAILABLE'
  ) {
    throw 'The Change Set is not the exact reviewed, available B5 Cell Bootstrap Change Set.'
  }
  $allowedResourceTypes = @(
    'AWS::IAM::ManagedPolicy',
    'AWS::IAM::Role',
    'AWS::Lambda::Function',
    'AWS::Logs::LogGroup',
    'AWS::Scheduler::Schedule',
    'AWS::Scheduler::ScheduleGroup'
  )
  $observedResourceTypes = @(
    $changeSet.Changes |
      ForEach-Object { $_.ResourceChange.ResourceType } |
      Where-Object { $_ } |
      Sort-Object -Unique
  )
  $unexpectedResourceTypes = @(
    $observedResourceTypes | Where-Object { $_ -notin $allowedResourceTypes }
  )
  if ($unexpectedResourceTypes.Count -gt 0) {
    throw "Change Set contains unapproved resource types: $($unexpectedResourceTypes -join ', ')."
  }

  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'execute-change-set',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName,
    '--change-set-name', $ChangeSetName,
    '--client-request-token', "b5-cell-bootstrap-$ChangeSetName"
  )
  Write-Host 'The reviewed B5 Cell Bootstrap Change Set was submitted for execution.'
  Write-Host 'No Shared Cell was created and no SaaS Worker Apply gate was enabled by this script.'
} finally {
  if (Test-Path -LiteralPath $renderedTemplate) {
    Remove-Item -LiteralPath $renderedTemplate -Force
  }
}
