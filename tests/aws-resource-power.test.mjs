import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stopResources,resumeResources,validateConfig,listenerInput,ruleInput} from '../ops/aws-resource-power/core.mjs';
import {AwsCli,FileStore,parseArgs,permittedOperations} from '../ops/aws-resource-power/cli.mjs';

// Every AWS response below is synthetic. No production adapter/entry point is executed.
const account='111111111111',prefix=`arn:aws:elasticloadbalancing:ca-central-1:${account}:`,oldArn=prefix+'loadbalancer/app/test-lb/aaaaaaaaaaaaaaaa',newArn=prefix+'loadbalancer/app/test-lb/bbbbbbbbbbbbbbbb',
  oldListener=prefix+'listener/app/test-lb/aaaaaaaaaaaaaaaa/cccccccccccccccc',newListener=prefix+'listener/app/test-lb/bbbbbbbbbbbbbbbb/dddddddddddddddd',
  oldRule=prefix+'listener-rule/app/test-lb/aaaaaaaaaaaaaaaa/cccccccccccccccc/eeeeeeeeeeeeeeee',newRule=prefix+'listener-rule/app/test-lb/bbbbbbbbbbbbbbbb/dddddddddddddddd/ffffffffffffffff',
  target=prefix+'targetgroup/test/gggggggggggggggg',certificate=`arn:aws:acm:ca-central-1:${account}:certificate/one`,extraCertificate=`arn:aws:acm:ca-central-1:${account}:certificate/two`,
  config={accountId:account,region:'ca-central-1',profile:'synthetic-test',rdsClusters:['test-cluster'],rdsInstances:['test-db'],loadBalancerArns:[oldArn],allowDisableDeletionProtection:true,acknowledgeCloudFormationDrift:true};
