// PrepareSaved is local-only except exact No-AWS CI verification. No live fallback.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {P,git} from '../platform-identity-review-v6/publication.mjs';
import {FILES,createAppPublicationIo} from '../platform-publication-v6/local.mjs';
import {must,same,publishAppOnceV6,validatePublicationSourceV6} from '../platform-publication-v6/plan.mjs';
import {recoveryCloudClosure} from '../platform-recovery-cloud-v1/closure.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {R,Q,hash,makeRecoveryPublicationReview,validateRecoveryApproval,validateRecoveryPreflight,reconcileRecoveryLayout} from './plan.mjs';
import {loadSavedBaseline} from './saved.mjs';
import {prepareRecoveryObjects,verifyRecoveryObjects} from './objects.mjs';
export const PIN_FILES=[...FILES,'ops/platform-recovery-publication-v1/plan.mjs','ops/platform-recovery-publication-v1/local.mjs',
  'ops/platform-recovery-publication-v1/saved.mjs','ops/platform-recovery-publication-v1/objects.mjs',
  'ops/platform-recovery-cloud-v1/workflows.mjs','ops/platform-recovery-cloud-v1/closure.mjs',
  'tests/platform-recovery-publication-v1.test.mjs','tests/fixtures/platform-recovery-publication-v1.json',Q.riskFile];
