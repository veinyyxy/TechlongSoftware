// PrepareSaved uses sealed metadata and exact CI only. No remote activation.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {git,P} from '../platform-identity-review-v6/publication.mjs';
import {createBindingPublicationIo} from '../platform-binding-v6/local.mjs';
import {publishBindingOnceV6} from '../platform-binding-v6/plan.mjs';
import {createAppPublicationIo} from '../platform-publication-v6/local.mjs';
import {U} from '../platform-publication-v6/plan.mjs';
import {R} from '../platform-recovery-publication-v1/plan.mjs';
import {noLinks,jsonFile,absent,newDirectory,writeOnce,cleanSource,assertEnvironment} from '../platform-operator-v6/files.mjs';
import {pins as collectPins} from '../platform-image-source-v2/files.mjs';
import {readLocalCiV6} from '../platform-local-v6/local.mjs';
import {recoveryCloudClosure} from '../platform-recovery-cloud-v1/closure.mjs';
import {recoveryCloudWorkflows} from '../platform-recovery-cloud-v1/workflows.mjs';
import {M,must,same,hash,renderRecoveryBinding,makeRecoveryBindingReview,verifyRecoveryBindingApproval,validateBindingLive} from './plan.mjs';
export const ROOTS=['ops/platform-recovery-binding-v1/local.mjs','tests/platform-recovery-binding-v1.test.mjs',
  'tests/fixtures/platform-recovery-binding-v1.source.txt','tests/platform-recovery-control-v1.test.mjs',M.riskFile,M.runtimeRiskFile,
  'ops/aws-sandbox/reviews/platform-recovery-publication-v1.executed.json','ops/aws-sandbox/reviews/platform-recovery-package-v1.executed.json',
  M.target,'package.json','package-lock.json','ops/cloud-worker/package.json','ops/cloud-worker/package-lock.json','.github/workflows/platform-cloud-candidate.yml'];
