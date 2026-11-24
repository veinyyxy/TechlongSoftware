import { createSandboxBuyerForward } from "@/lib/buyer-forward/sandbox-relay";
import { firstOpenBuyerSignerEnvName } from "@/lib/buyer-forward/signer-binding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forward = createSandboxBuyerForward({
  loadSigningKey: () => process.env[firstOpenBuyerSignerEnvName],
  fetchUpstream: (url, options) => fetch(url, options),
});

export const OPTIONS = forward;
export const GET = forward;
export const POST = forward;
