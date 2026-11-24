import assert from "node:assert/strict";
import test from "node:test";
import { firstOpenGitHubOidcFieldsMatch, firstOpenGitHubOidcMatches } from "../ops/aws-sandbox/first-open-github-oidc-preflight.mjs";

const exactDefault = {
  use_default: true,
  use_immutable_subject: true,
  sub_claim_prefix: "repo:veinyyxy@14145707/TechlongSoftware@1323312747",
};

test("first-open OIDC accepts omitted custom claims only for the exact immutable default template", () => {
  assert.equal(firstOpenGitHubOidcMatches(exactDefault), true);
  for (const value of [null, []]) {
    assert.equal(firstOpenGitHubOidcMatches({ ...exactDefault, include_claim_keys: value }), true);
  }
  for (const [key, wrong] of [
    ["use_default", false],
    ["use_immutable_subject", false],
    ["sub_claim_prefix", "repo:veinyyxy@14145707/TechlongSoftware@1323312748"],
  ]) {
    const absent = { ...exactDefault };
    delete absent[key];
    assert.equal(firstOpenGitHubOidcMatches(absent), false, `missing ${key}`);
    assert.equal(firstOpenGitHubOidcMatches({ ...exactDefault, [key]: wrong }), false, `wrong ${key}`);
  }
  for (const claims of [["repo"], "", {}, false, undefined]) {
    assert.equal(firstOpenGitHubOidcMatches({ ...exactDefault, include_claim_keys: claims }), false);
  }
});

test("saved diagnosis can clear only the missing custom list, not any other difference", () => {
  const missingFields = ["include_claim_keys"];
  assert.equal(firstOpenGitHubOidcFieldsMatch({ missingFields, mismatchedFields: [] }), true);
  assert.equal(firstOpenGitHubOidcFieldsMatch({ missingFields: [...missingFields, "use_default"], mismatchedFields: [] }), false);
  assert.equal(firstOpenGitHubOidcFieldsMatch({ missingFields, mismatchedFields: ["sub_claim_prefix"] }), false);
  assert.equal(firstOpenGitHubOidcFieldsMatch({ missingFields }), false);
});
