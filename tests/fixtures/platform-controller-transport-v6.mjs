// No private files/bindings. All HTTP is routed to this module's synthetic fetch.
import {neonConfig} from '@neondatabase/serverless';
import {createNeonControlLedger} from '../../lib/deployments/controller-v6/ledger.ts';
import {createGitHubController} from '../../lib/deployments/controller-v6/github.ts';
import {assertControllerNeonTransportV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {CONTROL_SCOPE as S} from '../../lib/deployments/controller-v6/contract.ts';
import {TEST_NOW,TEST_RELEASE,controlPlanFixture} from './platform-controller-v6.ts';

const fixture='postgresql://techlong_deployment_controller_v6:synthetic-only@ep-fixture.ca-central-1.aws.neon.tech/neondb?sslmode=verify-full';
const redirects=[301,302,303,307,308];
const must=(v,code)=>{if(!v)throw Error(code);};
const jsonSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function rejects(fn,code){let failed=false;try{await fn();}catch(e){failed=e.message===code;}must(failed,'EXPECTED_'+code);}

async function synthetic(request){
  const u=new URL(request.url),headers=request.headers;
  if(headers.get('x-fixture-stage')===u.pathname)return new Response(null,{status:Number(headers.get('x-fixture-status')),
    headers:{location:'https://must-not-follow.invalid/private'}});
  if(u.hostname==='api.ca-central-1.aws.neon.tech'&&u.pathname==='/sql'){
    must(request.method==='POST'&&headers.get('Neon-Connection-String')===fixture,'SYNTHETIC_SQL_SCOPE');
    const q=await request.json();must(q.query==='SELECT deployment_control_v6.status() AS value'&&jsonSame(q.params,[]),'SYNTHETIC_SQL_SHAPE');
    return Response.json({command:'SELECT',rowCount:1,fields:[{name:'value',dataTypeID:3802}],rows:[['[]']]});
  }
  must(u.origin==='https://api.github.com','SYNTHETIC_GITHUB_SCOPE');
  const permissions={actions:'write',contents:'read',metadata:'read'},account={id:Number(S.ownerId),login:'veinyyxy',type:'User'};
  if(u.pathname==='/app')return Response.json({id:Number(S.appId),slug:'techlong-sandbox-controller',permissions,events:[],owner:account,
    html_url:'https://github.com/apps/techlong-sandbox-controller',external_url:'https://github.com/'+S.repository,name:'Techlong Sandbox Controller'});
  if(u.pathname===`/app/installations/${S.installationId}`)return Response.json({id:Number(S.installationId),app_id:Number(S.appId),
    app_slug:'techlong-sandbox-controller',account,target_id:Number(S.ownerId),target_type:'User',permissions,events:[],repository_selection:'selected',suspended_at:null});
  if(u.pathname.endsWith('/access_tokens')){must(request.method==='POST','SYNTHETIC_TOKEN_METHOD');const body=await request.json();
    must(jsonSame(body.repository_ids,[Number(S.repositoryId)]),'SYNTHETIC_TOKEN_REPO');
    return Response.json({token:'synthetic-not-a-github-token',permissions:body.permissions,expires_at:new Date(TEST_NOW+3600000).toISOString()},{status:201});}
  if(u.pathname==='/installation/token'){must(request.method==='DELETE','SYNTHETIC_REVOKE_METHOD');return new Response(null,{status:204});}
  if(u.pathname==='/installation/repositories')return Response.json({total_count:1,repositories:[{id:Number(S.repositoryId),full_name:S.repository,owner:account}]});
  if(u.pathname==='/users/techlong-sandbox-controller%5Bbot%5D')return Response.json({id:Number(S.candidateBotId),login:'techlong-sandbox-controller[bot]',type:'Bot'});
  if(u.pathname.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:'f'.repeat(40)}});
  if(u.pathname.endsWith('/actions/workflows/'+S.workflowFile))return Response.json({id:Number(TEST_RELEASE.workflowId),state:'active',path:'.github/workflows/'+S.workflowFile});
  if(u.pathname.endsWith('/dispatches'))return Response.json({workflow_run_id:123,html_url:`https://github.com/${S.repository}/actions/runs/123`,run_url:`https://api.github.com/repos/${S.repository}/actions/runs/123`});
  throw Error('SYNTHETIC_UNEXPECTED_ENDPOINT');
}

