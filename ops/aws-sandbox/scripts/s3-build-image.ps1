[CmdletBinding()]
param(
  [ValidateSet('Plan', 'Package', 'Upload', 'StartBuild')]
  [string]$Mode = 'Plan',
  [string]$SourceRoot = 'E:\NodejsProject\SpeedFeast_Backend_main',
  [string]$OutputPath = '',
  [string]$Profile = 'techlong-sandbox-provisioner',
  [string]$ConfirmAccountId = '',
  [switch]$AcknowledgeBuildMayIncurCost
)

$ErrorActionPreference = 'Stop'
$expectedAccountId = '402010193138'
$expectedRegion = 'ca-central-1'
$expectedPrincipalArn = 'arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner'
$sourceBucket = 'techlong-sandbox-build-source-402010193138-ca-central-1'
$buildProject = 'techlong-sandbox-speedfeast-image'
$root = Split-Path -Parent $PSScriptRoot
$buildspecPath = Join-Path $root 'codebuild\buildspec.aws-sandbox.yml'
$allowedFiles = @(
  '.dockerignore',
  'Dockerfile',
  'app.js',
  'package-lock.json',
  'package.json',
  'tsconfig.json'
)
$allowedPrefixes = @('bin/', 'db/', 'public/', 'routes/', 'secutiry/', 'services/', 'views/')
$blockedNamePattern = '(?i)(^|/)(\.env(?:\.|$)|[^/]*firebase[^/]*\.json$|[^/]*(?:service[-_]?account|credential|secret)[^/]*\.json$|migration-artifacts(?:/|$))'
$blockedExtensionPattern = '(?i)\.(?:backup|dump|key|p12|pem|pfx|tar|tgz|zip)$'
$secretPatterns = @(
  '(?i)-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----',
  '\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
  '\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b',
  '\bwhsec_[A-Za-z0-9]{16,}\b',
  '(?i)postgres(?:ql)?://[^:\s/]+:[^@\s/]+@',
  '"private_key"\s*:'
)

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $knownPath = 'D:\Amazon\AWSCLIV2\aws.exe'
  if (Test-Path -LiteralPath $knownPath) { return $knownPath }
  throw 'AWS CLI v2 was not found.'
}

function Test-IsAllowedPath {
  param([string]$RelativePath)
  if ($allowedFiles -contains $RelativePath) { return $true }
  foreach ($prefix in $allowedPrefixes) {
    if ($RelativePath.StartsWith($prefix, [StringComparison]::Ordinal)) { return $true }
  }
  return $false
}

$resolvedSourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedSourceRoot '.git'))) {
  throw 'SourceRoot must be the SpeedFeast Git worktree.'
}
$gitSafeDirectory = $resolvedSourceRoot.Replace('\', '/')
$commit = (& git -c "safe.directory=$gitSafeDirectory" -C $resolvedSourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') {
  throw 'Unable to resolve the source Git commit.'
}
$trackedChanges = & git -c "safe.directory=$gitSafeDirectory" -C $resolvedSourceRoot status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect tracked source changes.' }
if (-not [string]::IsNullOrWhiteSpace(($trackedChanges -join ''))) {
  throw 'Refusing a non-reproducible build: commit or revert tracked backend changes first.'
}
$trackedFiles = & git -c "safe.directory=$gitSafeDirectory" -C $resolvedSourceRoot ls-files
if ($LASTEXITCODE -ne 0) { throw 'Unable to enumerate tracked source files.' }
$packageFiles = @(
  $trackedFiles |
    ForEach-Object { $_.Replace('\', '/') } |
    Where-Object { Test-IsAllowedPath $_ } |
    Sort-Object -Unique
)
if ($packageFiles.Count -lt 10) { throw 'The explicit source allowlist produced too few files.' }
foreach ($relativePath in $packageFiles) {
  if ($relativePath -match $blockedNamePattern -or $relativePath -match $blockedExtensionPattern) {
    throw "Blocked source file matched the package allowlist: $relativePath"
  }
  $absolutePath = Join-Path $resolvedSourceRoot $relativePath
  $item = Get-Item -LiteralPath $absolutePath
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Symbolic links/reparse points are not allowed: $relativePath"
  }
  if ($relativePath -match '(?i)\.(?:cjs|js|json|md|mjs|pug|sql|ts|txt|ya?ml)$') {
    $content = Get-Content -Raw -LiteralPath $absolutePath
    foreach ($pattern in $secretPatterns) {
      if ($content -match $pattern) {
        throw "Potential secret detected; package was not created: $relativePath"
      }
    }
  }
}

Write-Host "Allowlist validated $($packageFiles.Count) tracked files at commit $commit."
if ($Mode -eq 'Plan') {
  Write-Host 'Plan only. No archive was created, no AWS API was called, and no build was started.'
  exit 0
}

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$staging = [System.IO.Path]::Combine($tempRoot, "techlong-build-$([Guid]::NewGuid().ToString('N'))")
$archive = "$staging.zip"
if (-not $staging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe temporary staging path.'
}

try {
  New-Item -ItemType Directory -Path $staging | Out-Null
  foreach ($relativePath in $packageFiles) {
    $destination = Join-Path $staging $relativePath
    $destinationDirectory = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
      New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $resolvedSourceRoot $relativePath) -Destination $destination
  }
  Copy-Item -LiteralPath $buildspecPath -Destination (Join-Path $staging 'buildspec.aws-sandbox.yml')
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $staging,
    $archive,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
  $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  Write-Host "Created allowlisted archive SHA256=$archiveHash."

  if ($Mode -eq 'Package') {
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
      throw 'Package mode requires -OutputPath.'
    }
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
    $outputDirectory = Split-Path -Parent $resolvedOutput
    if (-not (Test-Path -LiteralPath $outputDirectory)) {
      New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    }
    Copy-Item -LiteralPath $archive -Destination $resolvedOutput -Force
    Write-Host "Package copied to $resolvedOutput. No AWS API was called."
    exit 0
  }

  if ($ConfirmAccountId -ne $expectedAccountId) {
    throw "Upload/StartBuild requires -ConfirmAccountId $expectedAccountId."
  }
  if ($Mode -eq 'StartBuild' -and -not $AcknowledgeBuildMayIncurCost) {
    throw 'StartBuild requires -AcknowledgeBuildMayIncurCost.'
  }
  $awsCli = Resolve-AwsCli
  $identityJson = & $awsCli sts get-caller-identity --profile $Profile --output json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the AWS caller identity.' }
  $identity = $identityJson | ConvertFrom-Json
  if ($identity.Account -ne $expectedAccountId -or $identity.Arn -ne $expectedPrincipalArn) {
    throw "Refusing upload/build: use the MFA-backed $expectedPrincipalArn session."
  }
  $configuredRegion = (& $awsCli configure get region --profile $Profile).Trim()
  if ($configuredRegion -ne $expectedRegion) {
    throw "Refusing upload/build outside $expectedRegion."
  }

  $imageTag = "git-$commit"
  $existingDigest = (& $awsCli ecr list-images `
    --profile $Profile `
    --region $expectedRegion `
    --repository-name techlong-sandbox-speedfeast `
    --filter tagStatus=TAGGED `
    --query "imageIds[?imageTag=='$imageTag'].imageDigest | [0]" `
    --output text).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to check the immutable ECR image tag.' }
  if ($existingDigest -match '^sha256:[0-9a-f]{64}$') {
    Write-Host "Reusing existing immutable image 402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@$existingDigest."
    Write-Host 'No source was uploaded and no CodeBuild build was started.'
    exit 0
  }
  if ($existingDigest -notin @('', 'None', 'null')) {
    throw 'ECR returned an unexpected digest value; refusing to build.'
  }

  $objectKey = "source/speedfeast-$commit.zip"
  & $awsCli s3api put-object `
    --profile $Profile `
    --region $expectedRegion `
    --bucket $sourceBucket `
    --key $objectKey `
    --body $archive `
    --server-side-encryption AES256 `
    --metadata "git-commit=$commit,sha256=$archiveHash"
  if ($LASTEXITCODE -ne 0) { throw 'Source upload failed.' }
  Write-Host "Uploaded allowlisted source to s3://$sourceBucket/$objectKey; lifecycle expiry is one day."

  if ($Mode -eq 'Upload') {
    Write-Host 'Upload complete. No CodeBuild build was started.'
    exit 0
  }

  & $awsCli codebuild start-build `
    --profile $Profile `
    --region $expectedRegion `
    --project-name $buildProject `
    --source-type-override S3 `
    --source-location-override "$sourceBucket/$objectKey" `
    --buildspec-override buildspec.aws-sandbox.yml `
    --environment-variables-override "name=IMAGE_TAG,value=$imageTag,type=PLAINTEXT"
  if ($LASTEXITCODE -ne 0) { throw 'CodeBuild failed to start.' }
  Write-Host 'A single bounded CodeBuild build was started; inspect its status before provisioning.'
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
}
