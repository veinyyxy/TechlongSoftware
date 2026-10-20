// Only Publish + a fresh exact SHA can reach the three external writer calls.
import {readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fromLoginCredentials} from '@aws-sdk/credential-provider-login';
import {STSClient,GetCallerIdentityCommand} from '@aws-sdk/client-sts';
import {IAMClient,GetRoleCommand,ListRolePoliciesCommand,GetRolePolicyCommand,ListAttachedRolePoliciesCommand,GetPolicyCommand,GetPolicyVersionCommand} from '@aws-sdk/client-iam';
import {CloudFormationClient,DescribeStacksCommand,GetTemplateCommand,ListStackResourcesCommand,CreateChangeSetCommand,DescribeChangeSetCommand,ExecuteChangeSetCommand} from '@aws-sdk/client-cloudformation';
import {git,P} from '../platform-identity-review-v6/publication.mjs';
import {prepareAppPublicationObjectsV6,FROZEN_V6 as F} from '../platform-activation-v6/publication.mjs';
import {platformClosureV6} from '../platform-cloud-v6/closure.mjs';
import {cloudWorkflowsV6} from '../platform-cloud-v6/workflows.mjs';
import {verifyEnvironmentV5} from '../cloud-worker/activation/release-v5.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {U,must,same,validatePublicationSourceV6,makeAppPublicationReviewV6,validateAppPublicationApprovalV6,verifyAppChangeSetV6,reconcilePublicationLayoutV6,publishAppOnceV6} from './plan.mjs';
export const FILES=['ops/platform-publication-v6/plan.mjs','ops/platform-publication-v6/local.mjs','tests/platform-app-publication-v6.test.mjs',
  'ops/platform-activation-v6/publication.mjs','ops/platform-identity-review-v6/publication.mjs','ops/platform-cloud-v6/workflows.mjs',
  'ops/platform-cloud-v6/contract.mjs','ops/platform-cloud-v6/closure.mjs','ops/cloud-worker/activation/plan-v5.mjs','ops/cloud-worker/activation/release-v5.mjs',
  'ops/aws-sandbox/reviews/platform-cloud-v6.verified.json','ops/aws-sandbox/reviews/platform-identity-dispatch-v6.executed.json',
  'ops/aws-sandbox/reviews/platform-activation-v6.executed.json','lib/deployments/execution/hash.ts',
  '.github/workflows/platform-cloud-candidate.yml',U.riskFile];