async function regression(){
  const native=globalThis.fetch,calls=[],ledger=createNeonControlLedger(()=>fixture);let reply=200;
  assertControllerNeonTransportV6(new URL(fixture).hostname,{fetchFunction:neonConfig.fetchFunction,fetchEndpoint:neonConfig.fetchEndpoint});
  globalThis.fetch=async(input,init)=>{
    must(init.redirect==='manual','LEDGER_MUST_NOT_FOLLOW');calls.push('sql');
    const headers=new Headers(init.headers);if(reply!==200){headers.set('x-fixture-stage','/sql');headers.set('x-fixture-status',String(reply));}
    return native(input,{...init,headers});
  };
  try{
    must(jsonSame(await ledger.status(),[]),'LEDGER_SYNTHETIC_SUCCESS');
    for(reply of redirects){const before=calls.length;await rejects(()=>ledger.status(),'CONTROL_LEDGER_REQUIRES_READBACK');must(calls.length===before+1,'LEDGER_NO_RETRY');}
  }finally{globalThis.fetch=native;}
  let guardRetained=false;try{assertControllerNeonTransportV6(new URL(fixture).hostname,{fetchFunction:()=>{},fetchEndpoint:neonConfig.fetchEndpoint});}catch{guardRetained=true;}
  must(guardRetained,'TRANSPORT_OVERRIDE_GUARD_RETAINED');
  // A throwaway test key exists only in memory; it is not the installed App key.
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const bytes=new Uint8Array(await crypto.subtle.exportKey('pkcs8',keys.privateKey));
  const pem='-----BEGIN PRIVATE KEY-----\n'+btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''))+'\n-----END PRIVATE KEY-----';bytes.fill(0);
  const stages=['/app',`/app/installations/${S.installationId}/access_tokens`,
    `/repos/${S.repository}/actions/workflows/${S.workflowFile}/dispatches`,'/installation/token'];
  let successfulAck=false,githubCases=0;
  for(const stage of [null,...stages])for(const status of stage===null?[200]:redirects){
    const seen=[],client=createGitHubController({release:TEST_RELEASE,privateKey:async()=>pem,now:()=>TEST_NOW,
      fetch:async(input,init)=>{
        must(init.redirect==='manual'&&init.cache==='no-store','GITHUB_TRANSPORT_OPTIONS');
        const path=new URL(String(input)).pathname;seen.push(path);
        const headers=new Headers(init.headers);if(stage){headers.set('x-fixture-stage',stage);headers.set('x-fixture-status',String(status));}
        return native(input,{...init,headers});
      }});
    const plan=await controlPlanFixture();let ack=false;
    const action=()=>client.dispatch(plan,async()=>{},async()=>{ack=true;});
    if(stage){await rejects(action,stage==='/installation/token'?'CONTROL_TOKEN_REVOKE_UNCONFIRMED':'CONTROL_GITHUB_RESPONSE');
      must(seen.filter(p=>p===stage).length===1,'GITHUB_NO_RETRY');
      const returned=!['/app',`/app/installations/${S.installationId}/access_tokens`].includes(stage);
      must(seen.filter(p=>p==='/installation/token').length===(returned?1:0),'GITHUB_ONCE_REVOKE');
      must(ack===(stage==='/installation/token'),'GITHUB_ACK_PRESERVED');
    }else{must((await action()).runId==='123'&&ack,'GITHUB_SYNTHETIC_SUCCESS');successfulAck=true;}
    githubCases++;
  }
  console.log(JSON.stringify({schema:'techlong/platform-controller-transport-regression/v6',ledgerCases:1+redirects.length,
    githubCases,successfulAck,privateReads:0,networkServices:0,sockets:0,realTokens:0,realDispatches:0,
    syntheticBindingOnly:true,transportGuardRetained:guardRetained}));
}
const worker={test:regression,fetch:synthetic};
export default worker;
