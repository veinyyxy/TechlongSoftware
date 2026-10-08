[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# One read-only Source pass. No login/AssumeRole, grant, Lambda invoke, change
# set, resource write or write retry. Only the generated local evidence is saved.
$root=[IO.Path]::GetFullPath('F:/ChatGPT_workshop')
$target=[IO.Path]::GetFullPath($OutputDirectory)
if([IO.Path]::GetDirectoryName($target).TrimEnd('\','/') -ine $root.TrimEnd('\','/') -or
  [IO.Path]::GetFileName($target) -cnotmatch '^techlong-f3-readonly-[a-zA-Z0-9-]+$' -or (Test-Path -LiteralPath $target)) {
  throw 'Require a fresh direct-child F:/ChatGPT_workshop/techlong-f3-readonly-* directory. No reset.'
}
foreach($name in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_ENDPOINT_URL','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE')) {
  if([Environment]::GetEnvironmentVariable($name)){throw "Credential/endpoint override $name is not allowed."}
}
$env:AWS_IGNORE_CONFIGURED_ENDPOINT_URLS='true'
$env:AWS_PAGER=''
$env:AWS_CLI_AUTO_PROMPT='off'
$env:AWS_MAX_ATTEMPTS='1'
$reads=[Collections.Generic.List[object]]::new()
function Read-Aws([string]$Label,[string[]]$Arguments,[string]$Region='ca-central-1') {
  $at=[DateTimeOffset]::UtcNow.ToString('o')
  $output=& aws @Arguments --profile techlong-sandbox-user --region $Region --output json --no-cli-pager --cli-connect-timeout 10 --cli-read-timeout 30 2>&1
  $exitCode=$LASTEXITCODE
  $source=($output -join [char]10)
  if($exitCode -eq 0) {
    $data=$source | ConvertFrom-Json -Depth 100 -NoEnumerate
    $item=[ordered]@{label=$Label;at=$at;readSucceeded=$true;data=$data}
  } else {
    $code=[regex]::Match($source,'\(([A-Za-z0-9_.-]+)\)').Groups[1].Value
    if(!$code){$code='READ_FAILED'}
    $item=[ordered]@{label=$Label;at=$at;readSucceeded=$false;errorCode=$code}
  }
  $reads.Add($item)
  Write-Host "READ $Label => $($item.readSucceeded)"
  return $item
}
$identity=Read-Aws 'SourceIdentity' @('sts','get-caller-identity')
if(!$identity.readSucceeded -or $identity.data.Account -cne '402010193138' -or
  $identity.data.Arn -cne 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'){throw 'Source identity mismatch; no further reads.'}
New-Item -ItemType Directory -Path $target | Out-Null
try {
  $null=Read-Aws 'Aurora16_14' @('rds','describe-db-engine-versions','--engine','aurora-postgresql','--engine-version','16.14')
  $null=Read-Aws 'Aurora16_14Serverless' @('rds','describe-orderable-db-instance-options','--engine','aurora-postgresql','--engine-version','16.14','--db-instance-class','db.serverless')
  $null=Read-Aws 'AvailabilityZones' @('ec2','describe-availability-zones','--filters','Name=region-name,Values=ca-central-1','Name=state,Values=available')
  $null=Read-Aws 'CellCluster' @('ecs','describe-clusters','--clusters','cell-sandbox-1','--include','SETTINGS','STATISTICS','TAGS')
  $null=Read-Aws 'SandboxDatabaseClusters' @('rds','describe-db-clusters','--query','DBClusters[?starts_with(DBClusterIdentifier, `techlong-sandbox-`)]')
  $null=Read-Aws 'LoadBalancers' @('elbv2','describe-load-balancers','--query','LoadBalancers[].{name:LoadBalancerName,arn:LoadBalancerArn,type:Type,state:State.Code,scheme:Scheme}')
  $null=Read-Aws 'AuthorityTable' @('dynamodb','describe-table','--table-name','techlong-sandbox-tenant-external-epoch-authority')
  foreach($key in @('cell:cell-sandbox-1','runtime:cell-sandbox-1:lifecycle-v2')) {
    $json=ConvertTo-Json -Compress @{authority_key=@{S=$key}}
    $null=Read-Aws $key @('dynamodb','get-item','--table-name','techlong-sandbox-tenant-external-epoch-authority','--key',$json,'--consistent-read')
  }
  foreach($stack in @('techlong-sandbox-cell-sandbox-1','techlong-s3-b5-cell-bootstrap','techlong-s3-b5-cell-bootstrap-management',
    'techlong-s3-b5-cell-lifecycle-management','techlong-sandbox-github-image-publication')) {
    $null=Read-Aws "Stack:$stack" @('cloudformation','describe-stacks','--stack-name',$stack,'--query','Stacks[].{id:StackId,status:StackStatus,role:RoleARN,outputs:Outputs,tags:Tags}')
  }
  $null=Read-Aws 'CellJanitor' @('lambda','get-function-configuration','--function-name','techlong-sandbox-cell-janitor','--query',
    '{arn:FunctionArn,role:Role,code:CodeSha256,runtime:Runtime,state:State,update:LastUpdateStatus,timeout:Timeout,mode:Environment.Variables.CELL_CLEANUP_COORDINATOR_MODE}')
  $null=Read-Aws 'CellGlobalSchedule' @('scheduler','get-schedule','--group-name','techlong-sandbox-cell','--name','techlong-sandbox-cell-global-janitor')
  $null=Read-Aws 'Certificates' @('acm','list-certificates','--certificate-statuses','ISSUED','PENDING_VALIDATION')
  $null=Read-Aws 'ControlTrustStores' @('elbv2','describe-trust-stores')
  $null=Read-Aws 'HostedZones' @('route53','list-hosted-zones','--query','HostedZones[].{id:Id,name:Name,private:Config.PrivateZone}')
  $null=Read-Aws 'Budgets' @('budgets','describe-budgets','--account-id','402010193138','--query','Budgets[].{name:BudgetName,limit:BudgetLimit,filters:CostFilters,calculated:CalculatedSpend}') 'us-east-1'
  $null=Read-Aws 'CostAllocationTags' @('ce','list-cost-allocation-tags','--tag-keys','Environment','--type','UserDefined') 'us-east-1'
  $null=Read-Aws 'BaselineBucket' @('s3api','head-bucket','--bucket','techlong-sandbox-402010193138-ca-central-1-tenant-baselines','--expected-bucket-owner','402010193138')
  foreach($role in @('TechlongSandboxTenantLifecycleTaskRole','TechlongSandboxTaskExecutionRole','TechlongSandboxGitHubImagePublisherRole',
    'TechlongSandboxCellOperatorRole','TechlongSandboxCellCloudFormationExecutionRole')) {
    $null=Read-Aws "Role:$role" @('iam','get-role','--role-name',$role)
    $policies=Read-Aws "InlinePolicies:$role" @('iam','list-role-policies','--role-name',$role)
    if($policies.readSucceeded){foreach($policy in $policies.data.PolicyNames){
      $null=Read-Aws "Inline:$role/$policy" @('iam','get-role-policy','--role-name',$role,'--policy-name',$policy)
    }}
    $null=Read-Aws "AttachedPolicies:$role" @('iam','list-attached-role-policies','--role-name',$role)
  }
  foreach($policy in @('TechlongSandboxServiceRoleBoundary','TechlongSandboxGitHubImagePublisherBoundary','TechlongSandboxCellOperatorBoundary','TechlongSandboxCellCloudFormationExecutionBoundary')) {
    $arn="arn:aws:iam::402010193138:policy/$policy"
    $meta=Read-Aws "Boundary:$policy" @('iam','get-policy','--policy-arn',$arn)
    if($meta.readSucceeded){$null=Read-Aws "BoundaryVersion:$policy" @('iam','get-policy-version','--policy-arn',$arn,'--version-id',$meta.data.Policy.DefaultVersionId)}
  }
  $null=Read-Aws 'EcrRepository' @('ecr','describe-repositories','--registry-id','402010193138','--repository-names','techlong-sandbox-speedfeast')
  $null=Read-Aws 'EcrScanConfiguration' @('ecr','get-registry-scanning-configuration')
  $null=Read-Aws 'EcrImages' @('ecr','describe-images','--registry-id','402010193138','--repository-name','techlong-sandbox-speedfeast')
  $null=Read-Aws 'GithubOidc' @('iam','get-open-id-connect-provider','--open-id-connect-provider-arn','arn:aws:iam::402010193138:oidc-provider/token.actions.githubusercontent.com')
  foreach($serviceRole in @('AWSServiceRoleForECS','AWSServiceRoleForRDS','AWSServiceRoleForElasticLoadBalancing')) {
    $null=Read-Aws "ServiceLinkedRole:$serviceRole" @('iam','get-role','--role-name',$serviceRole,'--query','Role.Arn')
  }
} finally {
  $report=[ordered]@{schemaVersion=1;purpose='fast-track-f3-read-only-evidence/v1';at=[DateTimeOffset]::UtcNow.ToString('o');
    cloudMutationPerformed=$false;databaseAccessPerformed=$false;runtimeEnabled=$false;monthlyBudgetTargetUsd=50;reads=@($reads.ToArray())}
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 100)+"`n")
  $file=Join-Path $target 'aws-readback.json'
  $stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
  try{$stream.Write($bytes)}finally{$stream.Dispose()}
  $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
  Write-Host (ConvertTo-Json -Compress @{outcome='READ_ONLY_PASS_SAVED_NOT_READY';reads=$reads.Count;
    failedReads=@($reads | Where-Object { !$_.readSucceeded } | ForEach-Object {$_.label});output=$file;sha256=$hash;cloudMutationPerformed=$false})
}
