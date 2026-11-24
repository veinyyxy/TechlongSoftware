import { createHash } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";

const sha = /^[a-f0-9]{64}$/;
const name = /^[a-z0-9-]{1,72}$/;
const hash = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const fail = (): never => { throw Error("FIRST_OPEN_INSTALL_JOURNAL"); };

/** One local attempt per install intent, even if an outer approval is rebuilt.
 * No resume, reset, overwrite,
 * or acceptance of old local files as proof. Supply an existing private dir. */
export async function createFirstOpenInstallJournal(privateDir: string, intentSha256: string, approvedSha256: string) {
  if (!isAbsolute(privateDir) || !sha.test(intentSha256) || !sha.test(approvedSha256)) return fail();
  const parent = await lstat(privateDir);
  if (!parent.isDirectory() || parent.isSymbolicLink()) return fail();
  const dir = join(privateDir, `first-open-install-${intentSha256}`);
  try { await mkdir(dir, { mode: 0o700 }); } catch { return fail(); }
  const slots = new Map<string, number>();
  async function write(file: string, data: Uint8Array) {
    if (!data.length || data.length > 1_048_576) return fail();
    const f = await open(join(dir, file), "wx", 0o600);
    try { await f.writeFile(data); await f.sync(); } finally { await f.close(); }
    return hash(data);
  }
  const json = (file: string, value: unknown) => write(file, Buffer.from(canonicalJson(value)));
  await json("approval.json", { intentSha256, approvedSha256 });
  return {
    async consume(slot: string, binding: unknown) {
      if (!/^job_fc41597f9b5ba8e02b338ecf:[\w:-]{1,200}$/.test(slot) || slots.has(slot)) return fail();
      await json(`slot-${hash(slot)}.json`, { slot, binding });
      slots.set(slot, 0);
    },
    async record(slot: string, event: unknown) {
      const index = slots.get(slot);
      if (index === undefined || index > 20) return fail();
      slots.set(slot, index + 1);
      await json(`event-${hash(slot)}-${index}.json`, event);
    },
    async receipt(label: string, data: Uint8Array) {
      if (!name.test(label)) return fail();
      return write(`receipt-${label}.json`, data);
    },
  };
}
