// Render candidates only; do not write .github/workflows or change role trust.
import {recoveryCloudWorkflows} from '../platform-recovery-cloud-v1/workflows.mjs';
import {must} from './contract.mjs';
import {A604_PUBLICATION} from './profile.mjs';
export function a604CloudWorkflows(pins,{publication=A604_PUBLICATION}={}){
  const old=recoveryCloudWorkflows(pins),needle='      - run: node --experimental-strip-types ops/platform-recovery-cloud-v1/run.mjs';
  must(old.reusable.split(needle).length===2,'WORKFLOW_SHAPE');
  const template=structuredClone(publication);
  if(template.state==='PUBLISHED'){
    must(template.frozenSourceCommit===pins.sourceCommit&&template.release?.closureSha256===pins.closureSha256&&
      template.release.identityProofSha256===pins.identityProofSha256,'WORKFLOW_PUBLICATION_PINS');
    template.sourceCommit=null;template.release.reusableCommit=null;template.activation.sourceCommit=null;template.activation.releaseSha256=null;
  }
  const code=["import {bindA604WorkflowPublication} from './ops/platform-a604-cloud-v1/contract.mjs';",
    "import {a604CloudClosure} from './ops/platform-a604-cloud-v1/closure.mjs';",
    "import {a604Runtime} from './ops/platform-a604-cloud-v1/live.mjs';",
    'const template = '+JSON.stringify(template)+';',
    'try {',
    '  const publication = await bindA604WorkflowPublication(template,process.env.GITHUB_SHA,process.env.TECHLONG_REUSABLE_COMMIT);',
    '  console.log(JSON.stringify(await a604Runtime(process.env,await a604CloudClosure(),{publication})));',
    "} catch { console.error('A604_CLOUD_STOPPED_REQUIRES_INSPECT_NO_RETRY'); process.exitCode=1; }"];
  const bootstrap="      - run: |\n          node --experimental-strip-types --input-type=module <<'A604_BOOTSTRAP'\n"+
    code.map(line=>'          '+line).join('\n')+'\n          A604_BOOTSTRAP';
  return {...old,reusable:old.reusable.replace(needle,bootstrap),published:false,
    jobId:'job_a60423b885fef3e4326213f7',requiresSeparatePublicationApproval:true,requiresSeparateTrustApproval:true,
    requiresSeparateFactsWindowApproval:true};
}
