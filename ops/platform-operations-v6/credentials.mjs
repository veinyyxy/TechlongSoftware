// Extracted from the verified W6u credential port. No SDK, profile, cache,
// credential discovery or network access: the reviewed caller supplies ports.
import {must,same} from './contract.mjs';

export function createVerifiedCredentialPort({load,verifyIdentity,guard,deadline,expectedIdentity,now=Date.now}){
  must(typeof load==='function'&&typeof verifyIdentity==='function'&&typeof guard==='function'&&Number.isSafeInteger(deadline)&&
    expectedIdentity&&Object.keys(expectedIdentity).sort().join(',')==='Account,Arn,UserId'&&
    /^\d{12}$/.test(expectedIdentity.Account)&&typeof expectedIdentity.UserId==='string'&&expectedIdentity.UserId.length>0&&
    typeof expectedIdentity.Arn==='string'&&expectedIdentity.Arn.startsWith('arn:aws:iam::'+expectedIdentity.Account+':user/'),'CREDENTIAL_PORT');
  const expected=structuredClone(expectedIdentity);let held,pending,closed=false,loads=0,verifications=0;
  const live=()=>must(!closed&&now()<deadline,'SOURCE_CLOSED_OR_EXPIRED');
  async function obtain(){
    live();await guard();live();
    if(held&&held.expiration.getTime()>now()+300000)return structuredClone(held);
    if(!pending)pending=(async()=>{
      try{
        must(loads<6,'SOURCE_REFRESH_BUDGET');loads++;const c=await load();
        live();must(c?.accessKeyId&&c.secretAccessKey&&c.sessionToken&&c.expiration instanceof Date&&
          c.expiration.getTime()>now()+120000,'SOURCE_SESSION');
        verifications++;const who=await verifyIdentity(c);
        must(same({Account:who?.Account,Arn:who?.Arn,UserId:who?.UserId},expected),'SOURCE_IDENTITY');
        await guard();live();must(c.expiration.getTime()>now()+120000,'SOURCE_SESSION');
        held=structuredClone(c);return held;
      }catch{closed=true;held=undefined;throw Error('PLATFORM_OPERATIONS_SOURCE_UNAVAILABLE_NO_RETRY');}
      finally{pending=undefined;}
    })();
    const result=await pending;live();return structuredClone(result);
  }
  return Object.freeze({credentials:obtain,close(){closed=true;held=undefined;},
    counts:()=>({sourceCredentialLoads:loads,sourceStsGets:verifications})});
}