const copy=value=>structuredClone(value);
function fixture(options={}){
  const calls=[],state={cluster:options.originallyStopped?'stopped':'available',instance:options.originallyStopped?'stopped':'available',deleted:false,created:false,newListeners:[],newRules:[],replacement:false},
    attrs=[{Key:'deletion_protection.enabled',Value:'true'},{Key:'load_balancing.cross_zone.enabled',Value:'true'},{Key:'idle_timeout.timeout_seconds',Value:'60'}],
    listenerAttrs=[{Key:'routing.http.response.server.enabled',Value:'false'}],
    lb={LoadBalancerArn:oldArn,LoadBalancerName:'test-lb',DNSName:'old.example',CanonicalHostedZoneId:'OLDZONE',VpcId:'vpc-test',Type:'application',Scheme:'internet-facing',IpAddressType:'dualstack',SecurityGroups:['sg-test'],AvailabilityZones:[{SubnetId:'subnet-one'},{SubnetId:'subnet-two'}],State:{Code:'active'}},
    defaultActions=[{Type:'fixed-response',FixedResponseConfig:{StatusCode:'404',ContentType:'text/plain',MessageBody:'not found'}}],
    listener={ListenerArn:oldListener,LoadBalancerArn:oldArn,Protocol:'HTTPS',Port:443,SslPolicy:'ELBSecurityPolicy-TLS13-1-2-2021-06',Certificates:[{CertificateArn:certificate}],DefaultActions:defaultActions,
      MutualAuthentication:{Mode:'verify',TrustStoreArn:prefix+'truststore/test/1234',IgnoreClientCertificateExpiry:false,AdvertiseTrustStoreCaNames:'on',TrustStoreAssociationStatus:'active'}},
    rule={RuleArn:oldRule,Priority:'10',IsDefault:false,Conditions:[{Field:'path-pattern',Values:['/test/*']}],Actions:options.oidc?[{Type:'authenticate-oidc',AuthenticateOidcConfig:{ClientSecret:'synthetic-secret'}}]:[{Type:'forward',TargetGroupArn:target}],
      Transforms:[{Type:'url-rewrite',UrlRewriteConfig:{Rewrites:[{Regex:'^/test/(.*)',Replace:'/$1'}]}}]},
    newAttrs=copy(attrs),newListenerAttrs=[],userTag=[{Key:'Project',Value:'synthetic'}];
  let clock=1000,store;
  const io={now:()=>clock,sleep:async ms=>{clock+=ms;},call:async(service,operation,input)=>{
    const mutation=permittedOperations.writes[service]?.includes(operation);calls.push({service,operation,input:copy(input),mutation});if(mutation)assert.ok(store?.snapshot,'backup must precede every write');
    if(options.failOperation===operation)throw Object.assign(Error('synthetic failure'),{code:'AccessDenied'});
    if(operation==='get-caller-identity')return {Account:options.wrongAccount?'222222222222':account,Arn:`arn:aws:iam::${account}:user/test`};
    if(service==='rds'){
      const cluster=operation.includes('cluster'),id=cluster?'test-cluster':'test-db',arn=`arn:aws:rds:ca-central-1:${account}:${cluster?'cluster':'db'}:${id}`,key=cluster?'cluster':'instance';
      if(operation.startsWith('stop-'))state[key]=options.neverStops?'stopping':'stopped';if(operation.startsWith('start-'))state[key]='available';
      return cluster?{DBClusters:[{DBClusterArn:arn,DBClusterIdentifier:id,DbClusterResourceId:state.replacement?'replaced-id':'cluster-stable-id',Engine:'aurora-postgresql',Status:state[key]}]}:
        {DBInstances:[{DBInstanceArn:arn,DBInstanceIdentifier:id,DbiResourceId:'db-stable-id',Engine:'postgres',DBInstanceStatus:state[key]}]};
    }
    if(operation==='describe-load-balancers'){
      const old=input.LoadBalancerArns?.[0]===oldArn;
      if(old&&!state.deleted)return {LoadBalancers:[copy(lb)]};
      if(!old&&state.created)return {LoadBalancers:[{...copy(lb),LoadBalancerArn:newArn,DNSName:'new.example',CanonicalHostedZoneId:'NEWZONE'}]};
      throw Object.assign(Error('not found'),{code:'LoadBalancerNotFound'});
    }
    if(operation==='describe-load-balancer-attributes')return {Attributes:copy(input.LoadBalancerArn===oldArn?attrs:newAttrs)};
    if(operation==='modify-load-balancer-attributes'){const current=input.LoadBalancerArn===oldArn?attrs:newAttrs;for(const a of input.Attributes){const item=current.find(v=>v.Key===a.Key);if(item)item.Value=a.Value;else current.push(copy(a));}return {Attributes:copy(current)};}
    if(operation==='describe-listeners'){
      if(input.LoadBalancerArn===newArn)return {Listeners:copy(state.newListeners)};
      if(options.pagination&&!input.Marker)return {Listeners:[],NextMarker:'page-two'};
      return {Listeners:[copy(listener)]};
    }
    if(operation==='describe-listener-attributes')return {Attributes:copy(input.ListenerArn===oldListener?listenerAttrs:newListenerAttrs)};
    if(operation==='modify-listener-attributes'){newListenerAttrs.push(...copy(input.Attributes));return {};}
    if(operation==='describe-listener-certificates')return {Certificates:[{CertificateArn:certificate,IsDefault:true},{CertificateArn:extraCertificate,IsDefault:false}]};
    if(operation==='describe-rules')return {Rules:[{RuleArn:'default',IsDefault:true,Priority:'default',Actions:defaultActions},...(input.ListenerArn===oldListener?[copy(rule)]:copy(state.newRules))]};
    if(operation==='describe-target-groups')return {TargetGroups:[{TargetGroupArn:target,VpcId:'vpc-test'}]};
    if(operation==='describe-tags'){const arn=input.ResourceArns[0];return {TagDescriptions:[{ResourceArn:arn,Tags:[...copy(userTag),...(arn===oldArn?[{Key:'aws:cloudformation:stack-id',Value:`arn:aws:cloudformation:ca-central-1:${account}:stack/test/one`}]:[])]}]};}
    if(operation==='delete-load-balancer'){state.deleted=true;return {};}
    if(operation==='create-load-balancer'){assert.equal(input.Name,'test-lb');assert.equal(input.LoadBalancerName,undefined);state.created=true;return {LoadBalancers:[{...copy(lb),LoadBalancerArn:newArn,DNSName:'new.example',CanonicalHostedZoneId:'NEWZONE'}]};}
    if(operation==='create-listener'){const value={...copy(input),ListenerArn:newListener};state.newListeners.push(value);return {Listeners:[value]};}
    if(operation==='create-rule'){const value={...copy(input),Priority:String(input.Priority),IsDefault:false,RuleArn:newRule};if(options.corruptRestoredRule)value.Actions=defaultActions;state.newRules.push(value);return {Rules:[value]};}
    if(operation==='add-listener-certificates')return {};
    throw Error(`UNEXPECTED_SYNTHETIC_OPERATION_${operation}`);
  }};
  store={snapshot:null,journal:null,async createSnapshot(s,j){assert.equal(this.snapshot,null);this.snapshot=copy(s);this.journal=copy(j);},async saveJournal(j){this.journal=copy(j);},async load(){return {snapshot:copy(this.snapshot),journal:copy(this.journal)};}};
  return {io,store,calls,state};
}
const writes=f=>f.calls.filter(c=>c.mutation);

