// Unreachable Git objects + private candidate files only; never update a ref/branch.
import {writeFile,access} from 'node:fs/promises';
import {git} from '../platform-identity-review-v6/publication.mjs';
import {Q,F,must,same,hash,texts,bindingText,validateObjects} from './plan.mjs';
export async function previousTargets(parent){const rows=[];for(const file of [Q.reusable,Q.caller,Q.bindingFile]){
  const t=(await git(['ls-tree',parent,'--',file])).trim(),text=(await git(['show',parent+':'+file])).replaceAll('\r\n','\n');
  must(t.startsWith('100644 blob ')&&t.endsWith('\t'+file),'EXISTING_FILE');rows.push({file,blob:t.split(/\s+/)[2],normalizedLfSha256:hash(text)});
}return rows;}
export async function verifyObjects(m){const rendered=validateObjects(m.parent,m.objects,m.operatorScopeSource);must(same(await previousTargets(m.parent),m.previousTargets),'PREVIOUS_OBJECTS');
  for(const [o,text] of [[m.objects.reusable,rendered.reusable],[m.objects.caller,rendered.caller]])must(
    (await git(['rev-list','--parents','-n','1',o.commit])).trim()===o.commit+' '+o.parent&&
    (await git(['rev-parse',o.commit+'^{tree}'])).trim()===o.tree&&(await git(['ls-tree',o.commit,'--',o.file])).trim()==='100644 blob '+o.blob+'\t'+o.file&&
    (await git(['show',o.commit+':'+o.file])).replaceAll('\r\n','\n')===text,'GIT_OBJECT');
  const binding=m.objects.caller.operatorBinding,scope=bindingText(m.operatorScopeSource,m.objects.reusable.commit);
  must((await git(['ls-tree',m.objects.caller.commit,'--',binding.file])).trim()==='100644 blob '+binding.blob+'\t'+binding.file&&
    (await git(['show',m.objects.caller.commit+':'+binding.file])).replaceAll('\r\n','\n')===scope,'BINDING_OBJECT');
  must((await git(['diff','--name-status',m.parent,m.objects.reusable.commit])).trim()==='M\t'+Q.reusable&&
    (await git(['diff','--name-status',m.objects.reusable.commit,m.objects.caller.commit])).trim()==='M\t'+Q.caller+'\nM\t'+Q.bindingFile,'EXACT_THREE_FILE_DIFF');
}
export async function prepareObjects({parent,output,now=Date.now()}){
  must((await git(['rev-parse','HEAD'])).trim()===parent&&(await git(['branch','--show-current'])).trim()==='main'&&(await git(['status','--porcelain'])).trim()==='','CLEAN_MAIN');
  const previous=await previousTargets(parent),operatorScopeSource=(await git(['show',parent+':'+Q.bindingFile])).replaceAll('\r\n','\n'),refs=(await git(['show-ref'])).trim();
  must(hash(operatorScopeSource)===Q.bindingBeforeSha256,'OLD_BINDING');const index=output+'/publication.index';
  try{await access(index);must(false,'INDEX_OCCUPIED');}catch(e){if(e.code!=='ENOENT')throw e;}
  const env={GIT_INDEX_FILE:index,GIT_AUTHOR_DATE:new Date(now).toISOString(),GIT_COMMITTER_DATE:new Date(now).toISOString()};await git(['read-tree',parent],{env});
  const blob=async(file,text)=>{const id=(await git(['hash-object','-w','--stdin'],{input:text})).trim();await git(['update-index','--cacheinfo','100644,'+id+','+file],{env});
    return {file,blob:id,normalizedLfSha256:hash(text)};};
  const commit=async(base)=>{const tree=(await git(['write-tree'],{env})).trim(),id=(await git(['commit-tree',tree,'-p',base],{env,input:'Prepared reviewed a604 publication (not yet published)\n'})).trim();return {parent:base,tree,commit:id};};
  const seed=texts(F.sourceCommit),reusable={...await blob(Q.reusable,seed.reusable),...await commit(parent)},actual=texts(reusable.commit);
  must(actual.reusable===seed.reusable&&!actual.reusable.includes(reusable.commit),'NO_SELF_HASH');
  const callerBlob=await blob(Q.caller,actual.caller),operatorBinding=await blob(Q.bindingFile,bindingText(operatorScopeSource,reusable.commit)),
    caller={...callerBlob,...await commit(reusable.commit),operatorBinding},objects={reusable,caller};
  await verifyObjects({parent,objects,previousTargets:previous,operatorScopeSource});
  must((await git(['rev-parse','HEAD'])).trim()===parent&&(await git(['show-ref'])).trim()===refs&&(await git(['status','--porcelain'])).trim()==='','REFS_UNCHANGED');
  for(const [name,text] of [['reusable.candidate.yml',actual.reusable],['caller.candidate.yml',actual.caller],['operator-binding.candidate.mjs',bindingText(operatorScopeSource,reusable.commit)]])
    await writeFile(output+'/'+name,text,{flag:'wx',flush:true});
  return {objects,previousTargets:previous,operatorScopeSource,branchesCreated:0,refsChanged:0,externalWrites:0};
}
