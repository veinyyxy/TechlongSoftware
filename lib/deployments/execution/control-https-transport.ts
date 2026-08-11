import https from "node:https";
import type { IncomingMessage } from "node:http";

import {
  assertSaaSControlBaseDomain,
  assertSaaSControlTenantHostname,
  type SaaSControlRequest,
  type SaaSControlTransport,
} from "./control-client.ts";
/*
 * Keep endpoint validation in the transport as well as the higher-level
 * client. This prevents a future caller from using the mTLS transport as a
 * generic HTTPS client to an unrelated host.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_MAX_REQUEST_BYTES = 262_144;

function controlTransportError(code: string, message: string, retryable: boolean): Error {
  return Object.assign(new Error(message), { code, retryable });
}

export function assertPrivateControlUrl(value: string, baseDomain: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw controlTransportError(
      "SAAS_CONTROL_ENDPOINT_REJECTED",
      "SaaS control endpoint URL is invalid.",
      false,
    );
  }
  try {
    assertSaaSControlTenantHostname({ hostname: url.hostname, baseDomain });
  } catch {
    throw controlTransportError(
      "SAAS_CONTROL_ENDPOINT_REJECTED",
      "SaaS control endpoint is outside the configured tenant domain.",
      false,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "8443" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw controlTransportError(
      "SAAS_CONTROL_ENDPOINT_REJECTED",
      "SaaS control endpoint must use the private HTTPS listener on port 8443.",
      false,
    );
  }
  return url;
}

export interface NodeMtlsSaaSControlTransportOptions {
  baseDomain: string;
  clientCertificatePem: string;
  clientPrivateKeyPem: string;
  /**
   * Trust roots for the ALB/server certificate presented to this client.
   * This is not the client-certificate CA configured in the ALB mTLS Trust
   * Store; wiring those two independent trust directions together is invalid.
   */
  trustedCaPem: string;
  privateKeyPassphrase?: string;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

/**
 * Node-only transport for the worker. It fixes SNI and Host to the validated
 * tenant hostname, verifies the server certificate, and never follows 3xx
 * responses.
 */
export class NodeMtlsSaaSControlTransport implements SaaSControlTransport {
  private readonly baseDomain: string;
  private readonly clientCertificatePem: string;
  private readonly clientPrivateKeyPem: string;
  private readonly trustedCaPem: string;
  private readonly privateKeyPassphrase?: string;
  private readonly timeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;

  constructor(options: NodeMtlsSaaSControlTransportOptions) {
    if (
      !options.clientCertificatePem.trim() ||
      !options.clientPrivateKeyPem.trim() ||
      !options.trustedCaPem.trim()
    ) {
      throw new Error("mTLS client certificate, private key, and trusted CA are required.");
    }
    this.baseDomain = assertSaaSControlBaseDomain(options.baseDomain);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    for (const [name, value] of [
      ["timeout", this.timeoutMs],
      ["request body cap", this.maxRequestBytes],
      ["response body cap", this.maxResponseBytes],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 10_485_760) {
        throw new Error(`SaaS control ${name} is outside the allowed range.`);
      }
    }
    this.clientCertificatePem = options.clientCertificatePem;
    this.clientPrivateKeyPem = options.clientPrivateKeyPem;
    this.trustedCaPem = options.trustedCaPem;
    this.privateKeyPassphrase = options.privateKeyPassphrase;
  }

  async send(request: SaaSControlRequest): Promise<{ status: number; body: unknown }> {
    const url = assertPrivateControlUrl(request.url, this.baseDomain);
    const bodyBuffer = request.body ? Buffer.from(request.body, "utf8") : null;
    if (bodyBuffer && bodyBuffer.byteLength > this.maxRequestBytes) {
      throw controlTransportError(
        "SAAS_CONTROL_REQUEST_TOO_LARGE",
        "SaaS control request exceeds the configured body cap.",
        false,
      );
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const clientRequest = https.request(
        {
          protocol: "https:",
          hostname: url.hostname,
          port: 8443,
          path: `${url.pathname}${url.search}`,
          method: request.method,
          servername: url.hostname,
          host: url.hostname,
          cert: this.clientCertificatePem,
          key: this.clientPrivateKeyPem,
          ca: this.trustedCaPem,
          ...(this.privateKeyPassphrase
            ? { passphrase: this.privateKeyPassphrase }
            : {}),
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
          headers: {
            ...request.headers,
            host: url.hostname,
            ...(bodyBuffer ? { "content-length": String(bodyBuffer.byteLength) } : {}),
          },
        },
        (response: IncomingMessage) => {
          const status = response.statusCode ?? 0;
          const declaredLength = Number(response.headers["content-length"] ?? 0);
          if (declaredLength > this.maxResponseBytes) {
            response.destroy();
            finishReject(
              controlTransportError(
                "SAAS_CONTROL_RESPONSE_TOO_LARGE",
                "SaaS control response exceeds the configured body cap.",
                false,
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on("data", (chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            length += bytes.byteLength;
            if (length > this.maxResponseBytes) {
              response.destroy();
              finishReject(
                controlTransportError(
                  "SAAS_CONTROL_RESPONSE_TOO_LARGE",
                  "SaaS control response exceeds the configured body cap.",
                  false,
                ),
              );
              return;
            }
            chunks.push(bytes);
          });
          response.on("end", () => {
            if (settled) return;
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed: unknown = {};
            if (text) {
              try {
                parsed = JSON.parse(text) as unknown;
              } catch {
                finishReject(
                  controlTransportError(
                    "SAAS_CONTROL_INVALID_JSON",
                    "SaaS control response is not valid JSON.",
                    false,
                  ),
                );
                return;
              }
            }
            settled = true;
            resolve({ status, body: parsed });
          });
          response.on("error", () => {
            finishReject(
              controlTransportError(
                "SAAS_CONTROL_RETRYABLE",
                "SaaS control response stream failed.",
                true,
              ),
            );
          });
        },
      );
      clientRequest.setTimeout(this.timeoutMs, () => {
        clientRequest.destroy();
        finishReject(
          controlTransportError(
            "SAAS_CONTROL_TIMEOUT",
            "SaaS control request timed out.",
            true,
          ),
        );
      });
      clientRequest.on("error", () => {
        finishReject(
          controlTransportError(
            "SAAS_CONTROL_RETRYABLE",
            "SaaS control TLS request failed.",
            true,
          ),
        );
      });
      if (bodyBuffer) clientRequest.write(bodyBuffer);
      clientRequest.end();
    });
  }
}
