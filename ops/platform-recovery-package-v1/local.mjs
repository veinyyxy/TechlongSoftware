// Local preparation never constructs an AWS client. Upload is an explicit SHA gate.
import {readFile,open} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {S3Client,HeadBucketCommand,GetBucketVersioningCommand,GetBucketEncryptionCommand,GetBucketOwnershipControlsCommand,
  GetPublicAccessBlockCommand,GetBucketPolicyStatusCommand,HeadObjectCommand,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {noLinks,jsonFile,absent,writeOnce,newDirectory,cleanSource,assertEnvironment} from '../platform-operator-v6/files.mjs';
import {pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {readLocalCiV6} from '../platform-local-v6/local.mjs';
import {rebuildRecoveryPackage} from '../platform-recovery-v1/package.mjs';
import {recoveryData} from '../platform-recovery-v1/basis-core.mjs';
import {recoveryCloudClosure} from '../platform-recovery-cloud-v1/closure.mjs';
import {K,must,same,hash,makePackageReview,verifyPackageReview,assertSourceIdentity,assertAck,uploadPackageOnce} from './plan.mjs';
export const ROOTS=['ops/platform-recovery-package-v1/local.mjs','tests/platform-recovery-package-v1.test.mjs',K.riskFile,
  'ops/aws-sandbox/reviews/platform-recovery-publication-v1.executed.json','.github/workflows/platform-cloud-candidate.yml',
  '.github/workflows/cloud-worker-platform-job-v6.yml','.github/workflows/cloud-worker-platform-v6.yml',
  'package.json','package-lock.json','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json'];
export const packagePins=()=>collectPins({roots:ROOTS});
export function isDefiniteMissing(e){return e?.$metadata?.httpStatusCode===404&&['NotFound','NoSuchKey'].includes(e.name)&&
  String(e.DeleteMarker).toLowerCase()!=='true'&&!Object.entries(e.$response?.headers??{}).some(([k,v])=>k.toLowerCase()==='x-amz-delete-marker'&&String(v).toLowerCase()==='true');}
function environment(){assertEnvironment();must(!Object.keys(process.env).some(k=>/^AWS_(?:CA_BUNDLE|CONFIG_FILE|SHARED_CREDENTIALS_FILE|ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|PROFILE|DEFAULT_PROFILE|REGION|DEFAULT_REGION)$/.test(k)),'ENVIRONMENT');}
async function savedProofs(){
  const values=[];
  for(const [file,sha] of [[K.publicationProof,K.publicationProofSha256],[K.requestProof,K.requestProofSha256]]){
    const s=await noLinks(file);must(s.isFile()&&s.size<=1000000,'PROOF_FILE');const b=await readFile(file);must(hash(b)===sha,'PROOF_CHANGED');values.push(JSON.parse(b));
  }
  const [p,r]=values;
  must(p.outcome==='WORKFLOW_TRUST_PUBLICATION_AND_INDEPENDENT_INSPECT_COMPLETE_NO_BUSINESS_DISPATCH'&&p.permanentSlotsConsumed===true&&
    p.publishedReusableCommit===K.reusableCommit&&p.independentInspection.outcome==='APP_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH'&&
    r.outcome==='RECOVERY_HELD_REQUEST_COMMITTED_AND_INDEPENDENTLY_VERIFIED'&&r.newJobId===K.jobId&&r.basisSha256===K.basisSha256,'SAVED_PUBLICATION_OR_REQUEST');
}
export async function readFixedPackage(){
  const s=await noLinks(K.file);must(s.isFile()&&s.size===K.rawBytes,'LOCAL_PACKAGE_FILE');const f=await open(K.file,'r');let b;
  try{const a=await f.stat();must(a.ino===s.ino&&a.dev===s.dev&&a.size===s.size&&a.mtimeMs===s.mtimeMs,'LOCAL_PACKAGE_RACE');
    b=Buffer.alloc(K.rawBytes+1);const r=await f.read(b,0,b.length,0),after=await f.stat();
    must(r.bytesRead===K.rawBytes&&after.size===a.size&&after.mtimeMs===a.mtimeMs&&hash(b.subarray(0,r.bytesRead))===K.rawSha256,'LOCAL_PACKAGE_CHANGED');
    const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b.subarray(0,r.bytesRead))),basis=await rebuildRecoveryPackage(value),data=recoveryData(basis,Date.now());
    const body=canonicalJson(value);must(hash(body)===K.packageSha256&&Buffer.byteLength(body)===K.bytes&&basis.basisSha256===K.basisSha256&&
      basis.expiresAt===K.basisExpiresAt&&data.target.newJobId===K.jobId&&value.objects.length===7,'LOCAL_PACKAGE_BINDING');return body;
  }finally{b?.fill(0);await f.close();}
}
export async function createPackageIo(m,out,{inspect=false}={}){
  const counts={sourceSts:0,bucketMetadata:0,targetHead:0,localPackageReads:0,put:0,fixedVersionGet:0};
  const cfg={region:K.region,maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})};
  const sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'}),s3=new S3Client({...cfg,endpoint:'https://s3.ca-central-1.amazonaws.com',followRegionRedirects:false});
  const signal=AbortSignal.timeout(600000),send=(c,q)=>c.send(q,{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  const base={Bucket:K.bucket,ExpectedBucketOwner:K.owner},record=(name,v)=>writeOnce(out+'/'+name+'.json',v),writable=()=>must(!inspect,'READ_ONLY_CAPABILITY');
  const source=async()=>{must(++counts.sourceSts<=(inspect?1:2),'SOURCE_READ_BUDGET');const r=await send(sts,new GetCallerIdentityCommand({}));
    const p={Account:r.Account,Arn:r.Arn,UserId:r.UserId};assertSourceIdentity(p);return p;};
  async function headAbsent(){
    must(!inspect&&++counts.targetHead<=2,'HEAD_BUDGET');
    try{await send(s3,new HeadObjectCommand({...base,Key:m.put.Key}));}catch(e){
      if(isDefiniteMissing(e))return {targetAbsent:true,deleteMarker:false};throw e;
    }throw Error('RECOVERY_PACKAGE_TARGET_EXISTS');
  }
  async function assertSource(){environment();await cleanSource(m.sourceCommit);must(same(await packagePins(),m.pins),'SOURCE_PINS');
    const c=await recoveryCloudClosure();must(c.pinCount===97&&c.closureSha256===K.closureSha256,'CLOUD_CLOSURE');}
  return {assertSource,record,
    async preflight(){writable();const who=await source(),meta=async q=>{must(++counts.bucketMetadata<=6,'METADATA_BUDGET');return send(s3,q);};
      const h=await meta(new HeadBucketCommand(base)),versioning=await meta(new GetBucketVersioningCommand(base)),
        e=await meta(new GetBucketEncryptionCommand(base)),o=await meta(new GetBucketOwnershipControlsCommand(base)),
        p=await meta(new GetPublicAccessBlockCommand(base)),s=await meta(new GetBucketPolicyStatusCommand(base));
      return {source:who,region:h.BucketRegion,versioning:{Status:versioning.Status},encryption:e.ServerSideEncryptionConfiguration,
        ownership:o.OwnershipControls,publicAccess:p.PublicAccessBlockConfiguration,policyIsPublic:s.PolicyStatus?.IsPublic,...await headAbsent()};},
    async finalRead(){writable();return {source:await source(),...await headAbsent()};},
    async readPackage(){writable();must(++counts.localPackageReads===1,'PACKAGE_READ_BUDGET');return readFixedPackage();},
    async consume(v){writable();await writeOnce(K.slot,{...v,output:out,sourceCommit:m.sourceCommit});},
    async put(body){writable();must(++counts.put===1&&hash(body)===K.packageSha256&&Buffer.byteLength(body)===K.bytes,'PUT_BUDGET_OR_BODY');
      const r=await send(s3,new PutObjectCommand({...m.put,Body:body}));must(r.$metadata?.httpStatusCode===200,'PUT_STATUS');
      return {key:m.put.Key,versionId:r.VersionId,encryption:r.ServerSideEncryption,checksum:r.ChecksumSHA256};},
    async inspect(ack){must(inspect,'INSPECT_ONLY_CAPABILITY');const ref=assertAck(ack);await source();must(++counts.fixedVersionGet===1,'GET_BUDGET');
      const r=await send(s3,new GetObjectCommand({...base,Key:ref.key,VersionId:ref.versionId,ChecksumMode:'ENABLED'}));
      try{must(r.$metadata?.httpStatusCode===200&&r.VersionId===ref.versionId&&r.ContentLength===K.bytes&&r.ServerSideEncryption==='AES256'&&
          r.ChecksumSHA256===m.put.ChecksumSHA256&&r.DeleteMarker!==true&&r.Body,'GET_BINDING');
        const parts=[];let size=0;for await(const part of r.Body){size+=part.length;must(size<=K.bytes,'GET_SIZE');parts.push(part);}
        const b=Buffer.concat(parts);must(b.length===K.bytes&&hash(b)===K.packageSha256,'GET_HASH');const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
        must(canonicalJson(value)===b.toString('utf8'),'GET_CANONICAL');const basis=await rebuildRecoveryPackage(value);
        must(basis.basisSha256===K.basisSha256&&basis.expiresAt===K.basisExpiresAt,'GET_BASIS');
        return {outcome:'RECOVERY_PACKAGE_FIXED_VERSION_INDEPENDENTLY_VERIFIED',reference:ref,basisSha256:K.basisSha256,basisExpiresAt:K.basisExpiresAt,
          basisCurrentlyExpired:Date.now()>=K.basisExpiresAt,controllerActivated:false,workflowDispatched:false,externalWrites:0,retryAllowed:false};
      }finally{r.Body?.destroy?.();}},
    counts:()=>({...counts}),close(){s3.destroy();sts.destroy();},
  };
}
export function parsePackageArgs(args){
  const f={};must(args.length%2===0,'ARGUMENTS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(f,args[n])&&args[n+1]&&!args[n+1].startsWith('--'),'ARGUMENTS');f[args[n]]=args[n+1];}
  const mode=f['--mode'],keys=['--mode','--output',...(mode==='PrepareSaved'?['--ci-run']:mode==='Upload'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['PrepareSaved','Upload','Inspect'].includes(mode)&&Object.keys(f).length===keys.length&&keys.every(k=>f[k]),'ARGUMENTS');
  for(const dir of [f['--output'],...(f['--manifest']?[path.dirname(f['--manifest'])]:[])])
    must(/^F:\/ChatGPT_workshop\/techlong-w9l-recovery-package-[a-z0-9-]+$/.test(path.resolve(dir).replaceAll('\\','/')),'DIRECTORY');
  if(f['--manifest'])must(path.basename(f['--manifest'])==='manifest.json','MANIFEST_NAME');return f;
}
export async function main(args=process.argv.slice(2)){
  const f=parsePackageArgs(args);environment();const mode=f['--mode'],out=path.resolve(f['--output']).replaceAll('\\','/');let m,ack;
  await savedProofs();
  if(mode!=='PrepareSaved'){m=await jsonFile(f['--manifest'],300000);await verifyPackageReview(m,f['--approved-sha'],Date.now(),mode==='Inspect');}
  if(mode==='Inspect'){
    await absent(K.inspectSlot);const slot=await jsonFile(K.slot,10000);must(slot.manifestSha256===m.manifestSha256&&slot.packageSha256===K.packageSha256&&slot.sourceCommit===m.sourceCommit,'INSPECT_SLOT');
    must(/^F:\/ChatGPT_workshop\/techlong-w9l-recovery-package-[a-z0-9-]+$/.test(slot.output),'WRITER_DIRECTORY');ack=await jsonFile(slot.output+'/put-ack.json',10000);assertAck(ack);
  }else await absent(K.slot);
  await newDirectory('F:/ChatGPT_workshop',path.basename(out));
  if(mode==='PrepareSaved'){
    const sourceCommit=await cleanSource(),ci=await readLocalCiV6(f['--ci-run'],sourceCommit);await readFixedPackage();
    m=await makePackageReview({sourceCommit,ci,pins:await packagePins(),createdAt:Date.now()});await cleanSource(sourceCommit);await writeOnce(out+'/manifest.json',m);
    const result={outcome:'RECOVERY_PACKAGE_UPLOAD_REVIEW_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,expiresAt:m.expiresAt,
      latestStartAt:m.expiresAt-120000,packageSha256:K.packageSha256,canonicalBytes:K.bytes,basisExpiresAt:K.basisExpiresAt,
      awsCalls:0,localPackageReads:1,githubCiGets:3,slotsConsumed:0,uploads:0,controllerActivated:false,workflowDispatched:false};
    await writeOnce(out+'/result.json',result);console.log(JSON.stringify({...result,output:out}));return result;
  }
  const io=await createPackageIo(m,out,{inspect:mode==='Inspect'});let result;
  try{
    await writeOnce(out+'/approved-manifest.json',m);await io.assertSource();
    if(mode==='Upload'){await readLocalCiV6(m.ci.runId,m.sourceCommit);result=await uploadPackageOnce({manifest:m,approved:f['--approved-sha'],io});}
    else{await writeOnce(K.inspectSlot,{manifestSha256:m.manifestSha256,reference:assertAck(ack),output:out,claimedAt:Date.now(),writesAuthorized:0,retryAllowed:false});result=await io.inspect(ack);}
  }catch(e){result={outcome:'RECOVERY_PACKAGE_STOPPED_NO_WRITE_RETRY',errorName:/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(e?.name)?e.name:'WITHHELD',
    failure:/^RECOVERY_PACKAGE_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD',retryAllowed:false};}
  finally{try{await io.record('result',{...result,counts:io.counts()});}finally{io.close();}}
  console.log(JSON.stringify({...result,output:out}));if(!['RECOVERY_PACKAGE_UPLOADED_REQUIRES_INDEPENDENT_INSPECT','RECOVERY_PACKAGE_FIXED_VERSION_INDEPENDENTLY_VERIFIED'].includes(result.outcome))process.exitCode=1;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'RECOVERY_PACKAGE_ENTRY_STOPPED_NO_RETRY',failure:/^RECOVERY_PACKAGE_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD'}));process.exitCode=1;
});
