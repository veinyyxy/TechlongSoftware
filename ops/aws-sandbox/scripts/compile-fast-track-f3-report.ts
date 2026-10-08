import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { compileFastTrackF3Readiness } from "../../../lib/deployments/execution/fast-track-f3-readiness.ts";
const [evidenceFile, priceFile, artifactFile, outputFile] = process.argv.slice(2);
const root = fs.realpathSync("F:/ChatGPT_workshop");
for (const file of [evidenceFile, priceFile, artifactFile, outputFile]) {
  if (!file || !path.isAbsolute(file) || path.dirname(fs.realpathSync(path.dirname(file))) !== root) throw new Error("Require direct evidence-subdirectory files");
}
if (path.basename(outputFile) !== "f3-assessment.json") throw new Error("Wrong output filename");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const evidenceBytes = fs.readFileSync(evidenceFile), priceBytes = fs.readFileSync(priceFile), artifactBytes = fs.readFileSync(artifactFile);
const evidence = JSON.parse(evidenceBytes.toString()), prices = JSON.parse(priceBytes.toString()), artifacts = JSON.parse(artifactBytes.toString());
const verified = artifacts.outcome === "ORIGINAL_CANDIDATES_VERIFIED_NOT_PUBLISHED" && artifacts.cloudMutationPerformed === false &&
  artifacts.registryManifestDigestVerified === false && artifacts.images?.length === 2 && artifacts.images.every((i: { originalReceiptBytesVerified: boolean }) => i.originalReceiptBytesVerified === true);
const assessment = compileFastTrackF3Readiness(evidence, prices, verified);
const result = { ...assessment, at: new Date().toISOString(), evidenceSha256: sha(evidenceBytes), priceEvidenceSha256: sha(priceBytes),
  artifactEvidenceSha256: sha(artifactBytes), diagnosticsAreApproval: false,
  imageCandidateSourceCommit: artifacts.sourceCommit, candidateRunId: artifacts.candidateRunId };
const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
fs.writeFileSync(outputFile, bytes, { flag: "wx" });
process.stdout.write(JSON.stringify({ outcome: result.outcome, blockers: result.blockers, estimate: result.estimate,
  output: outputFile, sha256: sha(bytes), deploymentAuthorized: false }) + "\n");
