param([Parameter(Mandatory)][UInt64]$RunId,[Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedHeadSha,[Parameter(Mandatory)][string]$OutputDirectory,[switch]$RequireV3EvidencePlanProof,[switch]$RequireManagementProof,[switch]$RequireV3RuntimeProof,[switch]$RequireControlRoleProof,[switch]$RequireCredentialProof)
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
if($RequireV3EvidencePlanProof){
 $requiredProofs=@('v3AuthorityEvidenceRejectsActualFutureDeploymentBeforeCandidateCompilation',
  'v3FreshAdmissionEvidenceAndPreparedPlanBindFullCertificateAndRawWitnessAsActualRestrictedReader')
 $expectedProofCount=if($RequireCredentialProof){29}elseif($RequireControlRoleProof){26}elseif($RequireV3RuntimeProof){23}elseif($RequireManagementProof){19}else{16}
 if($report.proofs.Count -ne $expectedProofCount -or @($report.proofs | Select-Object -Unique).Count -ne $expectedProofCount -or
  @($requiredProofs | Where-Object{$_ -cnotin $report.proofs}).Count -ne 0 -or
  $report.candidateTextSha256 -cne 'c088d1a8c75705c88d3f2bfc38cc6070c731de4cac6cd891c91af821a4e3a57a' -or
  $report.sourceMutationPerformed -or $report.cloudMutationPerformed -or $report.migrationRegistered -or
  $report.productionRegistrationPerformed -or $report.ownershipSourceActivated){throw 'Exact v3 evidence/plan proof or uninstalled boundary failed'}
}
if($RequireControlRoleProof){
 $roleProofs=@('reviewedControlRolesLostCommitIndependentlyRecoverExactNoLoginGrantsAndPreservedSeal',
  'reviewedControlRolesWrongApprovalAndOccupiedStateNeverSubmitAgain','reviewedControlRolesRejectUnexpectedEffectiveColumnPrivilege')
 if(-not $RequireV3RuntimeProof -or @($roleProofs | Where-Object{$_ -cnotin $report.proofs}).Count -ne 0 -or
  $report.controlRoleSqlSha256 -cne '7fc82e392d1745b4e7031a1449d094cd2b327cfaccb459f768e917a4754df016'){throw 'Exact reviewed NOLOGIN role proof missing'}
}
if($RequireCredentialProof){
 $credentialProofs=@('credentialBootstrapStoresTwoMockSecretsBeforeAtomicScramLoginAndRealPasswordAuthentication',
  'credentialBootstrapLostCommitRecoversReadOnlyWithoutRepeatingWrites','credentialBootstrapRejectsWrongPasswordAndNeverPersistsMaterialInReceipts')
 if(-not $RequireControlRoleProof -or @($credentialProofs | Where-Object{$_ -cnotin $report.proofs}).Count -ne 0){throw 'Exact SCRAM/LOGIN/credential bootstrap proof missing'}
}
if($RequireV3RuntimeProof){
 $runtimeProofs=@('sealedV3RowSecurityCannotHideActiveFutureAssociationAndManufactureZero','sealedV3ReaderRejectsColumnWritesAndNontriggerSecurityDefinerExecution',
  'minimalControlRoleGrantsPermitRequiredRowLockButRejectStatusAndSealedOriginalWrites',
  'sealedV3DurableRootRunsOneMockActuatorWithActualRestrictedPostgresEvidence')
 if(-not $RequireManagementProof -or @($runtimeProofs | Where-Object{$_ -cnotin $report.proofs}).Count -ne 0){throw 'Exact v3 runtime/RLS proof missing'}
}
if($RequireManagementProof){
 $managementProofs=@('reviewedManagementInstallCommitsOnlyUnregisteredGuardsAndIndependentReadbackPreservesBusiness',
  'reviewedManagementRegistrationLostCommitResponseRecoversExactCertificateIndependently',
  'reviewedManagementWrongApprovalAndOccupiedCloudSlotsCannotWriteOrRetry')
 if(-not $RequireV3EvidencePlanProof -or $receipt.ownedCiDatabaseCountDropped -ne 2 -or
  @($managementProofs | Where-Object{$_ -cnotin $report.proofs}).Count -ne 0){throw 'Exact management install/registration/recovery proof or two-database teardown failed'}
}
$proofSummary=[ordered]@{schemaVersion=1;outcome='EXACT_PG18_CI_ARTIFACT_AND_TEARDOWN_VERIFIED';runId=$RunId;headSha=$ExpectedHeadSha;url=$run.html_url
 artifactId=$artifacts[0].id;archiveSha256=$zipSha;reportSha256=(Get-FileHash -LiteralPath (Join-Path $proofDirectory 'sealed-plan-verification.json') -Algorithm SHA256).Hash.ToLowerInvariant()
 receiptSha256=(Get-FileHash -LiteralPath (Join-Path $proofDirectory 'ci-receipt.json') -Algorithm SHA256).Hash.ToLowerInvariant();proofGroups=$report.proofs.Count
 candidateTextSha256=$report.candidateTextSha256;postgresVersion=$report.postgresVersion;ownedDatabaseDropped=$true;ownedContainerStopped=$true;neonMutationPerformed=$false;installationAuthorized=$false;v3EvidencePlanProofRequired=[bool]$RequireV3EvidencePlanProof;managementProofRequired=[bool]$RequireManagementProof;v3RuntimeProofRequired=[bool]$RequireV3RuntimeProof;controlRoleProofRequired=[bool]$RequireControlRoleProof;credentialProofRequired=[bool]$RequireCredentialProof}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($proofSummary | ConvertTo-Json -Depth 10)+[char]10)
$summaryPath=Join-Path $proofDirectory 'independent-verification.json';$stream=[IO.File]::Open($summaryPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
try{$stream.Write($bytes)}finally{$stream.Dispose()}
$proofSummary | ConvertTo-Json -Depth 10
