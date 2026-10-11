import { readFile, writeFile, realpath, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { compileCellLaunchReadinessV1, PUBLISHED_F3_IMAGES_V1 as pins } from "../../../lib/deployments/execution/cell-launch-readiness-v1.ts";
const root=await realpath("F:/ChatGPT_workshop"),out=path.resolve(process.argv[2]??""),hash=b=>createHash("sha256").update(b).digest("hex");
if(process.argv.length!==3||(await realpath(path.dirname(out))).toLowerCase()!==root.toLowerCase()||!/^techlong-f3c1-cell-launch-[a-z0-9-]+$/.test(path.basename(out)))throw Error("CELL_LAUNCH_FRESH_PRIVATE_OUTPUT_REQUIRED");await mkdir(out);
const read=async(p,sha)=>{const b=await readFile(path.join(root,p));if(sha&&hash(b)!==sha)throw Error("CELL_LAUNCH_EVIDENCE_DRIFT");return{value:JSON.parse(b),fileSha256:hash(b)};};
const evidence=await read("techlong-f3-readonly-20261011-c1/aws-readback.json","06e60020f63da789dd16337c394d5585496702fe2795d34962027dd262a2f93c"),prices=await read("techlong-f3-prices-20261011-c1/selected-prices.json","51af76280a9bb1b3213cc8ed1e2fbf5d342fe3be4e00d0e621e1bd1355c0f9a6"),business=await read("techlong-f3b3-business-install-20261011-r1-verify/independent-inspect.json","1769be4629818725d1d55872e81c5aca9f9f20bc8500c58020a8969b4a986823");
const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1},credentials=await fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config})(),sts=new STSClient({...config,credentials});
try{const i=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});if(i.Account!=="402010193138"||i.Arn!=="arn:aws:iam::402010193138:user/techlong-sandbox-dev")throw Error("CELL_LAUNCH_SOURCE_INVALID");}finally{sts.destroy();}
const execute=promisify(execFile),scans=[];
for(const p of pins){const r=await execute("aws",["ecr","describe-image-scan-findings","--registry-id","402010193138","--repository-name","techlong-sandbox-speedfeast","--image-id",`imageDigest=${p.digest}`,"--region","ca-central-1","--no-cli-pager","--output","json","--no-paginate"],
 {windowsHide:true,timeout:35000,maxBuffer:2000000,env:{...process.env,AWS_PROFILE:undefined,AWS_ACCESS_KEY_ID:credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:credentials.secretAccessKey,AWS_SESSION_TOKEN:credentials.sessionToken,AWS_MAX_ATTEMPTS:"1",AWS_IGNORE_CONFIGURED_ENDPOINT_URLS:"true",AWS_PAGER:""}});
 const scan=JSON.parse(r.stdout);if(scan.registryId!=="402010193138"||scan.repositoryName!=="techlong-sandbox-speedfeast"||scan.imageId?.imageDigest!==p.digest||!scan.imageScanFindings?.findingSeverityCounts||typeof scan.imageScanFindings.findingSeverityCounts!=="object")throw Error("CELL_LAUNCH_IMAGE_SCAN_MISMATCH");
 scans.push({kind:p.kind,digest:p.digest,status:scan.imageScanStatus?.status,high:scan.imageScanFindings?.findingSeverityCounts?.HIGH??0,critical:scan.imageScanFindings?.findingSeverityCounts?.CRITICAL??0,scanCompletedAt:scan.imageScanFindings?.imageScanCompletedAt});
}
const result={...compileCellLaunchReadinessV1(evidence.value,prices.value,scans,business.value.installationVerified===true),observedAt:new Date().toISOString(),evidenceFileSha256:evidence.fileSha256,priceFileSha256:prices.fileSha256,businessInspectionFileSha256:business.fileSha256,scans};
const b=JSON.stringify(result,null,2)+"\n";await writeFile(path.join(out,"cell-launch-review.json"),b,{flag:"wx"});console.log(JSON.stringify({out,fileSha256:hash(b),outcome:result.outcome,blockers:result.blockers,estimate:result.estimate,scans,deploymentAuthorized:false}));
