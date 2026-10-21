// Publication proposals and validation only: no clients, credentials or writes.
import {lockedPublisherFoundation,PUBLISHER_V2 as V} from '../platform-image-recovery-v2/publisher-foundation.mjs';
export const PUBLICATION=Object.freeze({
  repository:'veinyyxy/TechlongSoftware',repositoryId:1323312747,ownerId:'14145707',actorId:'14145707',
  sourceCommit:'e06498436dab7022f6fb6ab4f450689fd3c6722e',runId:39656845292,workflowId:391864582,
  artifactId:12371098858,artifactBytes:329772909,
  artifactName:'platform-web-image-e06498436dab7022f6fb6ab4f450689fd3c6722e-39656845292',
  artifactDigest:'sha256:3b7764998422bfe07381a758d75e3463cf3ab91770a25dd75d8b98faac182855',
  artifactExpiresAt:'2026-10-24T18:55:49Z',
  imageConfigDigest:'sha256:98591bc59ab26105f6d60c1b2b3d70c853fd56846109b09f9561c3acd53610a3',
  archiveSha256:'164d39e898e76f90ce132ce7fcae6044443e03f85ba121e7526e9a60898f3b6c',
  roleId:'AROAV3GNMXTZID6CJJBA2',roleArn:`arn:aws:iam::${V.account}:role/${V.role}`,
  stackId:`arn:aws:cloudformation:${V.region}:${V.account}:stack/${V.stack}/701257e0-cd89-11f1-be5e-02452f6c634b`,
  environment:'techlong-sandbox-deploy',
  oidcSubject:'repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy',
  reusableFile:'platform-image-publish-job-v1.yml',
  targetTag:'platform-shae06498436dab7022f6fb6ab4f450689fd3c6722e-r39656845292-a1',
  scannerVersion:'0.75.0',scannerSha256:'c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f',
});
export const must=(v,c)=>{if(!v)throw Error('PLATFORM_IMAGE_PUBLICATION_'+c);};
export function verifyCandidate(run,artifact,now=Date.now()){
  const p=PUBLICATION;
  must(run.id===p.runId&&run.head_sha===p.sourceCommit&&run.head_branch==='main'&&run.event==='push'&&
    run.run_attempt===1&&run.status==='completed'&&run.conclusion==='success'&&run.workflow_id===p.workflowId&&
    run.path==='.github/workflows/platform-hosting-candidate.yml'&&run.repository?.id===p.repositoryId,'CANDIDATE_RUN');
  must(artifact.id===p.artifactId&&artifact.name===p.artifactName&&artifact.size_in_bytes===p.artifactBytes&&
    artifact.digest===p.artifactDigest&&artifact.expired===false&&Date.parse(artifact.expires_at)===Date.parse(p.artifactExpiresAt)&&
    now<Date.parse(artifact.expires_at)&&artifact.workflow_run?.id===p.runId&&artifact.workflow_run.repository_id===p.repositoryId&&
    artifact.workflow_run.head_repository_id===p.repositoryId&&artifact.workflow_run.head_sha===p.sourceCommit,'CANDIDATE_ARTIFACT');
  return {candidateRunVerified:true,artifactMetadataVerified:true,artifactBytesVerified:false};
}
export function grantTemplate({reusableCommit,startsAtUtc,expiresAtUtc}){
  must(/^[a-f0-9]{40}$/.test(reusableCommit),'REUSABLE_COMMIT');
  const start=Date.parse(startsAtUtc),end=Date.parse(expiresAtUtc);
  must(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=3600000&&end<=Date.parse(PUBLICATION.artifactExpiresAt),'GRANT_WINDOW');
  const t=lockedPublisherFoundation(),r=t.Resources.PlatformImagePublisher.Properties,p=PUBLICATION;
  r.AssumeRolePolicyDocument.Statement.push({Sid:'OneReviewedPlatformPublication',Effect:'Allow',
    Principal:{Federated:`arn:aws:iam::${V.account}:oidc-provider/token.actions.githubusercontent.com`},Action:['sts:AssumeRoleWithWebIdentity'],
    Condition:{StringEquals:{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub':p.oidcSubject,'token.actions.githubusercontent.com:repository_id':String(p.repositoryId),
      'token.actions.githubusercontent.com:repository_owner_id':p.ownerId,'token.actions.githubusercontent.com:actor_id':p.actorId,
      'token.actions.githubusercontent.com:ref':'refs/heads/main','token.actions.githubusercontent.com:environment':p.environment,
      'token.actions.githubusercontent.com:job_workflow_ref':`${p.repository}/.github/workflows/${p.reusableFile}@${reusableCommit}`},
      DateGreaterThanEquals:{'aws:CurrentTime':startsAtUtc},DateLessThan:{'aws:CurrentTime':expiresAtUtc}}});
  for(const s of r.Policies[0].PolicyDocument.Statement)s.Condition={...s.Condition,
    DateGreaterThanEquals:{'aws:CurrentTime':startsAtUtc},DateLessThan:{'aws:CurrentTime':expiresAtUtc}};
  return t;
}
export function revokeTemplate(){
  const t=lockedPublisherFoundation();
  // Restoring trust alone does NOT revoke already-issued sessions/registry tokens.
  t.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument={Version:'2012-10-17',
    Statement:[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]};
  return t;
}
export function verifyOsScan(report,database,now=Date.now()){
  const p=PUBLICATION,age=now-Date.parse(database.UpdatedAt);
  must(report.ArtifactName===p.imageConfigDigest&&report.ArtifactType==='container_image'&&
    report.Metadata?.ImageID===p.imageConfigDigest&&report.Metadata.OS?.Family==='debian'&&
    /^(12|13)(\.\d+)*$/.test(report.Metadata.OS.Name)&&report.Metadata.OS.EOSL!==true,'SCAN_IMAGE_OS');
  must(database.Version===2&&Number.isFinite(age)&&age>=-300000&&age<=48*3600000,'SCAN_DATABASE');
  const rows=(report.Results??[]).filter(r=>r.Class==='os-pkgs');
  must(rows.length===1&&Array.isArray(rows[0].Packages)&&rows[0].Packages.length>=10,'SCAN_PACKAGES');
  const counts={HIGH:0,CRITICAL:0};
  for(const v of rows[0].Vulnerabilities??[]){must(v.Severity==='HIGH'||v.Severity==='CRITICAL','SCAN_SEVERITY');counts[v.Severity]++;}
  return {schema:'techlong/platform-image-os-scan/v1',outcome:counts.HIGH||counts.CRITICAL?'HIGH_CRITICAL_FINDINGS':'OS_HIGH_CRITICAL_ZERO',
    imageConfigDigest:p.imageConfigDigest,scanner:'Trivy',scannerVersion:p.scannerVersion,scannerArchiveSha256:p.scannerSha256,
    os:report.Metadata.OS,packageCount:rows[0].Packages.length,findingSeverityCounts:counts,databaseUpdatedAt:database.UpdatedAt,
    findings:(rows[0].Vulnerabilities??[]).slice(0,200).map(v=>({id:v.VulnerabilityID,package:v.PkgName,
      installedVersion:v.InstalledVersion,fixedVersion:v.FixedVersion??null,severity:v.Severity})),
    findingsTruncated:(rows[0].Vulnerabilities??[]).length>200,
    ignoredFindingsAllowed:false,ignoreUnfixedAllowed:false,awsCalls:0};
}
