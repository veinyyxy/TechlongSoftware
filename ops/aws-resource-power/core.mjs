// Explicit-target cost controls. No credentials, SDK clients, I/O or AWS calls on import.
import {createHash} from 'node:crypto';

export const SCHEMA='techlong/aws-resource-power/v1';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ensure=(value,code)=>{if(!value)throw Error(code);};
const clone=value=>structuredClone(value);
const select=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,clone(value[k])]));
const unique=values=>new Set(values).size===values.length;
export function validateConfig(value){
  const keys=['accountId','region','profile','rdsClusters','rdsInstances','loadBalancerArns','allowDisableDeletionProtection','acknowledgeCloudFormationDrift'];
  ensure(value&&Object.keys(value).every(k=>keys.includes(k)),'CONFIG_UNKNOWN_FIELD');
  ensure(/^\d{12}$/.test(value.accountId)&&/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(value.region)&&/^[\w.-]+$/.test(value.profile),'CONFIG_IDENTITY');
  for(const k of ['rdsClusters','rdsInstances','loadBalancerArns'])ensure(Array.isArray(value[k])&&value[k].length<=50&&unique(value[k]),'CONFIG_TARGETS');
  for(const id of [...value.rdsClusters,...value.rdsInstances])ensure(typeof id==='string'&&/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(id),'CONFIG_DATABASE_ID');
  for(const arn of value.loadBalancerArns)assertArn(arn,value,'elasticloadbalancing','loadbalancer/app/');
  ensure(value.rdsClusters.length+value.rdsInstances.length+value.loadBalancerArns.length>0,'CONFIG_EMPTY');
  for(const k of ['allowDisableDeletionProtection','acknowledgeCloudFormationDrift'])ensure(value[k]===undefined||typeof value[k]==='boolean','CONFIG_BOOLEAN');
  return clone(value);
}
function assertArn(arn,config,service,prefix){
  ensure(typeof arn==='string'&&arn.startsWith(`arn:aws:${service}:${config.region}:${config.accountId}:${prefix}`)&&!/[\s*?]/.test(arn),'RESOURCE_ACCOUNT_REGION_OR_TYPE');
}
async function identity(config,io){
  const who=await io.call('sts','get-caller-identity',{});
  ensure(who.Account===config.accountId&&typeof who.Arn==='string'&&who.Arn.split(':')[4]===config.accountId,'SOURCE_ACCOUNT_MISMATCH');
}
async function pages(io,operation,input,key){
  const result=[],seen=new Set();let marker;
  do{
    const r=await io.call('elbv2',operation,{...input,...(marker?{Marker:marker}:{})});
    ensure(Array.isArray(r[key]),'AWS_RESPONSE_LIST');result.push(...r[key]);
    marker=r.NextMarker;ensure(!marker||!seen.has(marker),'PAGINATION_CYCLE');if(marker)seen.add(marker);
    ensure(seen.size<100&&result.length<=5000,'PAGINATION_LIMIT');
  }while(marker);
  return result;
}
async function tags(io,arn){
  const r=await io.call('elbv2','describe-tags',{ResourceArns:[arn]});
  ensure(r.TagDescriptions?.length===1&&r.TagDescriptions[0].ResourceArn===arn,'TAG_RESPONSE');return r.TagDescriptions[0].Tags??[];
}
const userTags=values=>values.filter(t=>!t.Key.toLowerCase().startsWith('aws:'));
function checkActions(actions,config){
  ensure(Array.isArray(actions)&&actions.length>0,'ALB_ACTIONS');
  for(const action of actions){
    // Describe APIs cannot export an OIDC client secret; never delete an ALB we cannot reconstruct.
    ensure(action.Type!=='authenticate-oidc'&&!action.AuthenticateOidcConfig,'OIDC_SECRET_NOT_EXPORTABLE');
    for(const arn of [action.TargetGroupArn,...(action.ForwardConfig?.TargetGroups??[]).map(t=>t.TargetGroupArn)].filter(Boolean))assertArn(arn,config,'elasticloadbalancing','targetgroup/');
  }
}
export function listenerInput(listener,loadBalancerArn,tagValues=[]){
  const input={...select(listener,['Protocol','Port','SslPolicy','DefaultActions','AlpnPolicy']),LoadBalancerArn:loadBalancerArn};
  if(listener.Certificates?.length)input.Certificates=listener.Certificates.map(c=>({CertificateArn:c.CertificateArn}));
  if(listener.MutualAuthentication)input.MutualAuthentication=select(listener.MutualAuthentication,['Mode','TrustStoreArn','IgnoreClientCertificateExpiry','AdvertiseTrustStoreCaNames']);
  if(userTags(tagValues).length)input.Tags=userTags(tagValues);return input;
}
export function ruleInput(rule,listenerArn,tagValues=[]){
  const input={...select(rule,['Conditions','Actions','Transforms']),ListenerArn:listenerArn,Priority:Number(rule.Priority)};
  ensure(Number.isInteger(input.Priority)&&input.Priority>=1&&input.Priority<=50000,'RULE_PRIORITY');
  if(userTags(tagValues).length)input.Tags=userTags(tagValues);return input;
}
function lbInput(saved){
  const lb=saved.description;
  return {...select(lb,['Scheme','Type','IpAddressType','SecurityGroups','CustomerOwnedIpv4Pool','IpamPools']),
    Name:lb.LoadBalancerName,Subnets:lb.AvailabilityZones.map(z=>z.SubnetId),...(userTags(saved.tags).length?{Tags:userTags(saved.tags)}:{})};
}
async function readDatabase(config,io,kind,id){
  const cluster=kind==='cluster',r=await io.call('rds',cluster?'describe-db-clusters':'describe-db-instances',cluster?{DBClusterIdentifier:id}:{DBInstanceIdentifier:id}),
    rows=cluster?r.DBClusters:r.DBInstances;
  ensure(rows?.length===1&&!r.Marker,'DATABASE_RESPONSE');const db=rows[0],arn=cluster?db.DBClusterArn:db.DBInstanceArn;
  assertArn(arn,config,'rds',cluster?'cluster:':'db:');
  ensure((cluster?db.DBClusterIdentifier:db.DBInstanceIdentifier)===id,'DATABASE_ID_MISMATCH');
  if(cluster){
    ensure(/^aurora(?:-|$)/.test(db.Engine)&&!db.GlobalClusterIdentifier&&!db.ReplicationSourceIdentifier&&!(db.ReadReplicaIdentifiers?.length),'UNSUPPORTED_CLUSTER_TOPOLOGY');
  }else{
    ensure(!db.DBClusterIdentifier&&!db.ReadReplicaSourceDBInstanceIdentifier&&!(db.ReadReplicaDBInstanceIdentifiers?.length)&&!(db.ReadReplicaDBClusterIdentifiers?.length)&&
      !(db.MultiAZ&&db.Engine?.startsWith('sqlserver'))&&!db.Engine?.startsWith('custom-'),'UNSUPPORTED_INSTANCE_TOPOLOGY');
  }
  const resourceId=cluster?db.DbClusterResourceId:db.DbiResourceId;ensure(typeof resourceId==='string'&&resourceId,'DATABASE_RESOURCE_ID');
  return {kind,id,arn,resourceId,status:cluster?db.Status:db.DBInstanceStatus,engine:db.Engine};
}
async function readLoadBalancer(config,io,arn){
  const r=await io.call('elbv2','describe-load-balancers',{LoadBalancerArns:[arn]});
  ensure(r.LoadBalancers?.length===1&&!r.NextMarker,'ALB_RESPONSE');const lb=r.LoadBalancers[0];
  ensure(lb.LoadBalancerArn===arn&&lb.Type==='application'&&lb.State?.Code==='active','ALB_NOT_ACTIVE_APPLICATION');
  ensure(lb.AvailabilityZones?.length&&lb.AvailabilityZones.every(z=>z.SubnetId&&!z.OutpostId),'ALB_UNSUPPORTED_SUBNET_LAYOUT');
  const saved={description:lb,tags:await tags(io,arn),attributes:(await io.call('elbv2','describe-load-balancer-attributes',{LoadBalancerArn:arn})).Attributes,listeners:[]};
  ensure(Array.isArray(saved.attributes),'ALB_ATTRIBUTES');
  ensure(!saved.tags.some(t=>t.Key==='aws:cloudformation:stack-id')||config.acknowledgeCloudFormationDrift===true,'CLOUDFORMATION_DRIFT_ACK_REQUIRED');
  ensure(!saved.attributes.some(a=>a.Key==='deletion_protection.enabled'&&a.Value==='true')||config.allowDisableDeletionProtection===true,'DELETION_PROTECTION_ACK_REQUIRED');
  for(const listener of await pages(io,'describe-listeners',{LoadBalancerArn:arn},'Listeners')){
    assertArn(listener.ListenerArn,config,'elasticloadbalancing','listener/app/');checkActions(listener.DefaultActions,config);
    const entry={description:listener,tags:await tags(io,listener.ListenerArn),attributes:(await io.call('elbv2','describe-listener-attributes',{ListenerArn:listener.ListenerArn})).Attributes,rules:[],certificates:[]};
    ensure(Array.isArray(entry.attributes),'LISTENER_ATTRIBUTES');
    if(listener.Protocol==='HTTPS'){
      entry.certificates=await pages(io,'describe-listener-certificates',{ListenerArn:listener.ListenerArn},'Certificates');
      const primary=entry.certificates.filter(c=>c.IsDefault);ensure(primary.length===1,'LISTENER_DEFAULT_CERTIFICATE');
      entry.description={...listener,Certificates:[{CertificateArn:primary[0].CertificateArn}]};
    }
    for(const rule of await pages(io,'describe-rules',{ListenerArn:listener.ListenerArn},'Rules')){
      checkActions(rule.Actions,config);if(rule.IsDefault)continue;
      const ruleTags=await tags(io,rule.RuleArn);ruleInput(rule,listener.ListenerArn,ruleTags);entry.rules.push({description:rule,tags:ruleTags});
    }
    listenerInput(entry.description,arn,entry.tags);saved.listeners.push(entry);
  }
  return saved;
}
function groupArns(saved){
  return [...new Set(saved.listeners.flatMap(l=>[...l.description.DefaultActions,...l.rules.flatMap(r=>r.description.Actions)]).flatMap(a=>
    [a.TargetGroupArn,...(a.ForwardConfig?.TargetGroups??[]).map(t=>t.TargetGroupArn)].filter(Boolean)))];
}
async function checkGroups(io,loadBalancers){
  for(const saved of loadBalancers)for(const arn of groupArns(saved)){
    const r=await io.call('elbv2','describe-target-groups',{TargetGroupArns:[arn]});
    ensure(r.TargetGroups?.length===1&&r.TargetGroups[0].TargetGroupArn===arn&&r.TargetGroups[0].VpcId===saved.description.VpcId,'TARGET_GROUP_MISSING_OR_CHANGED');
  }
}
async function absentLoadBalancer(io,input){
  try{const r=await io.call('elbv2','describe-load-balancers',input);return r.LoadBalancers?.length===0;}
  catch(e){if(['LoadBalancerNotFound','LoadBalancerNotFoundException'].includes(e.code))return true;throw e;}
}
async function write(io,store,journal,key,service,operation,input){
  ensure(!journal.actions[key],'WRITE_ALREADY_ATTEMPTED_NO_REPLAY');
  journal.actions[key]={service,operation,status:'SUBMITTING',at:io.now()};await store.saveJournal(journal);
  try{const response=await io.call(service,operation,input);journal.actions[key].status='ACKNOWLEDGED';await store.saveJournal(journal);return response;}
  catch(e){journal.actions[key].status='UNKNOWN_OR_REJECTED';journal.status='NEEDS_INSPECTION';await store.saveJournal(journal);throw e;}
}
async function until(io,predicate,deadline){
  for(;;){if(await predicate())return true;if(io.now()>=deadline)return false;await io.sleep(Math.min(10000,deadline-io.now()));}
}
const byKey=values=>[...values].sort((a,b)=>a.Key.localeCompare(b.Key));
const byArn=values=>[...values].map(c=>({CertificateArn:c.CertificateArn,IsDefault:c.IsDefault})).sort((a,b)=>a.CertificateArn.localeCompare(b.CertificateArn));
async function verifyRestoredAlb(config,io,saved,arn){
  const actual=await readLoadBalancer(config,io,arn),expectedInput=lbInput(saved),actualInput=lbInput(actual);
  for(const input of [expectedInput,actualInput]){input.Subnets.sort();input.SecurityGroups?.sort();if(input.Tags)input.Tags=byKey(input.Tags);}
  ensure(digest(expectedInput)===digest(actualInput)&&digest(byKey(saved.attributes))===digest(byKey(actual.attributes)),'RESTORED_ALB_CONFIG_MISMATCH');
  ensure(actual.listeners.length===saved.listeners.length,'RESTORED_LISTENER_COUNT');
  for(const before of saved.listeners){const after=actual.listeners.find(l=>l.description.Port===before.description.Port&&l.description.Protocol===before.description.Protocol);
    ensure(after,'RESTORED_LISTENER_MISSING');
    const a=listenerInput(before.description,'comparison',before.tags),b=listenerInput(after.description,'comparison',after.tags);
    if(a.Tags)a.Tags=byKey(a.Tags);if(b.Tags)b.Tags=byKey(b.Tags);
    ensure(digest(a)===digest(b)&&digest(byKey(before.attributes))===digest(byKey(after.attributes))&&digest(byArn(before.certificates))===digest(byArn(after.certificates)),'RESTORED_LISTENER_CONFIG_MISMATCH');
    ensure(before.rules.length===after.rules.length,'RESTORED_RULE_COUNT');
    for(const rule of before.rules){const restored=after.rules.find(r=>r.description.Priority===rule.description.Priority);ensure(restored,'RESTORED_RULE_MISSING');
      const a=ruleInput(rule.description,'comparison',rule.tags),b=ruleInput(restored.description,'comparison',restored.tags);
      if(a.Tags)a.Tags=byKey(a.Tags);if(b.Tags)b.Tags=byKey(b.Tags);ensure(digest(a)===digest(b),'RESTORED_RULE_CONFIG_MISMATCH');
    }
  }
}
export async function stopResources({config,io,store,waitSeconds=1800}){
  config=validateConfig(config);await identity(config,io);const databases=[];
  for(const [kind,ids]of [['cluster',config.rdsClusters],['instance',config.rdsInstances]])for(const id of ids){
    const db=await readDatabase(config,io,kind,id);ensure(['available','stopped'].includes(db.status),'DATABASE_NOT_STABLE');databases.push(db);
  }
  const loadBalancers=[];for(const arn of config.loadBalancerArns)loadBalancers.push(await readLoadBalancer(config,io,arn));
  await checkGroups(io,loadBalancers);
  const snapshot={schema:SCHEMA,config,createdAt:io.now(),databases,loadBalancers},journal={schema:SCHEMA,snapshotSha256:digest(snapshot),status:'CAPTURED',actions:{},mapping:[]};
  await store.createSnapshot(snapshot,journal); // All restore material is durable before the FIRST cloud write.
  for(const db of databases){if(db.status==='stopped')continue;
    await write(io,store,journal,`stop:${db.arn}`,'rds',db.kind==='cluster'?'stop-db-cluster':'stop-db-instance',db.kind==='cluster'?{DBClusterIdentifier:db.id}:{DBInstanceIdentifier:db.id});
  }
  for(const saved of loadBalancers){const arn=saved.description.LoadBalancerArn;
    if(saved.attributes.some(a=>a.Key==='deletion_protection.enabled'&&a.Value==='true'))await write(io,store,journal,`unprotect:${arn}`,'elbv2','modify-load-balancer-attributes',{LoadBalancerArn:arn,Attributes:[{Key:'deletion_protection.enabled',Value:'false'}]});
    await write(io,store,journal,`delete:${arn}`,'elbv2','delete-load-balancer',{LoadBalancerArn:arn});
  }
  const deadline=io.now()+waitSeconds*1000;
  const verified=await until(io,async()=>{
    let ready=true;
    for(const db of databases){const current=await readDatabase(config,io,db.kind,db.id);ensure(current.resourceId===db.resourceId,'DATABASE_REPLACED');ready=current.status==='stopped'&&ready;}
    for(const saved of loadBalancers)ready=await absentLoadBalancer(io,{LoadBalancerArns:[saved.description.LoadBalancerArn]})&&ready;
    return ready;
  },deadline);
  journal.status=verified?'STOP_VERIFIED':'STOP_SUBMITTED_NOT_VERIFIED';journal.finishedAt=io.now();await store.saveJournal(journal);
  return {status:journal.status,verified,databases:databases.map(d=>d.id),deletedLoadBalancerArns:config.loadBalancerArns,warning:'RDS can auto-start after 7 days; storage/backups and other resources may still cost money.'};
}
export async function resumeResources({io,store,waitSeconds=1800}){
  const {snapshot,journal}=await store.load();ensure(snapshot.schema===SCHEMA&&journal.schema===SCHEMA&&digest(snapshot)===journal.snapshotSha256,'BACKUP_INTEGRITY');
  const config=validateConfig(snapshot.config);ensure(!Object.hasOwn(journal,'resumeStartedAt'),'RESTORE_ALREADY_ATTEMPTED_NO_REPLAY');await identity(config,io);
  for(const db of snapshot.databases){const current=await readDatabase(config,io,db.kind,db.id);
    ensure(current.arn===db.arn&&current.resourceId===db.resourceId,'DATABASE_REPLACED');ensure(['stopped','available','starting'].includes(current.status),'DATABASE_NOT_READY_TO_START');
  }
  for(const saved of snapshot.loadBalancers){
    ensure(await absentLoadBalancer(io,{LoadBalancerArns:[saved.description.LoadBalancerArn]}),'OLD_ALB_STILL_EXISTS');
    ensure(await absentLoadBalancer(io,{Names:[saved.description.LoadBalancerName]}),'ALB_NAME_OCCUPIED');
  }
  await checkGroups(io,snapshot.loadBalancers);journal.resumeStartedAt=io.now();journal.status='RESTORING';await store.saveJournal(journal);
  for(const db of snapshot.databases){if(db.status==='stopped')continue;const current=await readDatabase(config,io,db.kind,db.id);
    if(current.status==='stopped')await write(io,store,journal,`start:${db.arn}`,'rds',db.kind==='cluster'?'start-db-cluster':'start-db-instance',db.kind==='cluster'?{DBClusterIdentifier:db.id}:{DBInstanceIdentifier:db.id});
  }
  const deadline=io.now()+waitSeconds*1000;
  for(const saved of snapshot.loadBalancers){
    const input=lbInput(saved);
    const result=await write(io,store,journal,`recreate:${saved.description.LoadBalancerArn}`,'elbv2','create-load-balancer',input),lb=result.LoadBalancers?.[0];
    ensure(lb&&lb.LoadBalancerName===saved.description.LoadBalancerName&&lb.DNSName&&lb.CanonicalHostedZoneId,'CREATED_ALB_RESPONSE');assertArn(lb.LoadBalancerArn,config,'elasticloadbalancing','loadbalancer/app/');
    const mapping={oldArn:saved.description.LoadBalancerArn,newArn:lb.LoadBalancerArn,oldDnsName:saved.description.DNSName,newDnsName:lb.DNSName,newHostedZoneId:lb.CanonicalHostedZoneId,listeners:[],rules:[]};
    journal.mapping.push(mapping);await store.saveJournal(journal);
    const active=await until(io,async()=>{const r=await io.call('elbv2','describe-load-balancers',{LoadBalancerArns:[lb.LoadBalancerArn]});return r.LoadBalancers?.[0]?.State?.Code==='active';},deadline);
    ensure(active,'ALB_ACTIVE_TIMEOUT_INSPECT_SAVED_MAPPING');
    // ALB cross-zone is always true. Deletion protection is restored LAST, after listeners/rules.
    const attrs=saved.attributes.filter(a=>!['deletion_protection.enabled','load_balancing.cross_zone.enabled'].includes(a.Key));
    if(attrs.length)await write(io,store,journal,`attrs:${lb.LoadBalancerArn}`,'elbv2','modify-load-balancer-attributes',{LoadBalancerArn:lb.LoadBalancerArn,Attributes:attrs});
    for(const entry of saved.listeners){
      const r=await write(io,store,journal,`listener:${entry.description.ListenerArn}`,'elbv2','create-listener',listenerInput(entry.description,lb.LoadBalancerArn,entry.tags)),arn=r.Listeners?.[0]?.ListenerArn;
      assertArn(arn,config,'elasticloadbalancing','listener/app/');mapping.listeners.push({oldArn:entry.description.ListenerArn,newArn:arn});await store.saveJournal(journal);
      if(entry.attributes.length)await write(io,store,journal,`listener-attrs:${arn}`,'elbv2','modify-listener-attributes',{ListenerArn:arn,Attributes:entry.attributes});
      const extra=entry.certificates.filter(c=>!c.IsDefault).map(c=>({CertificateArn:c.CertificateArn}));
      if(extra.length)await write(io,store,journal,`certificates:${arn}`,'elbv2','add-listener-certificates',{ListenerArn:arn,Certificates:extra});
      for(const rule of entry.rules){const r=await write(io,store,journal,`rule:${rule.description.RuleArn}`,'elbv2','create-rule',ruleInput(rule.description,arn,rule.tags)),newArn=r.Rules?.[0]?.RuleArn;
        assertArn(newArn,config,'elasticloadbalancing','listener-rule/app/');mapping.rules.push({oldArn:rule.description.RuleArn,newArn});await store.saveJournal(journal);
      }
    }
    const protection=saved.attributes.find(a=>a.Key==='deletion_protection.enabled');
    if(protection)await write(io,store,journal,`protect:${lb.LoadBalancerArn}`,'elbv2','modify-load-balancer-attributes',{LoadBalancerArn:lb.LoadBalancerArn,Attributes:[protection]});
    await verifyRestoredAlb(config,io,saved,lb.LoadBalancerArn);
  }
  const verified=await until(io,async()=>{
    let ready=true;for(const db of snapshot.databases.filter(d=>d.status!=='stopped')){const r=await readDatabase(config,io,db.kind,db.id);ensure(r.resourceId===db.resourceId,'DATABASE_REPLACED');ready=r.status==='available'&&ready;}return ready;
  },deadline);
  journal.status=verified?'RESOURCES_RECREATED_BINDINGS_REQUIRE_REVIEW':'RESUME_SUBMITTED_NOT_VERIFIED';journal.finishedAt=io.now();await store.saveJournal(journal);
  return {status:journal.status,verified,mapping:journal.mapping,applicationRecovered:false,warning:'Review CloudFormation outputs, Route53 aliases and any direct listener/ALB references; they are NOT rewritten by this tool.'};
}
