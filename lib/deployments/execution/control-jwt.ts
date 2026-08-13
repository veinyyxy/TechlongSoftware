import {
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";

import type { SaaSControlTokenProvider } from "./control-client.ts";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,255}$/;

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertHttpsIssuer(value: string): void {
  let issuer: URL;
  try {
    issuer = new URL(value);
  } catch {
    throw new Error("SaaS control JWT issuer must be an HTTPS URL.");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new Error("SaaS control JWT issuer must be an HTTPS URL.");
  }
}

export interface Rs256SaaSControlTokenProviderOptions {
  issuer: string;
  subject: string;
  privateKeyPem: string;
  keyId?: string;
  lifetimeSeconds?: number;
  now?: () => number;
  jti?: () => string;
}

/** Issues short-lived, instance-bound control tokens using RS256 only. */
export class Rs256SaaSControlTokenProvider
  implements SaaSControlTokenProvider
{
  private readonly issuer: string;
  private readonly subject: string;
  private readonly privateKey: KeyObject;
  private readonly keyId?: string;
  private readonly lifetimeSeconds: number;
  private readonly now: () => number;
  private readonly jti: () => string;

  constructor(options: Rs256SaaSControlTokenProviderOptions) {
    const issuer = options.issuer.trim();
    const subject = options.subject.trim();
    assertHttpsIssuer(issuer);
    if (!identifierPattern.test(subject)) {
      throw new Error("SaaS control JWT subject is invalid.");
    }
    const lifetimeSeconds = options.lifetimeSeconds ?? 60;
    if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 10 || lifetimeSeconds > 120) {
      throw new Error("SaaS control JWT lifetime must be 10-120 seconds.");
    }
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey(options.privateKeyPem);
    } catch {
      throw new Error("SaaS control RS256 private key is invalid.");
    }
    if (
      privateKey.asymmetricKeyType !== "rsa" ||
      (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw new Error(
        "SaaS control signing key must be an RSA private key of at least 2048 bits.",
      );
    }
    const keyId = options.keyId?.trim();
    if (keyId && !/^[A-Za-z0-9._-]{3,128}$/.test(keyId)) {
      throw new Error("SaaS control JWT key id is invalid.");
    }
    this.issuer = issuer;
    this.subject = subject;
    this.privateKey = privateKey;
    this.keyId = keyId;
    this.lifetimeSeconds = lifetimeSeconds;
    this.now = options.now ?? Date.now;
    this.jti = options.jti ?? randomUUID;
  }

  async issue(input: {
    instanceId: string;
    audience: string;
    scope: "speedfeast:control";
    signal: AbortSignal;
  }): Promise<string> {
    input.signal.throwIfAborted();
    if (!identifierPattern.test(input.instanceId)) {
      throw new Error("SaaS control JWT instance id is invalid.");
    }
    if (input.audience !== `speedfeast-instance:${input.instanceId}`) {
      throw new Error("SaaS control JWT audience is not bound to the instance.");
    }
    if (input.scope !== "speedfeast:control") {
      throw new Error("SaaS control JWT scope is invalid.");
    }
    input.signal.throwIfAborted();
    const issuedAt = Math.floor(this.now() / 1_000);
    const tokenId = this.jti();
    input.signal.throwIfAborted();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(tokenId)) {
      throw new Error("SaaS control JWT id is invalid.");
    }
    const header = base64UrlJson({
      alg: "RS256",
      typ: "JWT",
      ...(this.keyId ? { kid: this.keyId } : {}),
    });
    const payload = base64UrlJson({
      iss: this.issuer,
      aud: input.audience,
      sub: this.subject,
      instance_id: input.instanceId,
      scope: input.scope,
      iat: issuedAt,
      exp: issuedAt + this.lifetimeSeconds,
      jti: tokenId,
    });
    const signingInput = `${header}.${payload}`;
    input.signal.throwIfAborted();
    const signature = sign("RSA-SHA256", Buffer.from(signingInput), this.privateKey)
      .toString("base64url");
    input.signal.throwIfAborted();
    return `${signingInput}.${signature}`;
  }
}
