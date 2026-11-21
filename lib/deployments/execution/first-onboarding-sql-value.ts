import { canonicalJson } from "./hash.ts";

/** Keep arbitrary JSON bytes inside the surrounding dollar-quoted SQL body
 * even when a JSON string includes its own dollar-quote delimiter. */
export function firstOpenSqlJson(value: unknown) {
  return `convert_from(decode('${Buffer.from(canonicalJson(value), "utf8").toString("hex")}','hex'),'UTF8')::jsonb`;
}
