import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../ops/aws-sandbox/scripts/inspect-failed-cell-birth-installation-stop-v4.mjs", import.meta.url), "utf8");
test("post-stop inspector only reads original evidence and SERIALIZABLE READ ONLY database state", () => {
  assert.match(source, /SERIALIZABLE READ ONLY DEFERRABLE/); assert.match(source, /rejectUnauthorized: true/);
  assert.doesNotMatch(source, /runReviewedFailedBirthInstallationV4|compileFailedBirthInstallReviewV4|claimPermanentSlot|GetSecretValueCommand|InvokeCommand|SET ROLE|CREATE TABLE|ALTER ROLE|DROP TABLE|GRANT EXECUTE/);
  assert.match(source, /databaseWritesThisInspector: 0/); assert.match(source, /retryAuthorized: false/);
});
test("rollback acceptance requires exact approved prestate and unchanged consumed slot/receipt/code, not absent table alone", () => {
  assert.match(source, /read\.stateSha256 === review\.prestateSha256/); assert.match(source, /canonicalJson\(read\.state\) === canonicalJson\(review\.reviewedState\)/);
  assert.match(source, /receipt\.commitAttempted !== false/); assert.match(source, /slot\.retryAuthorized !== false/); assert.match(source, /old\.pins\.length !== 68/);
  assert.match(source, /flag: "wx"/); assert.doesNotMatch(source, /unlink|rmSync|deleteFile|retry-slot|--approved-sha/);
});
test("PG18 metadata diagnosis remains an inference and never converts a failed install to runtime proof", () => {
  assert.match(source, /k\.contype='n'/); assert.match(source, /SUPPORTED_NOT_UNIQUE_CAUSE_PROOF/);
  assert.match(source, /stoppedTransactionCatalogNotPersisted: true/); assert.match(source, /originalCommitConfirmed: false/); assert.match(source, /runtimeEnabled: false/);
});
