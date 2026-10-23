import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeDefaultArrays,main} from '../ops/platform-hosted-deploy-v6/inspect-defaults.mjs';
const fixture=()=>({containerDefinitions:[{image:'unchanged-digest',command:['unchanged-command'],environment:[{name:'public',value:'unchanged'}],
  linuxParameters:{capabilities:{add:[],drop:['ALL']},devices:[],initProcessEnabled:true,tmpfs:[]}}]});
test('only the three observed empty ECS arrays are normalized on a clone; all other definition fields and original remain intact',()=>{
  const raw=fixture(),copy=structuredClone(raw),out=normalizeDefaultArrays(raw);assert.deepEqual(raw,copy);
  assert.deepEqual(out.containerDefinitions[0].linuxParameters,{capabilities:{drop:['ALL']},initProcessEnabled:true});
  assert.deepEqual(out.containerDefinitions[0].command,copy.containerDefinitions[0].command);
  assert.equal(out.containerDefinitions[0].image,copy.containerDefinitions[0].image);
  assert.deepEqual(out.containerDefinitions[0].environment,copy.containerDefinitions[0].environment);
});
test('nonempty added capability/device/tmpfs, unknown settings or non-arrays are never stripped or accepted',()=>{
  for(const change of [p=>p.capabilities.add.push('SYS_ADMIN'),p=>p.devices.push({hostPath:'/dev/anything'}),p=>p.tmpfs.push({containerPath:'/tmp'}),
    p=>p.sharedMemorySize=1,p=>p.capabilities.other=[],p=>p.devices=null,p=>delete p.tmpfs]){
    const d=fixture();change(d.containerDefinitions[0].linuxParameters);assert.throws(()=>normalizeDefaultArrays(d));}
});
test('inspection entry has no mutation command, uses original runtime validator and rejects malformed arguments before I/O',async()=>{
  await assert.rejects(main(['RunReviewed','wrong','extra']),/INSPECT_ARGUMENTS/);
  const text=await readFile(new URL('../ops/platform-hosted-deploy-v6/inspect-defaults.mjs',import.meta.url),'utf8');
  assert.match(text,/runtime\(\{\.\.\.args,definition:normalizeDefaultArrays\(args\.definition\)\}\)/);
  assert.doesNotMatch(text,/CreateStackCommand|UpdateStackCommand|DeleteStackCommand|GetSecretValueCommand|\.create\(|\.startWrites\(|\.putPolicy\(/);
  assert.match(text,/same\(await sourcePins\(\),m.pins\)/);assert.match(text,/result.cloudWrites===0/);
});
