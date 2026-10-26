import {writeFile,access} from 'node:fs/promises';
import {git} from '../platform-identity-review-v6/publication.mjs';
import {must,same} from '../platform-publication-v6/plan.mjs';
import {R,Q,hash,validateRecoveryObjects} from './plan.mjs';
import {recoveryCloudWorkflows} from '../platform-recovery-cloud-v1/workflows.mjs';

export async function previousTargets(parent){
  const result=[];
  for(const file of [Q.reusable,Q.caller]){
    const tree=(await git(['ls-tree',parent,'--',file])).trim(),text=(await git(['show',parent+':'+file])).replaceAll('\r\n','\n');
    must(tree.startsWith('100644 blob ')&&tree.endsWith('\t'+file),'RECOVERY_EXISTING_FILE');
    result.push({file,blob:tree.split(/[\s]+/)[2],normalizedLfSha256:hash(text)});
  }
  return result;
}
export async function verifyRecoveryObjects(m){
  const texts=validateRecoveryObjects(m.parent,m.objects);
  must(same(await previousTargets(m.parent),m.previousTargets),'RECOVERY_PREVIOUS_OBJECTS');
  for(const [o,text] of [[m.objects.reusable,texts.reusable],[m.objects.caller,texts.caller]])
    must((await git(['rev-list','--parents','-n','1',o.commit])).trim()===o.commit+' '+o.parent&&
      (await git(['rev-parse',o.commit+'^{tree}'])).trim()===o.tree&&
      (await git(['ls-tree',o.commit,'--',o.file])).trim()==='100644 blob '+o.blob+'\t'+o.file&&
      (await git(['show',o.commit+':'+o.file])).replaceAll('\r\n','\n')===text&&
      (await git(['diff','--name-status',o.parent,o.commit])).trim()==='M\t'+o.file,'RECOVERY_ONLY_TWO_UPDATES');
}
export async function prepareRecoveryObjects({parent,output,now=Date.now()}){
  must((await git(['rev-parse','HEAD'])).trim()===parent&&(await git(['branch','--show-current'])).trim()==='main'&&
    (await git(['status','--porcelain'])).trim()==='','RECOVERY_CLEAN_MAIN');
  const previous=await previousTargets(parent),refs=(await git(['show-ref'])).trim();
  const index=output+'/publication.index';try{await access(index);must(false,'RECOVERY_INDEX_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}
  const env={GIT_INDEX_FILE:index,GIT_AUTHOR_DATE:new Date(now).toISOString(),GIT_COMMITTER_DATE:new Date(now).toISOString()};
  await git(['read-tree',parent],{env});
  const make=async(file,text,base)=>{
    const blob=(await git(['hash-object','-w','--stdin'],{input:text})).trim();
    await git(['update-index','--cacheinfo','100644,'+blob+','+file],{env});
    const tree=(await git(['write-tree'],{env})).trim(),commit=(await git(['commit-tree',tree,'-p',base],{
      env,input:'feat(deployments): prepared reviewed recovery workflow (not published)\n'})).trim();
    return {file,parent:base,commit,tree,blob,normalizedLfSha256:hash(text)};
  };
  const seed=recoveryCloudWorkflows({...R,reusableCommit:R.sourceCommit}),reusable=await make(Q.reusable,seed.reusable,parent),
    actual=recoveryCloudWorkflows({...R,reusableCommit:reusable.commit});
  must(seed.reusable===actual.reusable,'RECOVERY_NO_SELF_HASH');
  const caller=await make(Q.caller,actual.caller,reusable.commit),objects={reusable,caller};
  await verifyRecoveryObjects({parent,objects,previousTargets:previous});
  must((await git(['rev-parse','HEAD'])).trim()===parent&&(await git(['show-ref'])).trim()===refs&&
    (await git(['status','--porcelain'])).trim()==='','RECOVERY_REFS_UNCHANGED');
  for(const [name,text] of [['reusable',actual.reusable],['caller',actual.caller]])
    await writeFile(output+'/'+name+'.candidate.yml',text,{flag:'wx',flush:true});
  return {objects,previousTargets:previous,branchesCreated:0,refsChanged:0,externalWrites:0};
}
