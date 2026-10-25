// Fixed Windows successor entry, not selected through manifest data or env.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {executeCycleMain,CYCLE_ROOTS} from './cycle-local.mjs';
import {NEXT_CYCLE,NEXT_SLOTS,parseNextArgs,makeNextCycleReview,validateNextCycleReview,assertNextOnline,assertNextAvailable} from './cycle-next.mjs';
import {loadNextPreparation,verifyNextCurrent} from './cycle-next-preparation.mjs';
export const NEXT_ROOTS=[...CYCLE_ROOTS,'ops/platform-review-v6/cycle-next.mjs','ops/platform-review-v6/cycle-next-preparation.mjs',
  'ops/platform-review-v6/cycle-next-local.mjs','tests/platform-cycle-next-v6.test.mjs',NEXT_CYCLE.riskFile];
const PROTOCOL=Object.freeze({cycle:NEXT_CYCLE,roots:NEXT_ROOTS,parseArgs:parseNextArgs,makeReview:makeNextCycleReview,
  validateReview:validateNextCycleReview,loadPreparation:loadNextPreparation,verifyCurrent:verifyNextCurrent,
  outputPrefix:'techlong-w8v-hosted-cycle-',...NEXT_SLOTS,assertOnline:assertNextOnline,assertAvailable:assertNextAvailable});
export async function main(args=process.argv.slice(2)){return executeCycleMain(args,PROTOCOL);}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('HOSTED_NEXT_CYCLE_ENTRY_STOPPED_NO_RETRY');process.exitCode=1;
});
