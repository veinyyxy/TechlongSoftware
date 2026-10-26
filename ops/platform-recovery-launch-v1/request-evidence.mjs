// Fixed original request provenance, not a timestamp selected from a live row.
// Local archive reads only; no configuration content, credentials or network.
import {readText} from '../platform-image-source-v2/files.mjs';
import {hash} from '../platform-recovery-hosting-v1/plan.mjs';
export const ORIGINAL_REQUEST=Object.freeze({
  jobId:'job_9b57b43a6b88f37202b29170',transactionAt:1792970812292,
  approvalSha256:'a1e8cbb0a015d6b933e2a200b0aa8cfc95ce4417dda490b66629dffd11d7f969',
  sourceCommit:'af51deeea382dbee1cb17d45ef21a24de898821d',
  coreSha256:'42ce0fd00f40fc73b77f8d8de1ba4ed4d8ab33b799be2123a322a19f6deee8f3',
  sealFile:'F:/ChatGPT_workshop/techlong-w9f-request-execution-completed-verified-20261025-a.json',
  sealSha256:'64b1ebf45dc66fbbdba4be2feec3d7d7c51bafe7419d908a1ce9ace773c0593f',
  intentFile:'F:/ChatGPT_workshop/techlong-w9f-request-20261025-a-run/request-intent.json',
  intentSha256:'7a9aab930e3b1074913654223035a4b9174b292a971201193eb8f6b553f0cd0b'
});
const must=(v,c)=>{if(!v)throw Error('RECOVERY_REQUEST_EVIDENCE_'+c);};
// A JSON summary is NOT provenance on its own. The production CLI always
// reloads the exact archive below and compares the complete summary before I/O.
export function validateRequestEvidence(e,basis){
  const r=ORIGINAL_REQUEST;
  must(e?.schema==='techlong/original-recovery-request-evidence/v1'&&e.jobId===r.jobId&&e.basisSha256===basis.basisSha256&&
    e.approvalSha256===r.approvalSha256&&e.sourceCommit===r.sourceCommit&&e.coreSha256===r.coreSha256&&
    e.sealFile===r.sealFile&&e.sealSha256===r.sealSha256&&e.intentFile===r.intentFile&&e.intentSha256===r.intentSha256&&
    Number.isSafeInteger(e.transactionAt)&&e.transactionAt>=basis.createdAt&&e.transactionAt<basis.expiresAt&&e.artifactsVerified===12,'SUMMARY');
  return e;
}
export async function loadOriginalRequestEvidence(basis,{read=readText}={}){
  const r=ORIGINAL_REQUEST,raw=await read(r.sealFile,4000000);must(hash(raw)===r.sealSha256,'SEAL_HASH');const s=JSON.parse(raw);
  must(s.outcome==='RECOVERY_HELD_REQUEST_COMMITTED_AND_INDEPENDENTLY_VERIFIED'&&s.newJobId===r.jobId&&
    s.approvedManifestSha256===r.approvalSha256&&s.sourceCommit===r.sourceCommit&&s.coreSha256===r.coreSha256&&
    s.basisSha256===basis.basisSha256&&s.databaseTransactionAt===r.transactionAt&&s.artifacts?.length===12,'SEAL_BINDING');
  for(const a of s.artifacts){must(typeof a.file==='string'&&a.file.startsWith('F:/ChatGPT_workshop/')&&a.file.endsWith('.json'),'ARTIFACT_PATH');
    must(hash(await read(a.file,4000000))===a.rawSha256,'ARTIFACT_HASH');}
  must(s.artifacts.some(a=>a.file===r.intentFile&&a.rawSha256===r.intentSha256),'INTENT_REFERENCE');
  const text=await read(r.intentFile,100000);must(hash(text)===r.intentSha256,'INTENT_HASH');const i=JSON.parse(text);
  must(i.at===r.transactionAt&&i.newJobId===r.jobId&&i.basisSha256===basis.basisSha256&&i.manifestSha256===r.coreSha256&&
    i.stateSha256===basis.stateSha256,'INTENT_BINDING');
  return validateRequestEvidence({schema:'techlong/original-recovery-request-evidence/v1',...r,basisSha256:basis.basisSha256,artifactsVerified:12},basis);
}
