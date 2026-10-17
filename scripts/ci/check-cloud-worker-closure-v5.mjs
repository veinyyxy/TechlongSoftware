import { computeCloudClosureV5 } from '../../ops/cloud-worker/closure-v5.mjs';
console.log(JSON.stringify(await computeCloudClosureV5(), null, 2));
