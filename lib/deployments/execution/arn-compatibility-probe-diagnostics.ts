/** Only allowlisted scalar fields cross the receipt boundary. Never serialize errors. */
const codes = {
  AccessDenied: "AUTHORIZATION_DENIED", AccessDeniedException: "AUTHORIZATION_DENIED", UnauthorizedOperation: "AUTHORIZATION_DENIED",
  ExpiredToken: "AUTHENTICATION_FAILED", ExpiredTokenException: "AUTHENTICATION_FAILED", InvalidClientTokenId: "AUTHENTICATION_FAILED",
  UnrecognizedClientException: "AUTHENTICATION_FAILED", SignatureDoesNotMatch: "AUTHENTICATION_FAILED",
  Throttling: "THROTTLED", ThrottlingException: "THROTTLED", RequestLimitExceeded: "THROTTLED", TooManyRequestsException: "THROTTLED",
  ChangeSetNotFoundException: "NOT_FOUND", ResourceNotFoundException: "NOT_FOUND",
  ValidationError: "VALIDATION_FAILED", ValidationException: "VALIDATION_FAILED",
  AbortError: "CANCELLED", TimeoutError: "TIMEOUT_UNCERTAIN", RequestTimeout: "TIMEOUT_UNCERTAIN",
  ETIMEDOUT: "TRANSPORT_UNCERTAIN", ECONNRESET: "TRANSPORT_UNCERTAIN", ENOTFOUND: "TRANSPORT_UNCERTAIN",
} as const;
export type ArnProbeFailurePhase = "ENTRY" | "GRANT_CREATE" | "GRANT_EXECUTE" | "GRANT_SETTLEMENT" | "SOURCE_FIXTURE" | "OPERATOR_IDENTITY" |
  "OPERATOR_READINESS" | "PROBE_DELETE" | "REVOKE_CREATE" | "REVOKE_EXECUTE" | "REVOKE_VERIFY" | "POST_PROBE_READ";
function field(value: unknown, key: string): unknown {
  try { return value && (typeof value === "object" || typeof value === "function") ? Reflect.get(value, key) : undefined; }
  catch { return undefined; }
}
export function arnProbeSafeRequestId(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : null;
}
export function sanitizeArnProbeFailure(error: unknown, phase: ArnProbeFailurePhase, now = Date.now) {
  const name = field(error, "name"), alternate = field(error, "code");
  const known = (value: unknown): value is keyof typeof codes => typeof value === "string" && Object.hasOwn(codes, value);
  const code = known(name) ? name : known(alternate) ? alternate : null;
  const metadata = field(error, "$metadata"), status = field(metadata, "httpStatusCode");
  return Object.freeze({ phase, classification: code ? codes[code] : "UNKNOWN_UNCERTAIN" as const, code,
    requestId: arnProbeSafeRequestId(field(metadata, "requestId")),
    httpStatusCode: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    observedAt: new Date(now()).toISOString(), authorizationContextObserved: false as const, retryAuthorized: false as const });
}
export type ArnProbeFailure = ReturnType<typeof sanitizeArnProbeFailure>;