export const bindingPins=()=>collectPins({roots:ROOTS});
const lf=v=>v.replaceAll('\r\n','\n');
function environment(){assertEnvironment();must(!['AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','AWS_CA_BUNDLE'].some(k=>process.env[k]),'ENVIRONMENT');}
async function pinnedJson(file,sha){const s=await noLinks(file);must(s.isFile()&&s.size<1000000,'ARCHIVE_FILE');const b=await readFile(file);must(hash(b)===sha,'ARCHIVE_CHANGED');return JSON.parse(b);}
export async function loadBindingEvidence(){
  const p=await pinnedJson(M.publicationProof,M.publicationProofSha256),k=await pinnedJson(M.packageProof,M.packageProofSha256),
    baseline=await pinnedJson(M.layoutFile,M.layoutRawSha256);
  must(p.outcome==='WORKFLOW_TRUST_PUBLICATION_AND_INDEPENDENT_INSPECT_COMPLETE_NO_BUSINESS_DISPATCH'&&p.publishedReusableCommit===M.reusableCommit&&
    p.independentInspection.outcome==='APP_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH'&&p.artifacts.some(a=>a.file===M.layoutFile&&a.rawSha256===M.layoutRawSha256)&&
    k.outcome==='RECOVERY_PACKAGE_UPLOADED_AND_FIXED_VERSION_INDEPENDENTLY_VERIFIED'&&k.independentInspection.outcome==='RECOVERY_PACKAGE_FIXED_VERSION_INDEPENDENTLY_VERIFIED'&&
    same(k.reference,M.packageReference)&&k.basisSha256===M.basisSha256&&k.basisExpiresAt===M.basisExpiresAt,'VERIFIED_PARENTS');return baseline;
}
export async function verifyBindingObject(m){
  const o=m.object,before=lf(await git(['show',m.parent+':'+M.target])),text=await renderRecoveryBinding(before,m.parent);
  must(hash(text)===o.sha256&&(await git(['rev-list','--parents','-n','1',o.commit])).trim()===o.commit+' '+m.parent&&
    (await git(['rev-parse',o.commit+'^{tree}'])).trim()===o.tree&&
    (await git(['ls-tree',o.commit,'--',M.target])).trim()==='100644 blob '+o.blob+'\t'+M.target&&
    lf(await git(['show',o.commit+':'+M.target]))===text&&(await git(['diff','--name-status',m.parent,o.commit])).trim()==='M\t'+M.target,'EXACT_OBJECT');
}
async function prepareObject(parent,out){
  await cleanSource(parent);const refs=(await git(['show-ref'])).trim(),text=await renderRecoveryBinding(lf(await readFile(P.root+'/'+M.target,'utf8')),parent);
  const env={GIT_INDEX_FILE:out+'/binding.index',GIT_AUTHOR_DATE:new Date().toISOString(),GIT_COMMITTER_DATE:new Date().toISOString()};
  await absent(env.GIT_INDEX_FILE);await git(['read-tree',parent],{env});const blob=(await git(['hash-object','-w','--stdin'],{input:text})).trim();
  await git(['update-index','--cacheinfo','100644,'+blob+','+M.target],{env});const tree=(await git(['write-tree'],{env})).trim();
  const commit=(await git(['commit-tree',tree,'-p',parent],{env,input:'feat(deployments): prepared reviewed recovery binding (not published)\n'})).trim();
  const object={file:M.target,parent,commit,tree,blob,sha256:hash(text)};await verifyBindingObject({parent,object});
  await cleanSource(parent);must((await git(['show-ref'])).trim()===refs,'REFS_CHANGED');await writeFile(out+'/binding.candidate.mjs',text,{flag:'wx',flush:true});return object;
}
export async function createRecoveryBindingIo(m,out,{readOnly=false}={}){
  // This metadata reader denies every writer, even though the old adapter exposes them.
  const metadata=await createAppPublicationIo(out,{profile:{scope:U,frozen:R,readOnly:true,awsMetadataMax:40,githubGetsMax:50}});
  async function state(get,parent,bindingSha256){
    const layout=await metadata.layout(),texts=recoveryCloudWorkflows({...m.binding.release,sourceCommit:M.runtimeSource}),workflows=[];
    for(const [file,id,ref,text] of [['cloud-worker-platform-job-v6.yml','390829324',M.reusableCommit,texts.reusable],['cloud-worker-platform-v6.yml','390829326',parent,texts.caller]]){
      const w=await get('actions/workflows/'+file),c=await get('contents/.github/workflows/'+file+'?ref='+ref);
      must(String(w.id)===id&&w.state==='active'&&w.path==='.github/workflows/'+file&&c.type==='file'&&c.encoding==='base64'&&
        hash(Buffer.from(c.content,'base64').toString('utf8'))===hash(text),'LIVE_WORKFLOW');workflows.push({id,path:w.path,sha256:hash(text)});
    }return {layout,workflows,bindingSha256};
  }
  const profile={scope:{target:M.target,slot:M.slot},readOnly,pins:bindingPins,verifyObjects:verifyBindingObject,
    verifyApproval:verifyRecoveryBindingApproval,validatePreflight:validateBindingLive,
    async preflight({get,parent}){const c=await get('contents/'+M.target+'?ref='+parent);must(c.type==='file'&&c.encoding==='base64'&&
      hash(Buffer.from(c.content,'base64').toString('utf8'))===M.beforeSha256,'LIVE_CANDIDATE');return state(get,parent,M.beforeSha256);},
    async verifyRemote({get,bindingSha256}){const p=await state(get,m.object.commit,bindingSha256);validateBindingLive(p,m,{published:true});
      return {remainingPublishedLayoutMatched:true,metadataStateSha256:hash(p),liveRoleId:p.layout.iam.roleId};},
    dispose:()=>metadata.dispose()};
  const io=await createBindingPublicationIo(out,{profile});return {io,profile,counts:()=>({publication:io.counts(),metadata:metadata.counts()})};
}
export function parseBindingArgs(args){
  const f={};must(args.length%2===0,'ARGUMENTS');for(let n=0;n<args.length;n+=2){must(!Object.hasOwn(f,args[n])&&args[n+1]&&!args[n+1].startsWith('--'),'ARGUMENTS');f[args[n]]=args[n+1];}
  const mode=f['--mode'],keys=['--mode','--output',...(mode==='PrepareSaved'?['--ci-run']:mode==='Publish'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['PrepareSaved','Publish','Inspect'].includes(mode)&&Object.keys(f).length===keys.length&&keys.every(k=>f[k]),'ARGUMENTS');
  for(const p of [f['--output'],...(f['--manifest']?[path.dirname(f['--manifest'])]:[])])must(/^F:\/ChatGPT_workshop\/techlong-w9m-recovery-binding-[a-z0-9-]+$/.test(path.resolve(p).replaceAll('\\','/')),'DIRECTORY');
  if(f['--manifest'])must(path.basename(f['--manifest'])==='manifest.json','MANIFEST_NAME');return f;
}
export async function main(args=process.argv.slice(2)){
  const f=parseBindingArgs(args);environment();const mode=f['--mode'],out=path.resolve(f['--output']).replaceAll('\\','/'),baseline=await loadBindingEvidence();let m;
  if(mode!=='PrepareSaved'){m=await jsonFile(f['--manifest'],300000);await verifyRecoveryBindingApproval(m,f['--approved-sha'],Date.now(),mode==='Inspect');must(same(m.baseline,baseline),'BASELINE_CHANGED');}
  if(mode==='Inspect'){
    await absent(M.inspectSlot);const s=await jsonFile(M.slot,10000);must(s.manifestSha256===m.manifestSha256&&s.parent===m.parent&&s.commit===m.object.commit,'INSPECT_SLOT');
    must(/^F:\/ChatGPT_workshop\/techlong-w9m-recovery-binding-[a-z0-9-]+$/.test(s.output),'WRITER_DIRECTORY');
    const pre=await jsonFile(s.output+'/execution-preflight.json',1000000);must(hash(pre)===s.preflightSha256,'PREFLIGHT_HASH');validateBindingLive(pre,m);
    const head=await cleanSource();must([m.parent,m.object.commit].includes(head)&&hash(lf(await readFile(P.root+'/'+M.target,'utf8')))===
      (head===m.parent?M.beforeSha256:m.object.sha256),'INSPECT_LOCAL_STATE');
    const current=await bindingPins();must(same(current.filter(p=>p.file!==M.target),m.pins.filter(p=>p.file!==M.target)),'INSPECT_SOURCE_PINS');
  }
  else await absent(M.slot);
  await newDirectory(P.base,path.basename(out));
  if(mode==='PrepareSaved'){
    const parent=await cleanSource(),ci=await readLocalCiV6(f['--ci-run'],parent),closure=await recoveryCloudClosure();
    must(closure.pinCount===97&&closure.closureSha256===M.closureSha256&&hash(lf(await readFile(P.root+'/'+M.runtimeRiskFile,'utf8')))===M.runtimeRiskSha256,'CLOUD_OR_RISK_DRIFT');
    const object=await prepareObject(parent,out);m=await makeRecoveryBindingReview({parent,object,ci,baseline,pins:await bindingPins(),createdAt:Date.now()});
    await cleanSource(parent);await writeOnce(out+'/manifest.json',m);const result={outcome:'RECOVERY_BINDING_REVIEW_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,
      parent,proposedCommit:object.commit,expiresAt:m.expiresAt,latestStartAt:m.expiresAt-300000,awsCalls:0,branchesCreated:0,mainMoved:false,slotConsumed:false,published:false};
    await writeOnce(out+'/result.json',result);console.log(JSON.stringify({...result,output:out}));return result;
  }
  const h=await createRecoveryBindingIo(m,out,{readOnly:mode==='Inspect'});let result;
  try{await writeOnce(out+'/approved-manifest.json',m);
    if(mode==='Publish'){await h.io.ci(m.ci.runId,m.parent);result=await publishBindingOnceV6({manifest:m,approved:f['--approved-sha'],io:h.io,profile:h.profile});}
    else{await writeOnce(M.inspectSlot,{manifestSha256:m.manifestSha256,output:out,claimedAt:Date.now(),externalWrites:0,retryAllowed:false});result=await h.io.inspect(m);}
  }catch(e){result={outcome:'RECOVERY_BINDING_STOPPED_NO_RETRY',failure:/^(?:RECOVERY_BINDING|BINDING_PUBLICATION|APP_PUBLICATION)_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD',
    errorName:/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(e?.name)?e.name:'WITHHELD',retryAllowed:false};}
  finally{try{await h.io.record('result',{...result,counts:h.counts()});}finally{h.io.dispose();}}
  console.log(JSON.stringify({...result,output:out}));if(!['BINDING_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT','BINDING_PUBLICATION_INDEPENDENTLY_VERIFIED_RUNTIME_NOT_STARTED'].includes(result.outcome))process.exitCode=1;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'RECOVERY_BINDING_ENTRY_STOPPED_NO_RETRY',failure:/^RECOVERY_BINDING_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD'}));process.exitCode=1;
});
