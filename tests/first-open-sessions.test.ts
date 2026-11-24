import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { STSClient } from "@aws-sdk/client-sts";
import { bindFirstOpenSession } from "../ops/aws-sandbox/first-open-sessions.ts";

const account = "402010193138";
const name = "first-open-fc41597f-lifecycle-g1";
const roleId = "AROAV3GNMXTZDIWVT3BKN";
const arn = `arn:aws:sts::${account}:assumed-role/TechlongSandboxTenantLifecycleTaskRole/${name}`;
const observed = { Account: account, Arn: arn, UserId: `${roleId}:${name}` };
const start = Date.UTC(2026, 10, 19, 19);
const signal = () => new AbortController().signal;

function fixture(answer = observed, expiresAt = start + 900_000) {
  let time = start, sources = 0, reads = 0, closed = 0;
  const sample = { accessKeyId: "fixture", secretAccessKey: "fixture", sessionToken: "fixture", expiration: new Date(expiresAt) };
  const binding = bindFirstOpenSession("lifecycle", async () => { sources++; return sample; },
    start + 600_000, () => time, () => ({
      send: (async (command: { constructor: { name: string } }) => {
        assert.equal(command.constructor.name, "GetCallerIdentityCommand");
        reads++;
        return answer;
      }) as STSClient["send"],
      destroy() { closed++; },
    }));
  return { binding, sample, setNow: (next: number) => { time = next; }, counts: () => [sources, reads, closed] };
}

test("one exact STS session snapshot is reused and stops at the approved cutoff", async () => {
  const { binding, sample, counts, setNow } = fixture();
  assert.deepEqual(counts(), [0, 0, 0]);
  assert.deepEqual(await binding.identify(signal()), { accountId: account, arn, roleId, credentialExpiresAt: start + 900_000 });
  const snap = await binding.credentials(signal());
  snap.expiration.setTime(start + 3_600_000);
  sample.expiration.setTime(start + 3_600_000);
  assert.equal((await binding.credentials(signal())).expiration.getTime(), start + 900_000);
  setNow(start + 600_000);
  await assert.rejects(binding.credentials(signal()), /FIXED_SESSION_UNPROVED/);
  assert.deepEqual(counts(), [1, 1, 1]);
});

test("same role name is insufficient: old ECS session, wrong RoleId and short expiry fail without retry", async () => {
  for (const f of [
    fixture({ ...observed, Arn: arn.replace(name, "legacy-ecs"), UserId: roleId + ":legacy-ecs" }),
    fixture({ ...observed, UserId: "AROADIFFERENTROLE:" + name }),
    fixture({ ...observed, Account: "999999999999" }),
    fixture(observed, start + 599_999),
  ]) {
    await assert.rejects(f.binding.identify(signal()), /FIXED_SESSION_UNPROVED/);
    await assert.rejects(f.binding.credentials(signal()), /FIXED_SESSION_UNPROVED/);
    assert.deepEqual(f.counts(), [1, 1, 1]);
  }
});

test("both sealed IAM selectors cover single and batch reads; missing selectors cannot be treated as evidence", () => {
  // Deliberately a local predicate test, not an effective AWS policy simulation.
  const { firstOpenLifecycleLockedDenies } = createRequire(import.meta.url)("../ops/aws-sandbox/scripts/first-open-lifecycle-iam-delta.mjs") as {
    firstOpenLifecycleLockedDenies(): { Effect: string; Action: string | string[]; Resource: string; Condition: { StringEquals: Record<string, string> } }[];
  };
  const rules = firstOpenLifecycleLockedDenies();
  assert.equal(rules.length, 4);
  const subject = "token.actions.githubusercontent.com:sub";
  const blocked = (action: string, context: Record<string, string>) => rules.some(s => s.Effect === "Deny" && s.Resource === "*" &&
    [s.Action].flat().includes(action) && Object.entries(s.Condition.StringEquals).every(([k, v]) => context[k] === v));
  for (const action of ["secretsmanager:GetSecretValue", "secretsmanager:BatchGetSecretValue", "rds-db:connect"]) {
    assert.equal(blocked(action, { "aws:userid": observed.UserId }), true);
    assert.equal(blocked(action, { [subject]: "repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy" }), true);
    assert.equal(blocked(action, { "aws:userid": roleId + ":legacy-ecs" }), false);
    assert.equal(blocked(action, {}), false);
  }
});
