import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {executeCycleMain,CYCLE_ROOTS} from './cycle-local.mjs';
import {LAUNCH,LAUNCH_SLOTS,parseLaunchArgs,makeLaunchReview,validateLaunchReview,assertLaunchOnline,preconfirmedReadiness} from './cycle-launch.mjs';
import {assertNextAvailable} from './cycle-next.mjs';
import {loadLaunchPreparation,verifyLaunchCurrent} from './cycle-launch-preparation.mjs';
export const LAUNCH_ROOTS=[...CYCLE_ROOTS,'ops/platform-review-v6/cycle-launch-local.mjs','ops/platform-review-v6/cycle-launch.mjs',
  'ops/platform-review-v6/cycle-launch-preparation.mjs','tests/platform-cycle-launch-v6.test.mjs',LAUNCH.riskFile];
const PROTOCOL=Object.freeze({cycle:LAUNCH,roots:LAUNCH_ROOTS,parseArgs:parseLaunchArgs,makeReview:makeLaunchReview,validateReview:validateLaunchReview,
  loadPreparation:loadLaunchPreparation,verifyCurrent:verifyLaunchCurrent,outputPrefix:'techlong-w8w-hosted-cycle-',...LAUNCH_SLOTS,
  assertOnline:assertLaunchOnline,assertAvailable:assertNextAvailable,preconfirmedReadiness});
export async function main(args=process.argv.slice(2)){return executeCycleMain(args,PROTOCOL);}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('HOSTED_PRECONFIRMED_CYCLE_STOPPED_NO_RETRY');process.exitCode=1;
});
