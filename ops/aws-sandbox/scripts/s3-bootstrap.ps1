[CmdletBinding()]
param(
  [ValidateSet('LocalValidate', 'OnlineValidate', 'CreateChangeSet', 'Apply')]
  [string]$Mode = 'LocalValidate',
  [string]$Profile = 'techlong-sandbox-user',
  [string]$BudgetAlertEmail = '',
  [string]$ConfirmAccountId = '',
  [switch]$AcknowledgeMfaPrerequisite
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$budgetStackName = 'techlong-cost-guardrails'
$bootstrapStackName = 'techlong-s3-bootstrap'
$root = Split-Path -Parent $PSScriptRoot
$guardrailsTemplate = Join-Path $root 'cloudformation\guardrails.template.json'
$bootstrapTemplate = Join-Path $root 'cloudformation\s3-bootstrap.template.json'
$renderer = Join-Path $root 'scripts\render-bootstrap.mjs'

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

Write-Host 'Running local S3-A static and Janitor contract validation...'
& node (Join-Path $root 'scripts\validate.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local S3-A validation failed.' }

if ($Mode -eq 'LocalValidate') {
  Write-Host 'Local validation complete. No AWS API was called and no resource was changed.'
  exit 0
}

if ($Profile -notmatch '^[A-Za-z0-9_-]{1,64}$') {
  throw 'AWS profile name contains unsupported characters.'
}

$awsCli = Resolve-AwsCli
$identityJson = & $awsCli sts get-caller-identity --profile $Profile --output json
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the AWS caller identity.' }
$identity = $identityJson | ConvertFrom-Json
if ($identity.Account -ne $expectedAccountId) {
  throw "Refusing AWS access: expected account $expectedAccountId."
}
if ($identity.Arn -ne $expectedPrincipalArn) {
  throw "Refusing AWS access: expected IAM principal $expectedPrincipalArn."
}
$configuredRegion = (& $awsCli configure get region --profile $Profile).Trim()
if ($configuredRegion -ne $expectedRegion) {
  throw "Refusing AWS access: profile region must be $expectedRegion."
}

$renderedTemplate = [System.IO.Path]::Combine(
  [System.IO.Path]::GetTempPath(),
  "techlong-s3-bootstrap-$([Guid]::NewGuid().ToString('N')).json"
)
try {
  & node $renderer --output $renderedTemplate
  if ($LASTEXITCODE -ne 0) { throw 'Unable to render the Janitor Lambda source.' }

  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--template-body', "file://$guardrailsTemplate"
  )
  Invoke-AwsChecked -AwsCli $awsCli -Arguments @(
    'cloudformation', 'validate-template',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--template-body', "file://$renderedTemplate"
  )

  if ($Mode -eq 'OnlineValidate') {
    Write-Host 'Online CloudFormation validation complete. No stack or resource was changed.'
    exit 0
  }

  if ($ConfirmAccountId -ne $expectedAccountId) {
    throw "CreateChangeSet/Apply requires -ConfirmAccountId $expectedAccountId."
  }
  if ($BudgetAlertEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
    throw 'A valid -BudgetAlertEmail is required; no email is hard-coded.'
  }
  if (-not $AcknowledgeMfaPrerequisite) {
    throw 'Use -AcknowledgeMfaPrerequisite after understanding that the new Provisioner role cannot be assumed until MFA is enabled for the IAM user.'
  }

  $noExecute = @()
  if ($Mode -eq 'CreateChangeSet') { $noExecute = @('--no-execute-changeset') }

  Write-Warning 'The existing IAM user/group is not modified. Its current Administrator access remains a break-glass risk.'
  Write-Warning 'The dedicated Provisioner role requires MFA and will be unusable until MFA is enabled for the IAM user.'

  $budgetArgs = @(
    'cloudformation', 'deploy',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $budgetStackName,
    '--template-file', $guardrailsTemplate,
    '--parameter-overrides', "BudgetAlertEmail=$BudgetAlertEmail",
    '--tags', 'Environment=aws-sandbox', 'ManagedBy=techlong-provisioner', 'Component=cost-guardrail',
    '--no-fail-on-empty-changeset'
  ) + $noExecute
  Invoke-AwsChecked -AwsCli $awsCli -Arguments $budgetArgs

  $bootstrapArgs = @(
    'cloudformation', 'deploy',
    '--profile', $Profile,
    '--region', $expectedRegion,
    '--stack-name', $bootstrapStackName,
    '--template-file', $renderedTemplate,
    '--capabilities', 'CAPABILITY_NAMED_IAM',
    '--tags', 'Environment=aws-sandbox', 'ManagedBy=techlong-provisioner', 'Component=s3-bootstrap',
    '--no-fail-on-empty-changeset'
  ) + $noExecute
  Invoke-AwsChecked -AwsCli $awsCli -Arguments $bootstrapArgs

  if ($Mode -eq 'CreateChangeSet') {
    Write-Host 'CloudFormation change sets were created but not executed.'
  } else {
    Write-Host 'S3-A bootstrap applied. No Cell, VPC, ALB, ECS service, RDS cluster, Route 53 zone, or tenant stack was created.'
  }
} finally {
  if (Test-Path -LiteralPath $renderedTemplate) {
    Remove-Item -LiteralPath $renderedTemplate -Force
  }
}
