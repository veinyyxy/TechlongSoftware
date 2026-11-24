const required = Object.freeze({
  use_default: true,
  use_immutable_subject: true,
  sub_claim_prefix: "repo:veinyyxy@14145707/TechlongSoftware@1323312747",
});

// Accept only the four-field projection of a bound source. Under GitHub's
// default template, an omitted custom-claim list has no effect. This is a
// metadata check, not proof of an issued token or permission to run.
export function firstOpenGitHubOidcFieldsMatch(projection) {
  const { missingFields, mismatchedFields } = projection ?? {};
  return Array.isArray(mismatchedFields) && mismatchedFields.length === 0 &&
    Array.isArray(missingFields) && (missingFields.length === 0 ||
      (missingFields.length === 1 && missingFields[0] === "include_claim_keys"));
}

export function firstOpenGitHubOidcMatches(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  const missingFields = [], mismatchedFields = [];
  for (const [key, expected] of Object.entries(required)) {
    if (!Object.hasOwn(response, key)) missingFields.push(key);
    else if (response[key] !== expected) mismatchedFields.push(key);
  }
  if (!Object.hasOwn(response, "include_claim_keys")) missingFields.push("include_claim_keys");
  else {
    const claims = response.include_claim_keys;
    if (claims !== null && !(Array.isArray(claims) && claims.length === 0)) mismatchedFields.push("include_claim_keys");
  }
  return firstOpenGitHubOidcFieldsMatch({ missingFields, mismatchedFields });
}
