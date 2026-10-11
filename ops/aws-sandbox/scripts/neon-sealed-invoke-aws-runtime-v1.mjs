import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { createNeonSealedUpdateAwsRuntimeV1 } from "./neon-sealed-update-aws-runtime-v1.mjs";
import { NEON_INVOKE_PREDECESSOR_V1 as pin, matchNeonSealedInvokeInventoryV1 } from "../../../lib/deployments/execution/readonly-neon-sealed-invoke-v1.ts";
import { NEON_SEALED_PROBE_FUNCTION_ARN_V1 as arn } from "../../../lib/deployments/execution/readonly-neon-sealed-probe-v1.ts";
const config={region:"ca-central-1",ignoreConfiguredEndpointUrls:true,maxAttempts:1},sourceArn="arn:aws:iam::402010193138:user/techlong-sandbox-dev";
export function createNeonSealedInvokeAwsRuntimeV1(oldInstallManifest){
  const base=createNeonSealedUpdateAwsRuntimeV1(oldInstallManifest,{zipSha256:pin.installedZipSha256,zipBytes:pin.installedZipBytes});
  const permission=async()=>{
    const credentials=await fromLoginCredentials({profile:"techlong-sandbox-user",ignoreCache:true,clientConfig:config})(),sts=new STSClient({...config,credentials});
    try{const i=await sts.send(new GetCallerIdentityCommand({}),{abortSignal:AbortSignal.timeout(15000)});if(i.Account!=="402010193138"||i.Arn!==sourceArn)throw new Error("NEON_INVOKE_SOURCE_IDENTITY_INVALID");}finally{sts.destroy();}
    const iam=new IAMClient({...config,credentials});try{const r=await iam.send(new SimulatePrincipalPolicyCommand({PolicySourceArn:sourceArn,ActionNames:["lambda:InvokeFunction"],ResourceArns:[arn],MaxItems:100}),{abortSignal:AbortSignal.timeout(15000)});
      if(r.IsTruncated||r.Marker||r.EvaluationResults?.length!==1)throw new Error("NEON_INVOKE_SOURCE_SIMULATION_INCOMPLETE");
      return {action:"lambda:InvokeFunction",resource:arn,decision:r.EvaluationResults[0].EvalDecision};
    }finally{iam.destroy();}
  };
  const inventory=async(withPermission=false)=>{
    const check=withPermission?await permission():null,r=await base.inventory(true,false);
    const value={...r,sourcePermissionsAllowed:check?.decision==="allowed",permissionChecks:check?[check]:[]};matchNeonSealedInvokeInventoryV1(value);return value;
  };
  const bridge=m=>({reviewedAt:m.reviewedAt,expiresAt:m.expiresAt,event:m.event,artifact:{zipSha256:pin.installedZipSha256,zipBytes:pin.installedZipBytes}});
  // Deliberately expose only reads, exact synchronous Invoke, and safe log proof. No update option/port.
  return Object.freeze({inventory,
    invokeOnce:async m=>{
      const r=await inventory(false);if(r.predecessorAnchorSha256!==m.fullAnchorSha256||r.revisionId!==m.completedRevisionId)throw new Error("NEON_INVOKE_IMMEDIATE_PRESTATE_DRIFT");
      return base.invokeOnce(bridge(m),m.completedRevisionId);
    },
    logProof:(m,response)=>base.logProof(bridge(m),response),
  });
}
