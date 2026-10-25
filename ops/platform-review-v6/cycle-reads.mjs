// Operator-only replacement read port with pre-redaction stage capture.
// Explicit providers only; same fixed GET targets and limits, no discovery/retry.
import {GetObjectCommand} from '@aws-sdk/client-s3';
import {S} from '../platform-cloud-v6/contract.mjs';
import {EVIDENCE_V5 as E,assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {operatorFailure,operatorError} from './operator-failure.mjs';
const must=(ok,code)=>{if(!ok)throw Error('CYCLE_READS_'+code);};
async function bytes(stream,limit){
  const parts=[];let size=0;try{for await(const part of stream){const b=Buffer.from(part);size+=b.length;must(size<=limit,'BODY_SIZE');parts.push(b);}}
  catch(e){try{stream.destroy?.();}catch{/* Never replace the original failure. */}throw e;}return Buffer.concat(parts,size);
}
export function createCycleReads({s3,fetch:request,githubToken,signal=AbortSignal.timeout(120000),onFailure=async()=>{}}){
  must(typeof githubToken==='string'&&githubToken.length>0&&githubToken.length<=16000&&!/[\r\n]/.test(githubToken)&&typeof onFailure==='function','REFERENCE');
  let halted=false;
  async function guarded(initial,fn){
    must(!halted,'REFERENCE');signal.throwIfAborted();let stage=initial,metadata={};
    try{return await fn(v=>{stage=v;},v=>{metadata=v;});}catch(e){
      halted=true;let diagnosticRecordFailed=false;
      try{await onFailure(operatorFailure(e,'READ_PORT',stage,metadata));}catch{diagnosticRecordFailed=true;}
      throw operatorError(e,'READ_PORT',stage,{...metadata,diagnosticRecordFailed});
    }
  }
  return Object.freeze({
    readObject:r=>guarded('REFERENCE',async(stage,metadata)=>{
      must(r&&Object.keys(r).sort().join(',')==='key,sha256,versionId'&&typeof r.key==='string'&&r.key.startsWith(`worker-v5/${S.instanceId}/`)&&
        /^[A-Za-z0-9/_.-]+$/.test(r.key)&&!r.key.includes('..')&&/^[a-f0-9]{64}$/.test(r.sha256)&&
        typeof r.versionId==='string'&&/^[A-Za-z0-9._-]{1,256}$/.test(r.versionId),'REFERENCE');
      stage('S3_SEND');const o=await s3.send(new GetObjectCommand({Bucket:E.bucket,ExpectedBucketOwner:E.owner,Key:r.key,VersionId:r.versionId}),
        {abortSignal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
      metadata({httpStatus:o.$metadata?.httpStatusCode,sdkAttempts:o.$metadata?.attempts});stage('S3_METADATA');
      must(o.VersionId===r.versionId&&o.ServerSideEncryption==='AES256'&&Number.isSafeInteger(o.ContentLength)&&o.ContentLength>0&&o.ContentLength<=1000000&&o.Body,'METADATA');
      stage('S3_BODY');const raw=await bytes(o.Body,1000000);must(raw.length===o.ContentLength,'BODY_LENGTH');
      stage('S3_JSON');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      stage('S3_SAFETY');assertEvidenceSafeV5(value);stage('S3_DIGEST');must(await sha256Hex(value)===r.sha256,'HASH');
      return {value,versionId:o.VersionId,encryption:o.ServerSideEncryption,contentLength:o.ContentLength};
    }),
    readRun:id=>guarded('GITHUB_REFERENCE',async(stage,metadata)=>{
      must(typeof id==='string'&&/^[1-9][0-9]{0,15}$/.test(id),'GITHUB_ID');stage('GITHUB_SEND');
      const r=await request(`https://api.github.com/repos/${S.repository}/actions/runs/${id}`,{method:'GET',redirect:'error',cache:'no-store',
        headers:{authorization:'Bearer '+githubToken,accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Techlong-Reviewed-Cycle'},
        signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      metadata({httpStatus:r.status});stage('GITHUB_STATUS');must(r.status===200&&r.body,'GITHUB_STATUS');
      stage('GITHUB_BODY');const raw=await bytes(r.body,256000);stage('GITHUB_JSON');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    }),
    dispose(){halted=true;githubToken=undefined;},
  });
}
