[CmdletBinding()]
param(
  [ValidateSet('Plan', 'Inspect', 'Apply')]
  [string]$Mode = 'Plan',
  [string]$Profile = 'techlong-sandbox-user',
  [string]$ConfirmAccountId = '',
  [string]$ConfirmBootstrapStackName = '',
  [switch]$DeleteBudgetGuardrail,
  [string]$ConfirmBudgetStackName = '',
  [switch]$AcknowledgeEcrImagesWillBeDeleted
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedPrincipalArn = 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'
$bootstrapStackName = 'techlong-s3-bootstrap'
$budgetStackName = 'techlong-cost-guardrails'
$sourceBucket = 'techlong-sandbox-build-source-402010193138-ca-central-1'

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $knownPath = 'D:\Amazon\AWSCLIV2\aws.exe'
  if (Test-Path -LiteralPath $knownPath) { return $knownPath }
  throw 'AWS CLI v2 was not found.'
}

Write-Host 'Rollback order: remove all tenant techlong-sandbox-* stacks first, then bootstrap, then optionally the tagged Budget.'
Write-Warning 'Deleting the bootstrap empties and deletes techlong-sandbox-speedfeast ECR, including all Sandbox images.'
if ($Mode -eq 'Plan') {
  Write-Host 'Plan only. No AWS API was called and no resource was changed.'
  exit 0
}

$awsCli = Resolve-AwsCli
$identityJson = & $awsCli sts get-caller-identity --profile $Profile --output json
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the AWS caller identity.' }
$identity = $identityJson | ConvertFrom-Json
if ($identity.Account -ne $expectedAccountId -or $identity.Arn -ne $expectedPrincipalArn) {
  throw 'Refusing rollback from an unexpected AWS account or principal.'
}
$configuredRegion = (& $awsCli configure get region --profile $Profile).Trim()
if ($configuredRegion -ne $expectedRegion) {
  throw "Refusing rollback outside $expectedRegion."
}

$stackListJson = & $awsCli cloudformation list-stacks `
  --profile $Profile `
  --region $expectedRegion `
  --output json
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect tenant stacks.' }
$stackList = $stackListJson | ConvertFrom-Json
$tenantStacks = @(
  $stackList.StackSummaries |
    Where-Object {
      $_.StackName.StartsWith('techlong-sandbox-', [StringComparison]::Ordinal) -and
      $_.StackStatus -ne 'DELETE_COMPLETE'
    } |
    ForEach-Object { "$($_.StackName) [$($_.StackStatus)]" }
)

if ($tenantStacks.Count -gt 0) {
  throw "Rollback blocked: tenant stacks are not DELETE_COMPLETE: $($tenantStacks -join ', ')"
}

if ($Mode -eq 'Inspect') {
  Write-Host 'No active tenant stack was found. Inspect mode made no changes.'
  exit 0
}

if ($ConfirmAccountId -ne $expectedAccountId) {
  throw "Apply requires -ConfirmAccountId $expectedAccountId."
}
if ($ConfirmBootstrapStackName -ne $bootstrapStackName) {
  throw "Apply requires -ConfirmBootstrapStackName $bootstrapStackName."
}
if (-not $AcknowledgeEcrImagesWillBeDeleted) {
  throw 'Apply requires -AcknowledgeEcrImagesWillBeDeleted.'
}
if ($DeleteBudgetGuardrail -and $ConfirmBudgetStackName -ne $budgetStackName) {
  throw "Deleting the Budget requires -ConfirmBudgetStackName $budgetStackName."
}

$stackBucket = (& $awsCli cloudformation describe-stack-resource `
  --profile $Profile `
  --region $expectedRegion `
  --stack-name $bootstrapStackName `
  --logical-resource-id CodeBuildSourceBucket `
  --query StackResourceDetail.PhysicalResourceId `
  --output text).Trim()
if ($LASTEXITCODE -ne 0 -or $stackBucket -ne $sourceBucket) {
  throw 'Refusing rollback: the bootstrap Stack did not resolve to the one fixed build source bucket.'
}
$taggingJson = & $awsCli s3api get-bucket-tagging --profile $Profile --region $expectedRegion --bucket $sourceBucket --output json
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the build source bucket tags.' }
$tagging = $taggingJson | ConvertFrom-Json
$tagMap = @{}
foreach ($tag in $tagging.TagSet) { $tagMap[$tag.Key] = $tag.Value }
if (
  $tagMap.Environment -ne 'aws-sandbox' -or
  $tagMap.ManagedBy -ne 'techlong-provisioner' -or
  $tagMap.Component -ne 'build-source'
) {
  throw 'Refusing to empty a build source bucket without all expected safety tags.'
}
& $awsCli s3 rm "s3://$sourceBucket/source/" --recursive --profile $Profile --region $expectedRegion
if ($LASTEXITCODE -ne 0) { throw 'Unable to empty the tagged build source prefix.' }

& $awsCli cloudformation delete-stack --profile $Profile --region $expectedRegion --stack-name $bootstrapStackName
if ($LASTEXITCODE -ne 0) { throw 'Unable to request bootstrap deletion.' }
& $awsCli cloudformation wait stack-delete-complete --profile $Profile --region $expectedRegion --stack-name $bootstrapStackName
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap deletion did not complete successfully.' }

if ($DeleteBudgetGuardrail) {
  & $awsCli cloudformation delete-stack --profile $Profile --region $expectedRegion --stack-name $budgetStackName
  if ($LASTEXITCODE -ne 0) { throw 'Unable to request Budget guardrail deletion.' }
  & $awsCli cloudformation wait stack-delete-complete --profile $Profile --region $expectedRegion --stack-name $budgetStackName
  if ($LASTEXITCODE -ne 0) { throw 'Budget guardrail deletion did not complete successfully.' }
}

Write-Host 'Rollback completed for the explicitly confirmed stacks.'
