import {randomBytes} from 'node:crypto';
import {C,must,same,material,parseMaterial,safeCode,assertWebSnapshot,taskSecretReference} from './contract.mjs';
import {readSnapshot,activate,dedicatedProof} from './database.mjs';
export async function installOnce({manifest:m,sha,baseline,io,now=Date.now}){
  const start=now(),guard=async()=>{must(now()<Date.parse(m.expiresAt)&&now()-start<20*60000,'CREDENTIAL_ACTIVE_WINDOW');await io.aws.source();};
  const fresh=await io.aws.inventory();must(same(fresh.kms,m.inventory.kms)&&same(fresh.source,m.inventory.source),'CREDENTIAL_AWS_DRIFT');
  await guard();await io.consume({manifestSha256:sha,nonce:m.nonce,versionId:m.versionId,startedAtUtc:new Date(now()).toISOString(),retryAllowed:false});
  let owner,reader,dedicated,arn,putAcknowledged=false,activated,observed,proof,password,phase='SLOT_CONSUMED';const errors=[];
  const error=(stage,e)=>errors.push({stage,code:safeCode(e)});
  try{
    phase='OWNER_PREFLIGHT';owner=await io.owner();const pre=await readSnapshot(owner,m.target);assertWebSnapshot(pre.catalog,pre.effective,baseline,false);await io.record('initial-database',pre);
    await guard();phase='CREATE_EMPTY_SECRET';arn=await io.aws.createEmpty(sha,m.inventory.kms.arn);await io.record('secret-created',{arn,name:C.secretName});
    await guard();phase='PROTECT_SOURCE_ONLY';await io.aws.protect(arn);await io.aws.metadata(arn,sha,null,m.inventory.kms.arn);
    await guard();phase='PUT_FIXED_VERSION';const bytes=randomBytes(48);password=bytes.toString('base64url');bytes.fill(0);io.setSensitive(password);
    await io.aws.put(arn,m.versionId,material(m.target,password));putAcknowledged=true;
    await io.record('material-put',{arn,versionId:m.versionId,valueRecorded:false});await io.record('material-metadata',await io.aws.metadata(arn,sha,m.versionId,m.inventory.kms.arn));
    await guard();phase='ROLE_PASSWORD_LOGIN';activated=await activate({client:owner,target:m.target,baseline,password,
      expiresAt:new Date(Math.min(Date.parse(m.expiresAt),start+20*60000)).toISOString(),record:io.record,now});
  }catch(e){error(phase,e);}finally{password=undefined;if(owner)try{await owner.end();}catch(e){error('OWNER_CLOSE',e);}}
  // Independent metadata read is attempted after both success and failure, never another activation.
  try{
    phase='INDEPENDENT_DATABASE';reader=await io.owner();const post=await readSnapshot(reader,m.target),login=post.catalog.identity.candidate_role?.login;
    must(typeof login==='boolean','CREDENTIAL_INDEPENDENT_ROLE');observed=assertWebSnapshot(post.catalog,post.effective,baseline,login);await io.record('independent-database',post);
    if(login&&arn&&putAcknowledged){
      phase='INDEPENDENT_FIXED_VERSION';await guard();await io.record('independent-secret-metadata',await io.aws.metadata(arn,sha,m.versionId,m.inventory.kms.arn));
      await io.record('value-read-intent',{arn,versionId:m.versionId,maximumReads:1,retryAllowed:false});
      const value=await io.aws.get(arn,m.versionId),fixedPassword=parseMaterial(value,m.target);io.setSensitive(fixedPassword);
      phase='DEDICATED_AUTHENTICATION';dedicated=await io.dedicated(fixedPassword);proof=await dedicatedProof(dedicated,m.target,m.roleOid);await io.record('dedicated-proof',proof);
    }
  }catch(e){error(phase,e);}finally{for(const [name,c]of [['DEDICATED_CLOSE',dedicated],['INDEPENDENT_CLOSE',reader]])if(c)try{await c.end();}catch(e){error(name,e);}}
  const result={schema:'techlong/platform-web-credential-result/v1',manifestSha256:sha,nonce:m.nonce,
    outcome:errors.length===0&&activated?.commitAcknowledged&&observed?.login&&proof?.authenticated?'WEB_CREDENTIAL_INDEPENDENTLY_VERIFIED':'CREDENTIAL_REQUIRES_REVIEW_NO_RETRY',
    secretArn:arn??null,versionId:m.versionId,roleOid:m.roleOid,commitAcknowledged:activated?.commitAcknowledged??false,observed:observed??null,
    dedicatedProof:proof??null,taskSecretReference:proof?taskSecretReference(arn,m.versionId):null,errors,awsCalls:{...io.aws.calls},runtimeEnabled:false,retryAllowed:false};
  await io.record('result',result);return result;
}
