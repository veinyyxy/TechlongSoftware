// Fixed sealed LOCAL inputs only. No production credential or network access.
import {readText} from '../platform-image-source-v2/files.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {HANDOFF} from '../platform-a604-cloud-v1/profile.mjs';
import {must} from './policy.mjs';
const ROOT='F:/ChatGPT_workshop/techlong-a604-handoff-20261027-a';
export async function loadSealedPackageInputs(){
  const sealFile='F:/ChatGPT_workshop/techlong-a604-handoff-verified-20261027-a.json',raw=await readText(sealFile,4000000);
  must(await sha256Hex(raw)===HANDOFF.sealRawSha256,'HANDOFF_SEAL');const seal=JSON.parse(raw),archives=[{file:sealFile,sha256:HANDOFF.sealRawSha256}];
  must(seal.outcome==='TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY'&&seal.rawInventory.length===14,'HANDOFF_RESULT');
  for(const row of seal.rawInventory){must(/^F:\/ChatGPT_workshop\/techlong-[A-Za-z0-9/_.-]+\.json$/.test(row.file)&&!row.file.includes('..'),'ARCHIVE_PATH');
    const raw=await readText(row.file,4000000);must(await sha256Hex(raw)===row.rawSha256,'ARCHIVE_SHA');archives.push({file:row.file,sha256:row.rawSha256});}
  const json=async f=>JSON.parse(await readText(f,4000000));
  const review=await json(ROOT+'/manifest.json'),intent=await json(ROOT+'-run/transfer-intent.json'),after=await json(ROOT+'-inspect/independent-state.json'),
    inspection=await json(ROOT+'-inspect/result.json'),counts=await json(ROOT+'-inspect/counts.json');
  const file='F:/ChatGPT_workshop/techlong-w9f-request-20261025-a/publication-package.json',original=await readText(file,4000000);
  const originalRawSha256=await sha256Hex(original);must(originalRawSha256==='c4762e903f9c9e1d7d4d0683a6ebd72dc6ccefcb067c7134547962627e8df5d5','ORIGINAL_RAW_SHA');
  archives.push({file,sha256:originalRawSha256});
  return {archives,originalPackage:JSON.parse(original),handoff:{review,approved:HANDOFF.operatorSha256,intent,after,inspection,databaseObservedAt:counts.databaseClockSamples[0]}};
}
