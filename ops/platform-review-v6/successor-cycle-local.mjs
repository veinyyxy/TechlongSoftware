import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {executeCycleMain,CYCLE_ROOTS} from './cycle-local.mjs';
import {SUCCESSOR_CYCLE,SUCCESSOR_SLOTS,SUCCESSOR_REVIEW,parseSuccessorCycleArgs,makeSuccessorReview,validateSuccessorReview,
  assertSuccessorOnline,successorReadiness} from './successor-cycle.mjs';
import {loadSuccessorPreparation,verifySuccessorCurrent} from './successor-preparation.mjs';
import {assertNextAvailable} from './cycle-next.mjs';
export const SUCCESSOR_ROOTS=[...CYCLE_ROOTS,'ops/platform-review-v6/successor-cycle-local.mjs','ops/platform-review-v6/successor-cycle.mjs',
  'ops/platform-review-v6/successor-preparation.mjs','ops/platform-review-v6/successor-collect-local.mjs',
  'tests/platform-successor-cycle-v6.test.mjs','tests/fixtures/platform-successor-cycle-v6.mjs',SUCCESSOR_CYCLE.riskFile];
const PROTOCOL=Object.freeze({cycle:SUCCESSOR_CYCLE,roots:SUCCESSOR_ROOTS,parseArgs:parseSuccessorCycleArgs,makeReview:makeSuccessorReview,validateReview:validateSuccessorReview,
  loadPreparation:loadSuccessorPreparation,verifyCurrent:verifySuccessorCurrent,reviewProfile:SUCCESSOR_REVIEW,outputPrefix:'techlong-w8z-hosted-cycle-',...SUCCESSOR_SLOTS,
  assertOnline:assertSuccessorOnline,assertAvailable:assertNextAvailable,preconfirmedReadiness:successorReadiness});
export async function main(args=process.argv.slice(2)){return executeCycleMain(args,PROTOCOL);}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('HOSTED_SUCCESSOR_CYCLE_STOPPED_NO_RETRY');process.exitCode=1;
});
