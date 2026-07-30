const PASSWORD_ALGORITHM = "PBKDF2";
const PASSWORD_HASH = "SHA-256";
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const TOKEN_BYTES = 32;

export const PASSWORD_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export interface PasswordDigest {
  hash: string;
  salt: string;
  iterations: number;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符。`;
  }
  return null;
}

export async function hashPassword(
  password: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<PasswordDigest> {
  const saltBytes = randomBytes(PASSWORD_SALT_BYTES);
  const hashBytes = await derivePasswordBytes(password, saltBytes, iterations);
  return {
    hash: bytesToHex(hashBytes),
    salt: bytesToHex(saltBytes),
    iterations,
  };
}

export async function verifyPassword(
  password: string,
  expected: PasswordDigest,
): Promise<boolean> {
  if (
    !Number.isInteger(expected.iterations) ||
    expected.iterations <= 0 ||
    !isHex(expected.salt, PASSWORD_SALT_BYTES) ||
    !isHex(expected.hash, PASSWORD_KEY_BYTES)
  ) {
    return false;
  }

  const actual = await derivePasswordBytes(
    password,
    hexToBytes(expected.salt),
    expected.iterations,
  );
  return timingSafeEqual(actual, hexToBytes(expected.hash));
}

export function createOpaqueToken(): string {
  return bytesToHex(randomBytes(TOKEN_BYTES));
}

export async function hashOpaqueToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToHex(new Uint8Array(digest));
}

export function isOpaqueToken(value: string): boolean {
  return isHex(value, TOKEN_BYTES);
}

async function derivePasswordBytes(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    PASSWORD_ALGORITHM,
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: PASSWORD_ALGORITHM,
      hash: PASSWORD_HASH,
      salt: salt as BufferSource,
      iterations,
    },
    key,
    PASSWORD_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function isHex(value: string, byteLength: number): boolean {
  return (
    value.length === byteLength * 2 &&
    /^[a-f0-9]+$/i.test(value)
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