export const recoveryPublicationPins=()=>Promise.all(PIN_FILES.map(async file=>({file,sha256:hash((await readFile(P.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
export function recoveryPublicationProfile(m,{readOnly=false,executionPrestate}={}){
  return {scope:Q,frozen:R,readOnly,executionPrestate,closure:recoveryCloudClosure,closureCount:97,
    pins:recoveryPublicationPins,verifyObjects:verifyRecoveryObjects,validateSource:validatePublicationSourceV6,
    validateApproval:validateRecoveryApproval,validatePreflight:validateRecoveryPreflight,reconcile:reconcileRecoveryLayout,
    awsMetadataMax:Q.awsMetadataMax,githubGetsMax:Q.githubGetsMax,
    workflowId:file=>m.baseline.workflowIds[file===Q.caller?'caller':'reusable'],
    async verifyExistingTargets(get,parent){
      must(parent===m.parent,'RECOVERY_TARGET_PARENT');
      for(const o of m.previousTargets){const c=await get('contents/'+o.file+'?ref='+parent),w=await get('actions/workflows/'+path.basename(o.file));
        must(c.type==='file'&&c.sha===o.blob&&c.encoding==='base64'&&hash(Buffer.from(c.content,'base64').toString('utf8'))===o.normalizedLfSha256&&
          w.path===o.file&&w.state==='active'&&String(w.id)===m.baseline.workflowIds[o.file===Q.caller?'caller':'reusable'],'RECOVERY_EXISTING_WORKFLOW');
      }
    }};
}
export function parsePublicationArgs(args){
  const a={};must(args.length%2===0,'RECOVERY_ARGS');
  for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'RECOVERY_ARGS');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='PrepareSaved'?['--ci-run']:mode==='Publish'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['PrepareSaved','Publish','Inspect'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'RECOVERY_MODE');return a;
}
export function assertPublicationEnvironment(){
  must(!['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','AWS_CA_BUNDLE','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE'].some(k=>process.env[k])&&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!Object.keys(process.env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'RECOVERY_ENVIRONMENT');
}
const json=async f=>{const b=await readFile(f);must(b.length<1000000,'RECOVERY_FILE_SIZE');return JSON.parse(b);};
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});};
async function absent(f){try{await access(f);must(false,'RECOVERY_SLOT_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function directory(s,existing=false){
  const p=path.resolve(s);must(path.dirname(p).toLowerCase()===path.resolve(P.base).toLowerCase()&&
    /^techlong-w9k-recovery-publication-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(P.base)).toLowerCase()===path.resolve(P.base).toLowerCase(),'RECOVERY_DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'RECOVERY_REALPATH');return p;
}
export async function main(args=process.argv.slice(2)){
  const a=parsePublicationArgs(args);assertPublicationEnvironment();const mode=a['--mode'],output=await directory(a['--output']);
  let m,slot,prestate;
  if(mode!=='PrepareSaved'){
    const f=path.resolve(a['--manifest']);await directory(path.dirname(f),true);must(path.basename(f)==='manifest.json','RECOVERY_MANIFEST_PATH');
    m=await json(f);await validateRecoveryApproval(m,a['--approved-sha'],Date.now(),mode==='Inspect');
    must(same(await recoveryPublicationPins(),m.pins),'RECOVERY_CURRENT_PINS');
  }
  if(mode==='Publish')await absent(Q.slot);
  if(mode==='Inspect'){
    await absent(Q.inspectSlot);slot=await json(Q.slot);must(slot.manifestSha256===m.manifestSha256&&slot.parent===m.parent&&
      slot.caller===m.objects.caller.commit&&slot.retryAllowed===false,'RECOVERY_INSPECT_SLOT');
    const prior=await directory(slot.output,true);prestate=await json(prior+'/execution-preflight.json');
    must(hash(prestate)===slot.preflightSha256,'RECOVERY_PREFLIGHT_HASH');validateRecoveryPreflight(prestate,m);
  }
  await mkdir(output);
  if(mode==='PrepareSaved'){
    await absent(Q.slot);const parent=(await git(['rev-parse','HEAD'])).trim(),baseline=await loadSavedBaseline();
    must((await git(['status','--porcelain'])).trim()===''&&(await git(['branch','--show-current'])).trim()==='main','RECOVERY_CLEAN_SOURCE');
    const closure=await recoveryCloudClosure();must(closure.pinCount===97&&closure.closureSha256===R.closureSha256&&
      (await git(['diff','--name-only',R.sourceCommit,parent,'--',...closure.pins.map(x=>x.file)])).trim()==='','RECOVERY_FROZEN_RUNTIME');
    // A read-only profile prevents every writer, even if this branch is changed accidentally.
    const io=await createAppPublicationIo(output,{profile:recoveryPublicationProfile({baseline},{readOnly:true})});
    try{
      const ci=await io.ci(a['--ci-run'],parent),material=await prepareRecoveryObjects({parent,output});
      m=await makeRecoveryPublicationReview({parent,...material,pins:await recoveryPublicationPins(),ci,baseline,createdAt:Date.now()});
      await io.assertLocal(m);await write(output+'/manifest.json',m);await write(output+'/material.json',material);
      await write(output+'/proposed-template.json',JSON.parse(m.actions.create.TemplateBody));
      const result={outcome:'RECOVERY_PUBLICATION_REVIEW_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,parent,
        reusable:m.objects.reusable.commit,caller:m.objects.caller.commit,expiresAtUtc:new Date(m.expiresAt).toISOString(),
        expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
        externalWrites:0,awsCalls:0,privateContentReads:0,slotsConsumed:0,workflowDispatched:false,counts:io.counts()};
      await write(output+'/result.json',result);console.log(JSON.stringify({...result,output},null,2));return result;
    }finally{io.dispose();}
  }
  const profile=recoveryPublicationProfile(m,{readOnly:mode==='Inspect',executionPrestate:prestate}),io=await createAppPublicationIo(output,{profile});
  try{let result;
    await write(output+'/approved-manifest.json',m);
    if(mode==='Publish'){
      await io.ci(m.ci.runId,m.parent);result=await publishAppOnceV6({manifest:m,approved:a['--approved-sha'],io,profile});
    }else{
      await write(Q.inspectSlot,{manifestSha256:m.manifestSha256,preflightSha256:slot.preflightSha256,output,consumedAt:Date.now(),writesAuthorized:0,retryAllowed:false});
      result=await io.inspect(m);
    }
    await write(output+'/result.json',{...result,manifestSha256:m.manifestSha256,counts:io.counts()});
    console.log(JSON.stringify({...result,output},null,2));if(result.outcome.includes('PARTIAL'))process.exitCode=1;return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'RECOVERY_PUBLICATION_STOPPED_NO_WRITE_RETRY',failure:/^APP_PUBLICATION_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD'}));process.exitCode=1;
});
