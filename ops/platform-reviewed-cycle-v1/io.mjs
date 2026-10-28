// Compose existing bounded adapters; no credential/file content read on import.
import {createContinuousIo} from '../platform-a604-operator-v1/continuous-io.mjs';
import {absent,writeOnce,git} from '../platform-image-source-v2/files.mjs';
import {must} from './cycle.mjs';
export function createWholeCycleIo({composition:c,manifest:m,output,record,assertSource,verifyCi}){
  const adapters=new Map(),scopedRecord=prefix=>(n,v)=>record(prefix+'-'+n,v);let token;
  const auth=()=>{if(!token){let raw=git(['credential','fill'],'protocol=https\nhost=github.com\npath=veinyyxy/TechlongSoftware.git\n\n');
    token=raw.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);raw=undefined;must(token,'GITHUB_READ_AUTH');}return token;};
  const adapter=mode=>{
    if(!adapters.has(mode))adapters.set(mode,createContinuousIo({manifest:m.continuous,output,record:scopedRecord(mode.toLowerCase()),
      policy:c.policy,assertSource,verifyCi,capability:c.capability}));
    return adapters.get(mode);
  };
  return {record,assertSource,verifyCi,
    async assertUnused(){for(const f of Object.values(c.slots))await absent(f);},
    claim:v=>writeOnce(c.slots.whole,{...v,output,consumedAt:Date.now(),retryAllowed:false}),
    async continuousIo(guard){const a=adapter('Review');return {...a,assertSource:guard};},
    dispatch:(mode,plan,guard)=>adapter(mode).dispatch(mode,plan.planSha256,guard),
    wait:(ack,guard)=>adapter(ack.mode).waitReview(ack,Math.min(Date.now()+20*60000,m.expiresAt),guard),
    capture:(ack,run,guard)=>adapter(ack.mode).capture(ack,run,guard),
    publisherIo:(inner,captured,guard)=>c.capability.publisherIo({manifest:inner,
      packageValue:captured.objects.find(o=>o.reference.key===c.publication.packageReference.key).object.value,
      record:scopedRecord('inspect-publisher'),assertSource:guard,verifyCi,
      claim:v=>writeOnce(c.slots.inspectPublish,{...v,outerSha256:m.manifestSha256,output,consumedAt:Date.now(),retryAllowed:false}),
      githubToken:auth}),
    async close(){try{for(const [mode,a] of adapters)if(mode!=='Review')await a.close();}finally{token=undefined;}},
  };
}
