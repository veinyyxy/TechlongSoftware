param([Parameter(Mandatory)][UInt64]$RunId,[Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedHeadSha,[Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$proofDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if([IO.Path]::GetDirectoryName($proofDirectory).TrimEnd('\','/') -ine [IO.Path]::GetFullPath('F:/ChatGPT_workshop').TrimEnd('\','/') -or
 [IO.Path]::GetFileName($proofDirectory) -cnotmatch '^techlong-f3b3-pg18-ci-[a-z0-9-]+$' -or (Test-Path -LiteralPath $proofDirectory)){throw 'Fresh private CI evidence directory required'}
$credentialInput=[string]::Join([char]10,@('protocol=https','host=github.com','path=veinyyxy/TechlongSoftware.git','',''))
$credentials=$credentialInput | git -c safe.directory=E:/NodejsProject/TechlongSoftware credential fill
if($LASTEXITCODE -ne 0){throw 'GitHub credential lookup failed'}
$passwordLine=$credentials | Where-Object{$_.StartsWith('password=')} | Select-Object -First 1
if(-not $passwordLine){throw 'GitHub credential unavailable'}
$headers=@{Authorization=('Bearer '+$passwordLine.Substring(9));Accept='application/vnd.github+json';'X-GitHub-Api-Version'='2026-03-10'}
$credentials=$null;$passwordLine=$null
$api='https://api.github.com/repos/veinyyxy/TechlongSoftware'
$run=Invoke-RestMethod -Uri ($api+'/actions/runs/'+$RunId) -Headers $headers
if($run.head_sha -cne $ExpectedHeadSha -or $run.head_branch -cne 'main' -or $run.path -cne '.github/workflows/sealed-plan-postgres18.yml' -or
 $run.run_attempt -ne 1 -or $run.status -cne 'completed' -or $run.conclusion -cne 'success'){throw 'Exact CI run is not verified successful'}
$listing=Invoke-RestMethod -Uri ($api+'/actions/runs/'+$RunId+'/artifacts') -Headers $headers
$artifacts=@($listing.artifacts | Where-Object{$_.name -ceq ('sealed-pg18-proof-'+$RunId+'-1')})
if($artifacts.Count -ne 1 -or $artifacts[0].expired){throw 'Exact unexpired CI artifact unavailable'}
New-Item -ItemType Directory -Path $proofDirectory | Out-Null
$zipPath=Join-Path $proofDirectory 'proof.zip'
Invoke-WebRequest -Uri ($api+'/actions/artifacts/'+$artifacts[0].id+'/zip') -Headers $headers -OutFile $zipPath
$zipSha=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if($artifacts[0].digest -cne ('sha256:'+$zipSha)){throw 'GitHub artifact digest mismatch'}
$archive=[IO.Compression.ZipFile]::OpenRead($zipPath)
try{
 $allowed=@('sealed-plan-verification.json','ci-receipt.json','service-image.json','service-running.json')
 $seen=@()
 foreach($entry in $archive.Entries){
  if($entry.FullName -cnotin $allowed -or $entry.Length -gt 2000000 -or $seen -ccontains $entry.FullName){throw 'Unexpected CI artifact member'}
  $seen+=$entry.FullName
  $reader=$entry.Open();$writer=[IO.File]::Open((Join-Path $proofDirectory $entry.FullName),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
  try{$reader.CopyTo($writer)}finally{$reader.Dispose();$writer.Dispose()}
 }
 if($seen.Count -ne 4){throw 'Incomplete CI artifact'}
}finally{$archive.Dispose()}
$report=Get-Content -LiteralPath (Join-Path $proofDirectory 'sealed-plan-verification.json') -Raw | ConvertFrom-Json -DateKind String
$receipt=Get-Content -LiteralPath (Join-Path $proofDirectory 'ci-receipt.json') -Raw | ConvertFrom-Json -DateKind String
$image=Get-Content -LiteralPath (Join-Path $proofDirectory 'service-image.json') -Raw | ConvertFrom-Json
$running=Get-Content -LiteralPath (Join-Path $proofDirectory 'service-running.json') -Raw | ConvertFrom-Json
if($report.postgresVersion -ne 180006 -or $receipt.githubHeadSha -cne $ExpectedHeadSha -or $receipt.githubRunId -cne [string]$RunId -or
 $report.outcome -cne 'SEALED_PLAN_CANDIDATE_REAL_PG18_VERIFIED_NOT_INSTALLED' -or -not $receipt.ownedCiDatabaseDropped -or $running -ne $false -or
 $image -cne 'postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873' -or
 $report.neonMutationPerformed -or $report.installationAuthorized -or $report.runtimeEnabled){throw 'CI receipt or cleanup/image binding failed'}
$proofSummary=[ordered]@{schemaVersion=1;outcome='EXACT_PG18_CI_ARTIFACT_AND_TEARDOWN_VERIFIED';runId=$RunId;headSha=$ExpectedHeadSha;url=$run.html_url
 artifactId=$artifacts[0].id;archiveSha256=$zipSha;reportSha256=(Get-FileHash -LiteralPath (Join-Path $proofDirectory 'sealed-plan-verification.json') -Algorithm SHA256).Hash.ToLowerInvariant()
 receiptSha256=(Get-FileHash -LiteralPath (Join-Path $proofDirectory 'ci-receipt.json') -Algorithm SHA256).Hash.ToLowerInvariant();proofGroups=$report.proofs.Count
 candidateTextSha256=$report.candidateTextSha256;postgresVersion=$report.postgresVersion;ownedDatabaseDropped=$true;ownedContainerStopped=$true;neonMutationPerformed=$false;installationAuthorized=$false}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($proofSummary | ConvertTo-Json -Depth 10)+[char]10)
$summaryPath=Join-Path $proofDirectory 'independent-verification.json';$stream=[IO.File]::Open($summaryPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
try{$stream.Write($bytes)}finally{$stream.Dispose()}
$proofSummary | ConvertTo-Json -Depth 10
