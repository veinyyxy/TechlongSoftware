param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if([IO.Path]::GetDirectoryName($taskDirectory).TrimEnd('\','/') -ine [IO.Path]::GetFullPath('F:/ChatGPT_workshop').TrimEnd('\','/') -or
 [IO.Path]::GetFileName($taskDirectory) -cnotmatch '^techlong-f3b3-v3-resource-read-[a-z0-9-]+$' -or (Test-Path -LiteralPath $taskDirectory)){throw 'Fresh bounded private output required'}
function Invoke-ScopedRead {
 param([string[]]$Arguments,[string]$AbsentCode='')
 $taskRaw=(& aws @Arguments --profile techlong-sandbox-user --region ca-central-1 --output json --no-cli-pager 2>&1 | Out-String)
 $taskExit=$LASTEXITCODE
 if($taskExit -eq 0){return [pscustomobject]@{state='PRESENT';data=($taskRaw | ConvertFrom-Json -DateKind String)}}
 $taskCode=if($taskRaw -match '\(([A-Za-z0-9_]+)\)'){$Matches[1]}else{'READ_FAILED'}
 return [pscustomobject]@{state=if($AbsentCode -and $taskCode -ceq $AbsentCode){'ABSENT'}else{'UNVERIFIED'};errorCode=$taskCode}
}
$taskIdentity=Invoke-ScopedRead -Arguments @('sts','get-caller-identity')
if($taskIdentity.state -cne 'PRESENT' -or $taskIdentity.data.Account -cne '402010193138' -or
 $taskIdentity.data.Arn -cne 'arn:aws:iam::402010193138:user/techlong-sandbox-dev'){throw 'Exact Source identity not verified; no resource mutation'}
$taskRoles=[ordered]@{}
foreach($taskName in @('TechlongSandboxCellTtlExecutorRole','TechlongSandboxCellDrainCoordinatorRole')){
 $taskRoles[$taskName]=Invoke-ScopedRead -Arguments @('iam','get-role','--role-name',$taskName) -AbsentCode 'NoSuchEntity'
}
$taskSecrets=[ordered]@{}
foreach($taskName in @('techlong/sandbox/cell-cleanup-readonly-v3','techlong/sandbox/cell-drain-control')){
 $taskSecrets[$taskName]=Invoke-ScopedRead -Arguments @('secretsmanager','describe-secret','--secret-id',$taskName) -AbsentCode 'ResourceNotFoundException'
}
$taskFunction=Invoke-ScopedRead -Arguments @('lambda','get-function-configuration','--function-name','techlong-sandbox-cell-ttl-executor-v3',
 '--query','{FunctionArn:FunctionArn,Role:Role,State:State,Runtime:Runtime,Timeout:Timeout,CodeSha256:CodeSha256}') -AbsentCode 'ResourceNotFoundException'
$taskTable=Invoke-ScopedRead -Arguments @('dynamodb','describe-table','--table-name','techlong-sandbox-tenant-external-epoch-authority',
 '--query','{Arn:Table.TableArn,Status:Table.TableStatus,BillingMode:Table.BillingModeSummary.BillingMode,ReadCapacity:Table.ProvisionedThroughput.ReadCapacityUnits,WriteCapacity:Table.ProvisionedThroughput.WriteCapacityUnits}')
$taskReport=[ordered]@{schemaVersion=1;mode='SOURCE_EXACT_RESOURCES_READONLY_NOT_INSTALLATION';observedAt=[DateTime]::UtcNow.ToString('o')
 sourceIdentity=$taskIdentity.data;roles=$taskRoles;secrets=$taskSecrets;executorFunction=$taskFunction;authorityTable=$taskTable
 secretValuesRead=$false;cloudMutationPerformed=$false;neonMutationPerformed=$false;installationAuthorized=$false;runtimeEnabled=$false}
New-Item -ItemType Directory -Path $taskDirectory | Out-Null
$taskFile=Join-Path $taskDirectory 'resource-inventory.json'
$taskBytes=[Text.UTF8Encoding]::new($false).GetBytes(($taskReport | ConvertTo-Json -Depth 30)+[char]10)
$taskStream=[IO.File]::Open($taskFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
try{$taskStream.Write($taskBytes)}finally{$taskStream.Dispose()}
[ordered]@{output=$taskFile;sha256=(Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant()
 roles=@($taskRoles.GetEnumerator() | ForEach-Object{[ordered]@{name=$_.Key;state=$_.Value.state}})
 secrets=@($taskSecrets.GetEnumerator() | ForEach-Object{[ordered]@{name=$_.Key;state=$_.Value.state}})
 functionState=$taskFunction.state;authorityTable=$taskTable;cloudMutationPerformed=$false} | ConvertTo-Json -Depth 6