test('stop backs up complete ALB before stopping RDS, never deletes databases or target groups',async()=>{
  const f=fixture({pagination:true}),r=await stopResources({...f,config});assert.equal(r.status,'STOP_VERIFIED');
  assert.deepEqual(writes(f).map(c=>c.operation),['stop-db-cluster','stop-db-instance','modify-load-balancer-attributes','delete-load-balancer']);
  assert.equal(f.store.snapshot.loadBalancers[0].listeners[0].rules.length,1);assert.equal(f.store.snapshot.loadBalancers[0].listeners[0].certificates.length,2);
  assert.equal(f.calls.filter(c=>c.operation==='describe-listeners').length,2);assert.ok(f.store.journal.actions[`delete:${oldArn}`]);
});
test('resume starts RDS and recreates ALB/mTLS/listeners/certificates/transforms, returns binding map',async()=>{
  const f=fixture();await stopResources({...f,config});f.calls.length=0;const r=await resumeResources(f);
  assert.equal(r.verified,true);assert.equal(r.applicationRecovered,false);assert.equal(r.mapping[0].newArn,newArn);assert.equal(r.mapping[0].newDnsName,'new.example');
  assert.equal(r.mapping[0].listeners[0].newArn,newListener);assert.equal(r.mapping[0].rules[0].newArn,newRule);
  assert.deepEqual(writes(f).slice(0,2).map(c=>c.operation),['start-db-cluster','start-db-instance']);
  const input=f.calls.find(c=>c.operation==='create-listener').input;assert.equal(input.MutualAuthentication.Mode,'verify');assert.equal(input.MutualAuthentication.TrustStoreAssociationStatus,undefined);
  assert.ok(f.calls.some(c=>c.operation==='add-listener-certificates'));assert.ok(f.calls.find(c=>c.operation==='create-rule').input.Transforms);
  assert.ok(writes(f).every(c=>!JSON.stringify(c.input.Tags??[]).includes('aws:cloudformation')));
  const before=f.calls.length;await assert.rejects(resumeResources(f),/RESTORE_ALREADY_ATTEMPTED/);assert.equal(f.calls.length,before);
});
test('wrong account prevents every write',async()=>{const f=fixture({wrongAccount:true});await assert.rejects(stopResources({...f,config}),/SOURCE_ACCOUNT_MISMATCH/);assert.equal(writes(f).length,0);});
test('CloudFormation drift acknowledgement is required before any mutation',async()=>{const f=fixture();await assert.rejects(stopResources({...f,config:{...config,acknowledgeCloudFormationDrift:false}}),/CLOUDFORMATION_DRIFT_ACK/);assert.equal(writes(f).length,0);});
test('deletion protection is not silently disabled',async()=>{const f=fixture();await assert.rejects(stopResources({...f,config:{...config,allowDisableDeletionProtection:false}}),/DELETION_PROTECTION_ACK/);assert.equal(writes(f).length,0);});
test('unexportable OIDC configuration refuses deletion while RDS is still running',async()=>{const f=fixture({oidc:true});await assert.rejects(stopResources({...f,config}),/OIDC_SECRET_NOT_EXPORTABLE/);assert.equal(writes(f).length,0);assert.equal(f.store.snapshot,null);});
test('a failed write is journaled, not retried or followed by deletion',async()=>{const f=fixture({failOperation:'stop-db-cluster'});await assert.rejects(stopResources({...f,config}));assert.equal(writes(f).length,1);assert.equal(f.store.journal.status,'NEEDS_INSPECTION');assert.equal(Object.values(f.store.journal.actions)[0].status,'UNKNOWN_OR_REJECTED');});
test('RDS stopping is not claimed stopped and no mutation is replayed while polling',async()=>{const f=fixture({neverStops:true});const r=await stopResources({...f,config,waitSeconds:0});assert.equal(r.verified,false);assert.equal(r.status,'STOP_SUBMITTED_NOT_VERIFIED');assert.equal(writes(f).filter(c=>c.operation==='stop-db-cluster').length,1);});
test('pre-existing stopped RDS is neither stopped again nor started by resume',async()=>{const f=fixture({originallyStopped:true});await stopResources({...f,config});await resumeResources(f);assert.equal(writes(f).filter(c=>c.service==='rds').length,0);});
test('AWS auto-started RDS is not started twice',async()=>{const f=fixture();await stopResources({...f,config});f.state.cluster='available';f.state.instance='available';f.calls.length=0;await resumeResources(f);assert.equal(writes(f).filter(c=>c.service==='rds').length,0);});
test('replacement database with the same identifier refuses restore before writes',async()=>{const f=fixture();await stopResources({...f,config});f.state.replacement=true;f.calls.length=0;await assert.rejects(resumeResources(f),/DATABASE_REPLACED/);assert.equal(writes(f).length,0);});
test('backup tampering refuses restore before identity lookup',async()=>{const f=fixture();await stopResources({...f,config});f.store.snapshot.config.profile='changed';f.calls.length=0;await assert.rejects(resumeResources(f),/BACKUP_INTEGRITY/);assert.equal(f.calls.length,0);});
test('backup persistence failure prevents all cloud writes',async()=>{const f=fixture();f.store.createSnapshot=async()=>{throw Error('DISK_FULL');};await assert.rejects(stopResources({...f,config}),/DISK_FULL/);assert.equal(writes(f).length,0);});
test('an old ALB still present refuses recreation before database start',async()=>{const f=fixture();await stopResources({...f,config});f.state.deleted=false;f.calls.length=0;await assert.rejects(resumeResources(f),/OLD_ALB_STILL_EXISTS/);assert.equal(writes(f).length,0);});
test('a reused load-balancer name is not adopted or overwritten',async()=>{const f=fixture();await stopResources({...f,config});f.state.created=true;f.calls.length=0;await assert.rejects(resumeResources(f),/ALB_NAME_OCCUPIED/);assert.equal(writes(f).length,0);});
test('a target group dependency error stops before RDS or ELB writes',async()=>{const f=fixture({failOperation:'describe-target-groups'});await assert.rejects(stopResources({...f,config}));assert.equal(writes(f).length,0);});
test('restore readback detects wrong rule configuration instead of claiming success',async()=>{const f=fixture({corruptRestoredRule:true});await stopResources({...f,config});await assert.rejects(resumeResources(f),/RESTORED_RULE_CONFIG_MISMATCH/);assert.equal(f.store.journal.status,'RESTORING');});
test('configuration is explicit, rejects wildcard/NLB/account-region mismatches and credentials',()=>{
  assert.deepEqual(validateConfig(config),config);
  for(const bad of [{...config,loadBalancerArns:[oldArn.replace(account,'222222222222')]},{...config,loadBalancerArns:[oldArn.replace('/app/','/net/')]},{...config,rdsClusters:['*']},{...config,password:'not-allowed'}])assert.throws(()=>validateConfig(bad));
});
test('API projections remove read-only fields, preserve mTLS and transforms',()=>{
  assert.equal(listenerInput({Protocol:'HTTPS',Port:443,DefaultActions:[],MutualAuthentication:{Mode:'verify',TrustStoreAssociationStatus:'active'}},newArn).MutualAuthentication.TrustStoreAssociationStatus,undefined);
  assert.throws(()=>ruleInput({Priority:'default'},newListener),/RULE_PRIORITY/);
});
test('CLI defaults to offline preview; execute requires a literal account confirmation',()=>{
  assert.equal(parseArgs('stop',['--config','x.json','--state','backup']).execute,false);assert.deepEqual(parseArgs('resume',['--help']),{help:true});
  assert.throws(()=>parseArgs('stop',['--config','x','--state','s','--execute']),/EXPLICIT_ACCOUNT/);
  assert.throws(()=>parseArgs('resume',['--state','s','--wait-seconds','-1']),/WAIT_RANGE/);
});
test('production adapter uses fixed HTTPS, no shell/retry, and forbids database deletion',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'techlong-resource-power-test-'));const runs=[];
  try{
    const cli=new AwsCli(config,dir,{exec:async(bin,args,opts)=>{runs.push({bin,args,opts});const file=args[args.indexOf('--cli-input-json')+1].slice(7);assert.deepEqual(JSON.parse(await readFile(file)),{});return {stdout:'{}'};}});
    await cli.call('sts','get-caller-identity',{});assert.equal(runs.length,1);assert.ok(runs[0].args.includes('https://sts.ca-central-1.amazonaws.com'));assert.equal(runs[0].opts.shell,undefined);assert.equal(runs[0].opts.env.AWS_MAX_ATTEMPTS,'1');
    await assert.rejects(cli.call('rds','stop-db-cluster',{}),/AWS_WRITES_NOT_ENABLED/);await assert.rejects(cli.call('rds','delete-db-cluster',{}),/AWS_OPERATION_NOT_ALLOWED/);assert.equal(runs.length,1);
  }finally{assert.ok(path.basename(dir).startsWith('techlong-resource-power-test-'));await rm(dir,{recursive:true});}
});
test('local file store persists backup/hash, locks concurrent runs and detects alteration',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'techlong-resource-power-test-'));try{
    const store=new FileStore(dir),f=fixture();await stopResources({...f,config});await store.createSnapshot(f.store.snapshot,f.store.journal);assert.equal((await store.load()).journal.status,'STOP_VERIFIED');
    const release=await store.lock();await assert.rejects(store.lock(),{code:'EEXIST'});await release();
  }finally{assert.ok(path.basename(dir).startsWith('techlong-resource-power-test-'));await rm(dir,{recursive:true});}
});
