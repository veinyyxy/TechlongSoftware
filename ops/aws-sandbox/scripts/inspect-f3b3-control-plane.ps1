param([Parameter(Mandatory)][string]$OutputDirectory,[switch]$DedicatedExecutorRoleOnly)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$target=[IO.Path]::GetFullPath($OutputDirectory)
if([IO.Path]::GetDirectoryName($target).TrimEnd('\','/') -ine [IO.Path]::GetFullPath('F:/ChatGPT_workshop').TrimEnd('\','/') -or
  [IO.Path]::GetFileName($target) -cnotmatch '^techlong-f3b3-control-[a-z0-9-]+$' -or (Test-Path -LiteralPath $target)){throw 'Fresh direct private evidence directory required.'}
$env:AWS_IGNORE_CONFIGURED_ENDPOINT_URLS='true';$env:AWS_PAGER='';$env:AWS_CLI_AUTO_PROMPT='off';$env:AWS_MAX_ATTEMPTS='1'
function Read-Aws([string[]]$Arguments){
  $raw=& aws @Arguments --profile techlong-sandbox-user --region ca-central-1 --output json --no-cli-pager --cli-connect-timeout 10 --cli-read-timeout 30 2>&1
  if($LASTEXITCODE -ne 0){
    $diagnostic=$raw -join [char]10
    if($diagnostic -match 'Your session has expired'){throw 'SOURCE_AUTH_EXPIRED_READ_ONLY'}
    if($diagnostic -match '\((NoSuchEntity|ResourceNotFoundException)\)'){return [ordered]@{state='ABSENT';errorCode=$Matches[1]}}
    throw ('READ_ONLY_'+$Arguments[0]+'_'+$Arguments[1]+'_NOT_VERIFIED')
  }
  return (($raw -join [char]10) | ConvertFrom-Json -DateKind String)
}
$identity=Read-Aws @('sts','get-caller-identity')
if($identity.Account -cne '402010193138' -or $identity.Arn -cne 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'){throw 'Exact Source identity mismatch.'}
New-Item -ItemType Directory -Path $target | Out-Null
if($DedicatedExecutorRoleOnly){
  $executor=Read-Aws @('iam','get-role','--role-name','TechlongSandboxCellTtlExecutorRole')
  $executorReport=[ordered]@{schemaVersion=1;stage='F3b3';outcome='DEDICATED_EXECUTOR_ROLE_READ_ONLY';at=[DateTimeOffset]::UtcNow.ToString('o');source=$identity
    roleName='TechlongSandboxCellTtlExecutorRole';observed=$executor;installationAuthorized=$false;cloudMutationPerformed=$false;secretValueRead=$false}
  $executorBytes=[Text.UTF8Encoding]::new($false).GetBytes(($executorReport | ConvertTo-Json -Depth 80)+[char]10)
  $executorFile=Join-Path $target 'executor-role-inventory.json';$executorStream=[IO.File]::Open($executorFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
  try{$executorStream.Write($executorBytes)}finally{$executorStream.Dispose()}
  [ordered]@{outcome=$executorReport.outcome;output=$executorFile;reportSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($executorBytes)).ToLowerInvariant();observed=$executor;installationAuthorized=$false;cloudMutationPerformed=$false} | ConvertTo-Json -Depth 80
  return
}
$role=Read-Aws @('iam','get-role','--role-name','TechlongSandboxCellJanitorExecutionRole')
if($role.PSObject.Properties.Name -notcontains 'Role'){throw 'Existing Janitor role not verified.'}
$boundary=$role.Role.PermissionsBoundary.PermissionsBoundaryArn
$policy=Read-Aws @('iam','get-policy','--policy-arn',$boundary)
$version=Read-Aws @('iam','get-policy-version','--policy-arn',$boundary,'--version-id',$policy.Policy.DefaultVersionId)
$inlineNames=Read-Aws @('iam','list-role-policies','--role-name','TechlongSandboxCellJanitorExecutionRole')
$inline=@(foreach($name in $inlineNames.PolicyNames){Read-Aws @('iam','get-role-policy','--role-name','TechlongSandboxCellJanitorExecutionRole','--policy-name',$name)})
$attached=Read-Aws @('iam','list-attached-role-policies','--role-name','TechlongSandboxCellJanitorExecutionRole')
$functionQuery='{arn:FunctionArn,role:Role,runtime:Runtime,timeout:Timeout,memory:MemorySize,codeSha256:CodeSha256,mode:Environment.Variables.CELL_CLEANUP_COORDINATOR_MODE}'
$legacy=Read-Aws @('lambda','get-function-configuration','--function-name','techlong-sandbox-cell-janitor','--query',$functionQuery)
$newFunctions=@(foreach($name in @('techlong-sandbox-cell-drain-coordinator','techlong-sandbox-cell-ttl-executor')){
  [ordered]@{name=$name;observed=(Read-Aws @('lambda','get-function-configuration','--function-name',$name,'--query',$functionQuery))}
})
$newRole=Read-Aws @('iam','get-role','--role-name','TechlongSandboxCellDrainCoordinatorRole')
$newBoundaries=@(foreach($name in @('TechlongSandboxCellDrainCoordinatorBoundary','TechlongSandboxCellTtlExecutorBoundary')){
  [ordered]@{name=$name;observed=(Read-Aws @('iam','get-policy','--policy-arn',('arn:aws:iam::402010193138:policy/'+$name)))}
})
$secrets=@(foreach($name in @('techlong/sandbox/cell-drain-control','techlong/sandbox/cell-cleanup-readonly')){
  [ordered]@{name=$name;observed=(Read-Aws @('secretsmanager','describe-secret','--secret-id',$name,'--query','{arn:ARN,name:Name,deletedDate:DeletedDate}'))}
})
$report=[ordered]@{schemaVersion=1;stage='F3b3';outcome='CONTROL_PLANE_INVENTORY_READ_ONLY';at=[DateTimeOffset]::UtcNow.ToString('o');source=$identity
  existingJanitorRole=$role;existingBoundary=$policy;existingBoundaryVersion=$version;existingInlinePolicies=$inline;attachedPolicies=$attached
  legacyPlanOnlyFunction=$legacy;proposedFunctions=$newFunctions;proposedRole=$newRole;proposedBoundaries=$newBoundaries;proposedSecrets=$secrets
  installationAuthorized=$false;cloudMutationPerformed=$false;secretValueRead=$false}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 80)+[char]10)
$file=Join-Path $target 'control-inventory.json';$stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
try{$stream.Write($bytes)}finally{$stream.Dispose()}
[ordered]@{outcome=$report.outcome;output=$file;reportSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant();legacyMode=$legacy.mode;existingBoundaryArn=$boundary;installationAuthorized=$false;cloudMutationPerformed=$false} | ConvertTo-Json
