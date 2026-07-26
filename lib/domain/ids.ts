export async function stableId(prefix: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${prefix}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${prefix}_${hash.slice(0, 24)}`;
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