const hash=v=>createHash('sha256').update(v).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const write=async(f,v)=>{assertEvidenceSafeV5(v);await writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx',flush:true});};
async function absent(f){try{await access(f);must(false,'OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}}
const pins=()=>Promise.all(FILES.map(async file=>({file,sha256:hash((await readFile(P.root+'/'+file,'utf8')).replaceAll('\r\n','\n'))})));
const decode=v=>typeof v==='string'?JSON.parse(decodeURIComponent(v)):v;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function verifyObjects(m){
  const o=m.objects,texts=cloudWorkflowsV6({...F,reusableCommit:o.reusable.commit});
  for(const [v,text] of [[o.reusable,texts.reusable],[o.caller,texts.caller]])must(
    (await git(['rev-list','--parents','-n','1',v.commit])).trim()===v.commit+' '+v.parent&&
    (await git(['rev-parse',v.commit+'^{tree}'])).trim()===v.tree&&
    (await git(['ls-tree',v.commit,'--',v.file])).trim()==='100644 blob '+v.blob+'\t'+v.file&&
    (await git(['show',v.commit+':'+v.file])).replaceAll('\r\n','\n')===text&&hash(text)===v.normalizedLfSha256,'GIT_OBJECTS');
  must((await git(['diff','--name-status',m.parent,o.reusable.commit])).trim()==='A\t'+U.reusable&&
    (await git(['diff','--name-status',o.reusable.commit,o.caller.commit])).trim()==='A\t'+U.caller,'ONLY_TWO_ADDED_WORKFLOWS');
}
async function createIo(output){
  let token;const counts={push:0,create:0,execute:0,fastForward:0};const record=(n,v)=>write(output+'/'+n+'.json',v);
  const cfg={region:'ca-central-1',maxAttempts:1,ignoreConfiguredEndpointUrls:true,credentials:fromLoginCredentials({profile:'techlong-sandbox-user',ignoreCache:true})};
  const cf=new CloudFormationClient({...cfg,endpoint:'https://cloudformation.ca-central-1.amazonaws.com'}),
    iam=new IAMClient({...cfg,region:'us-east-1',endpoint:'https://iam.amazonaws.com'}),sts=new STSClient({...cfg,endpoint:'https://sts.ca-central-1.amazonaws.com'});
  const send=(c,q)=>c.send(q,{abortSignal:AbortSignal.timeout(30000)});
  async function source(){const r=await send(sts,new GetCallerIdentityCommand({}));must(r.Account==='402010193138'&&r.Arn===U.sourceArn&&r.UserId===U.sourceUserId,'SOURCE');
    return {Account:r.Account,Arn:r.Arn,UserId:r.UserId};}
  async function get(suffix,allow404=false){
    if(!token){const raw=await git(['credential','fill'],{input:'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n'});
      token=raw.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);must(token&&token.length<20000,'GITHUB_AUTH');}
    const r=await fetch('https://api.github.com/repos/'+P.repository+(suffix?'/'+suffix:''),{redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'Techlong-Reviewed-App-Publication-V6'}});
    if(allow404&&r.status===404)return null;must(r.status===200,'GITHUB_READ');const b=await r.text();must(b.length<2000000,'GITHUB_SIZE');return JSON.parse(b);
  }
  const main=async()=>(await get('branches/main')).commit.sha;
  async function ci(id,parent){
    must(/^[1-9][0-9]{0,15}$/.test(id),'CI_ID');const r=await get('actions/runs/'+id),j=await get('actions/runs/'+id+'/attempts/1/jobs?per_page=100');
    must(String(r.id)===id&&r.head_sha===parent&&r.head_branch==='main'&&r.event==='push'&&r.path==='.github/workflows/platform-cloud-candidate.yml'&&
      r.run_attempt===1&&r.status==='completed'&&r.conclusion==='success'&&r.repository.id===P.repositoryId&&r.repository.owner.id===P.ownerId&&
      j.total_count===1&&j.jobs?.length===1&&j.jobs[0].head_sha===parent&&j.jobs[0].run_attempt===1&&String(j.jobs[0].run_id)===id&&
      j.jobs[0].status==='completed'&&j.jobs[0].conclusion==='success'&&j.jobs[0].steps.every(s=>s.status==='completed'&&s.conclusion==='success')&&
      j.jobs[0].steps.some(s=>s.name==='Exact SQL and actual publisher queries on disposable PostgreSQL'),'EXACT_CI');
    return {runId:id,jobId:String(j.jobs[0].id),sourceCommit:parent,attempt:1,status:'completed',conclusion:'success'};
  }
  async function layout(){
    const who=await source(),[st,t,rs,rr,lp,attached,repo,e,branches,oidc,runs,head]=await Promise.all([
      send(cf,new DescribeStacksCommand({StackName:F.stackId})),send(cf,new GetTemplateCommand({StackName:F.stackId,TemplateStage:'Original'})),
      send(cf,new ListStackResourcesCommand({StackName:F.stackId})),send(iam,new GetRoleCommand({RoleName:U.roleName})),
      send(iam,new ListRolePoliciesCommand({RoleName:U.roleName})),send(iam,new ListAttachedRolePoliciesCommand({RoleName:U.roleName})),get(''),
      get('environments/techlong-sandbox-deploy'),get('environments/techlong-sandbox-deploy/deployment-branch-policies?per_page=100'),
      get('actions/oidc/customization/sub'),get('actions/workflows/cloud-worker-execute.yml/runs?per_page=100'),main()]);
    must(repo.id===P.repositoryId&&repo.owner.id===P.ownerId&&repo.full_name===P.repository&&repo.default_branch==='main'&&
      st.Stacks?.length===1&&st.Stacks[0].StackId===F.stackId&&!rs.NextToken&&!lp.IsTruncated&&!attached.IsTruncated&&
      same(lp.PolicyNames,['ExactSandboxWorkerV5'])&&attached.AttachedPolicies?.length===0&&runs.total_count<100&&
      runs.workflow_runs?.length===runs.total_count&&runs.workflow_runs.every(x=>x.status==='completed'),'LAYOUT_INVENTORY');
    const role=rr.Role,arn=role.PermissionsBoundary?.PermissionsBoundaryArn;
    must(role.RoleId==='AROAV3GNMXTZK5O45RG24'&&role.Arn==='arn:aws:iam::402010193138:role/'+U.roleName&&
      /^arn:aws:iam::402010193138:policy\/[A-Za-z0-9/_+=,.@-]+$/.test(arn),'ROLE_BOUNDARY');
    const pol=(await send(iam,new GetPolicyCommand({PolicyArn:arn}))).Policy;
    must(pol.Arn===arn&&/^v[1-9][0-9]*$/.test(pol.DefaultVersionId),'BOUNDARY_ID');
    const [pv,inline]=await Promise.all([send(iam,new GetPolicyVersionCommand({PolicyArn:arn,VersionId:pol.DefaultVersionId})),
      send(iam,new GetRolePolicyCommand({RoleName:U.roleName,PolicyName:'ExactSandboxWorkerV5'}))]);
    must(pv.PolicyVersion?.IsDefaultVersion===true&&inline.RoleName===U.roleName&&inline.PolicyName==='ExactSandboxWorkerV5','POLICY_ACK');
    const template=typeof t.TemplateBody==='string'?JSON.parse(t.TemplateBody):t.TemplateBody;
    return {source:who,main:head,foundation:{stackId:st.Stacks[0].StackId,status:st.Stacks[0].StackStatus,roleArn:st.Stacks[0].RoleARN??null,
      parameters:st.Stacks[0].Parameters??[],template,resources:rs.StackResourceSummaries.map(x=>({logicalId:x.LogicalResourceId,type:x.ResourceType,physicalId:x.PhysicalResourceId})).sort((a,b)=>a.logicalId.localeCompare(b.logicalId))},
      iam:{roleId:role.RoleId,arn:role.Arn,name:role.RoleName,path:role.Path,maxSessionDuration:role.MaxSessionDuration,
        tags:(role.Tags??[]).sort((a,b)=>a.Key.localeCompare(b.Key)),trust:decode(role.AssumeRolePolicyDocument),attached:attached.AttachedPolicies,
        inline:[{name:inline.PolicyName,document:decode(inline.PolicyDocument)}],boundary:{arn,policyId:pol.PolicyId,defaultVersion:pol.DefaultVersionId,
          documentSha256:hash(canonicalJson(decode(pv.PolicyVersion.Document))),document:decode(pv.PolicyVersion.Document)}},
      environment:verifyEnvironmentV5(e,branches),oidc:{use_default:oidc.use_default,use_immutable_subject:oidc.use_immutable_subject,sub_claim_prefix:oidc.sub_claim_prefix},
      unfinishedDeploymentRuns:0,oldDeploymentRunIds:runs.workflow_runs.map(x=>String(x.id)).sort()};
  }
  async function assertLocal(m){
    must((await git(['branch','--show-current'])).trim()==='main'&&(await git(['rev-parse','HEAD'])).trim()===m.parent&&
      (await git(['status','--porcelain'])).trim()===''&&(await git(['remote','get-url','--push','--all','github'])).trim()===P.remote&&same(await pins(),m.pins),'LOCAL_SOURCE');
    const c=await platformClosureV6();must(c.pinCount===81&&c.closureSha256===F.closureSha256,'FROZEN_CLOSURE');await verifyObjects(m);
  }
  async function readChangeSet(m,ref){
    must(ref.stackId===F.stackId,'CHANGE_SET_STACK');
    const d=await send(cf,new DescribeChangeSetCommand({StackName:F.stackId,ChangeSetName:ref.id}));
    if(d.Status!=='CREATE_COMPLETE')return {d};
    const t=await send(cf,new GetTemplateCommand({StackName:F.stackId,ChangeSetName:ref.id,TemplateStage:'Original'}));
    const template=typeof t.TemplateBody==='string'?JSON.parse(t.TemplateBody):t.TemplateBody;
    return {d,proof:verifyAppChangeSetV6(d,m,ref.id,template)};
  }
  return {record,ci,layout,assertLocal,
    async preflight(parent){must(await main()===parent,'REMOTE_PARENT');
      for(const f of [U.caller,U.reusable])must(await get('contents/'+f+'?ref='+parent,true)===null&&await get('actions/workflows/'+path.basename(f),true)===null,'TARGET_EXISTS');
      const p=await layout();validatePublicationSourceV6(p);return p;},
    consume:v=>write(U.slot,v),
    async push(m,guard){must(counts.push++===0&&await main()===m.parent,'PUSH_ONCE');await source();await guard();
      await git(['-c','push.followTags=false','-c','remote.github.mirror=false','push','--porcelain','github',m.actions.push.refspec]);},
    async verifyWorkflows(m){must(await main()===m.objects.caller.commit,'PUBLISHED_MAIN');const proof=[];
      for(const o of [m.objects.reusable,m.objects.caller]){const c=await get('contents/'+o.file+'?ref='+o.commit),w=await get('actions/workflows/'+path.basename(o.file));
        must(c.type==='file'&&c.sha===o.blob&&c.encoding==='base64'&&hash(Buffer.from(c.content,'base64'))===o.normalizedLfSha256&&
          Number.isSafeInteger(w.id)&&w.id>0&&w.path===o.file&&w.state==='active','PUBLISHED_WORKFLOW');proof.push({path:w.path,id:String(w.id),blob:c.sha});}
      return proof;},
    async create(m,guard){must(counts.create++===0&&await main()===m.objects.caller.commit,'CREATE_ONCE');await source();await guard();
      const r=await send(cf,new CreateChangeSetCommand(m.actions.create));
      must(r.StackId===F.stackId&&typeof r.Id==='string'&&r.Id.startsWith('arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+m.actions.create.ChangeSetName+'/'),'CREATE_ACK');
      return {id:r.Id,stackId:r.StackId};},
    async waitChangeSet(m,ref,guard){for(let i=0;i<20;i++){await guard();const x=await readChangeSet(m,ref);if(x.proof){await record('change-set-verified',x.proof);return x.proof;}
      must(['CREATE_PENDING','CREATE_IN_PROGRESS'].includes(x.d.Status),'CHANGE_SET_STOPPED');await pause(1500);}throw Error('APP_PUBLICATION_CHANGE_SET_PENDING_INSPECT_ONLY');},
    async execute(m,ref,guard){const x=await readChangeSet(m,ref);must(x.proof&&counts.execute++===0&&await main()===m.objects.caller.commit,'EXECUTE_ONCE');await source();await guard();
      await send(cf,new ExecuteChangeSetCommand({...m.actions.execute,ChangeSetName:ref.id}));},
    async waitFoundation(guard){for(let i=0;i<40;i++){await guard();const r=await send(cf,new DescribeStacksCommand({StackName:F.stackId}));
      must(r.Stacks?.length===1&&r.Stacks[0].StackId===F.stackId,'STACK_ID');const s=r.Stacks[0].StackStatus;if(s==='UPDATE_COMPLETE')return;
      must(['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'].includes(s),'STACK_STOPPED');await pause(2500);}throw Error('APP_PUBLICATION_STACK_PENDING_INSPECT_ONLY');},
    async fastForward(m,guard){await assertLocal(m);must(counts.fastForward++===0&&await main()===m.objects.caller.commit,'FAST_FORWARD_ONCE');await guard();
      await git(['merge','--ff-only',m.objects.caller.commit]);},
    async inspect(m){await verifyObjects(m);const p=await layout();await record('independent-layout',p);
      const state=same(p.foundation.template,JSON.parse(m.actions.create.TemplateBody))?'new':same(p.foundation.template,m.prestate.foundation.template)?'old':'unknown';
      let matched=false;try{if(p.main===m.objects.caller.commit&&state!=='unknown'){reconcilePublicationLayoutV6(p,m,state);matched=true;}}catch{/* Facts retained, no repair. */}
      const full=matched&&state==='new',workflows=p.main===m.objects.caller.commit?await this.verifyWorkflows(m):null;
      return {outcome:full?'APP_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH':'APP_PUBLICATION_PARTIAL_OR_DRIFT_INSPECT_ONLY_NO_RETRY',
        templateState:state,remainingLayoutMatched:matched,remoteMain:p.main,localHead:(await git(['rev-parse','HEAD'])).trim(),workflows,
        runtimeEnabled:false,workflowDispatched:false,externalWrites:0,secretValueReads:0,retryAllowed:false};},
    counts:()=>({...counts}),dispose(){token=undefined;cf.destroy();iam.destroy();sts.destroy();},
  };
}
async function directory(s,existing=false){const p=path.resolve(s);must(path.dirname(p).toLowerCase()===path.resolve(P.base).toLowerCase()&&
  /^techlong-w6i-app-publication-[a-z0-9-]+$/.test(path.basename(p))&&(await realpath(P.base)).toLowerCase()===path.resolve(P.base).toLowerCase(),'DIRECTORY');
  if(existing)must((await realpath(p)).toLowerCase()===p.toLowerCase(),'REALPATH');return p;}
export async function main(args=process.argv.slice(2)){
  const a={};must(args.length%2===0,'ARGS');for(let i=0;i<args.length;i+=2){must(!Object.hasOwn(a,args[i]),'DUPLICATE_ARG');a[args[i]]=args[i+1];}
  const mode=a['--mode'],keys=['--mode','--output',...(mode==='Prepare'?['--ci-run']:mode==='Publish'?['--manifest','--approved-sha']:mode==='Inspect'?['--manifest']:[])];
  must(['Prepare','Publish','Inspect'].includes(mode)&&Object.keys(a).length===keys.length&&keys.every(k=>a[k]),'MODE');
  must(!['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','AWS_CA_BUNDLE','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE'].some(k=>process.env[k])&&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!Object.keys(process.env).some(k=>/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|COMMON_DIR)$/.test(k)),'ENVIRONMENT');
  const output=await directory(a['--output']);let m;
  if(mode!=='Prepare'){const file=path.resolve(a['--manifest']);await directory(path.dirname(file),true);must(path.basename(file)==='manifest.json','MANIFEST_PATH');
    m=await json(file);await validateAppPublicationApprovalV6(m,a['--approved-sha'],Date.now(),mode==='Inspect');}
  if(mode!=='Inspect')await absent(U.slot);await mkdir(output);const io=await createIo(output);
  try{let result;
    if(mode==='Prepare'){
      const parent=(await git(['rev-parse','HEAD'])).trim();must((await git(['status','--porcelain'])).trim()==='','CLEAN_MAIN');
      const ci=await io.ci(a['--ci-run'],parent),prestate=await io.preflight(parent);
      const proof=await json(P.root+'/ops/aws-sandbox/reviews/platform-activation-v6.executed.json');
      must(proof.state==='CREDENTIAL_INSTALLED_AND_INDEPENDENTLY_VERIFIED_RUNTIME_UNPUBLISHED'&&proof.execution.independentFixedSecretValueReads===1,'CREDENTIAL_INSTALLED');
      const material=await prepareAppPublicationObjectsV6({parent,output,template:prestate.foundation.template});
      m=await makeAppPublicationReviewV6({parent,objects:{reusable:material.reusable,caller:material.caller},pins:await pins(),ci,prestate,createdAt:Date.now()});
      await io.assertLocal(m);await io.record('manifest',m);await io.record('prestate',prestate);
      result={outcome:'APP_PUBLICATION_REVIEW_PREPARED_NOT_EXECUTED',manifestSha256:m.manifestSha256,parent,reusable:m.objects.reusable.commit,caller:m.objects.caller.commit,
        expiresAtUtc:new Date(m.expiresAt).toISOString(),expiresAtWinnipeg:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',dateStyle:'full',timeStyle:'long'}).format(m.expiresAt),
        externalWrites:0,slotConsumed:false,secretValueReads:0,workflowDispatched:false};
    }else if(mode==='Publish'){
      await io.ci(m.ci.runId,m.parent);await io.record('approved-manifest',m);result=await publishAppOnceV6({manifest:m,approved:a['--approved-sha'],io});
      if(result.outcome.includes('PARTIAL'))process.exitCode=1;
    }else{const slot=await json(U.slot);must(slot.manifestSha256===m.manifestSha256&&slot.caller===m.objects.caller.commit&&slot.parent===m.parent,'INSPECT_SLOT');result=await io.inspect(m);}
    await io.record('result',{...result,manifestSha256:m.manifestSha256,counts:io.counts()});console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{io.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
  console.error(JSON.stringify({outcome:'APP_PUBLICATION_STOPPED_NO_WRITE_RETRY',failure:/^APP_PUBLICATION_[A-Z_]+$/.test(e?.message)?e.message:'DETAILS_WITHHELD',
    errorName:/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(e?.name)?e.name:'WITHHELD'}));process.exitCode=1;
});
