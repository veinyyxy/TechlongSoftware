// Build-time candidate scan only; no AWS, registry credentials or runtime wiring.
import {readFile,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {imageReceipt} from './image-artifact.mjs';
import {must} from './contract.mjs';

export function checkCandidateScan(report,db,imageId,now=Date.now()){
  must(/^sha256:[a-f0-9]{64}$/.test(imageId)&&report.ArtifactName===imageId&&report.ArtifactType==='container_image'&&
    report.Metadata?.ImageID===imageId&&report.Metadata.OS?.Family==='alpine'&&
    /^3\.24(\.\d+)*$/.test(report.Metadata.OS.Name)&&report.Metadata.OS.EOSL!==true,'SECURITY_SCAN_IMAGE');
  const age=now-Date.parse(db.UpdatedAt);
  must(db.Version===2&&Number.isFinite(age)&&age>=-300000&&age<=48*3600000,'SECURITY_SCAN_DATABASE');
  const rows=(report.Results??[]).filter(r=>r.Class==='os-pkgs');
  must(rows.length===1&&Array.isArray(rows[0].Packages)&&rows[0].Packages.length>=10,'SECURITY_SCAN_COVERAGE');
  const counts={HIGH:0,CRITICAL:0},vulns=rows[0].Vulnerabilities??[];
  for(const v of vulns){must(v.Severity==='HIGH'||v.Severity==='CRITICAL','SECURITY_SCAN_SEVERITY');counts[v.Severity]++;}
  return {schema:'techlong/platform-candidate-os-scan/v1',outcome:vulns.length?'HIGH_CRITICAL_FINDINGS':'OS_HIGH_CRITICAL_ZERO',
    imageConfigDigest:imageId,scannerVersion:'0.75.0',
    scannerArchiveSha256:'c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f',
    os:report.Metadata.OS,packageCount:rows[0].Packages.length,databaseUpdatedAt:db.UpdatedAt,findingSeverityCounts:counts,
    findings:vulns.slice(0,200).map(v=>({id:v.VulnerabilityID,package:v.PkgName,installedVersion:v.InstalledVersion,
      fixedVersion:v.FixedVersion??null,severity:v.Severity})),findingsTruncated:vulns.length>200,
    ignoredFindingsAllowed:false,ignoreUnfixedAllowed:false,awsCalls:0};
}
async function digest(file){const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');}
export async function scanCandidate(dir,cache,env=process.env){
  must(!Object.keys(env).some(k=>/^(AWS_|ACTIONS_ID_TOKEN_REQUEST_|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$)/.test(k)&&env[k])&&
    env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','SECURITY_SCAN_CREDENTIAL_OR_OVERRIDE');
  const receipt=JSON.parse(await readFile(path.join(dir,'image-receipt.json'),'utf8'));
  const inspection=JSON.parse(await readFile(path.join(dir,'image-inspect.json'),'utf8'));
  const actual=imageReceipt(inspection,{bytes:receipt.archiveBytes,sha256:receipt.archiveSha256},env);
  must(JSON.stringify(actual)===JSON.stringify(receipt),'SECURITY_SCAN_RECEIPT');
  const reportFile=path.join(dir,'os-scan.json'),dbFile=path.join(cache,'db/metadata.json');
  const result=checkCandidateScan(JSON.parse(await readFile(reportFile,'utf8')),JSON.parse(await readFile(dbFile,'utf8')),actual.imageConfigDigest);
  Object.assign(result,{recordedAtUtc:new Date().toISOString(),sourceCommit:actual.sourceCommit,runId:actual.runId,
    reportSha256:await digest(reportFile),databaseMetadataSha256:await digest(dbFile),databaseSha256:await digest(path.join(cache,'db/trivy.db'))});
  const f=await open(path.join(dir,'os-scan-summary.json'),'wx',0o600);
  try{await f.writeFile(JSON.stringify(result,null,2)+'\n');await f.sync();}finally{await f.close();}
  must(result.outcome==='OS_HIGH_CRITICAL_ZERO','SECURITY_SCAN_FINDINGS');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [dir,cache,...extra]=process.argv.slice(2);
  Promise.resolve().then(()=>{must(dir&&cache&&!extra.length,'SECURITY_SCAN_ARGUMENTS');return scanCandidate(dir,cache);})
    .then(v=>console.log(JSON.stringify(v))).catch(()=>{console.error('PLATFORM_CANDIDATE_SCAN_REFUSED');process.exitCode=1;});
}
