type Environment = Readonly<Record<string, string | undefined>>;

const reject = (): never => { throw Error("FIRST_OPEN_INSTALL_HOST_TRANSPORT_OVERRIDE"); };
const transportOverride = /^(?:GIT_SSL(?:_|$)|GIT_TRACE(?:_|$)|GIT_CURL_VERBOSE$|GIT_(?:ASKPASS|DIR|WORK_TREE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PROXY_COMMAND)$|NODE_EXTRA_CA_CERTS$|NODE_USE_ENV_PROXY$)/i;
const gitConfig = /^GIT_CONFIG(?:_|$)/i;
const managedKey = /^(credential|http)\.(https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~/-]+)\.(helper|usehttppath|proactiveauth|followredirects)$/i;
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const pathSegment = /^[A-Za-z0-9._~-]+$/;

function isDisjointManagedPair(key: string, value: string) {
  if (key.length > 2048 || value.length > 16_384 || /[\x00-\x1f\x7f]/.test(value)) return false;
  const m = managedKey.exec(key);
  if (!m) return false;
  // Parse only unescaped, ordinary HTTPS URL qualifiers. Git's URL match
  // cannot expand these literal different hosts into the fixed github.com
  // publication origin. Relevant, generic, and rewrite settings stay closed.
  const [host, ...parts] = m[2].slice("https://".length).split("/");
  const hostname = host.toLowerCase(), labels = hostname.split(".");
  if (parts.at(-1) === "") parts.pop();
  if (host.length > 253 || labels.length < 2 || !labels.every(x => dnsLabel.test(x)) ||
    hostname === "github.com" || hostname.endsWith(".github.com") || parts.length < 2 ||
    !parts.every(x => pathSegment.test(x) && x !== "." && x !== "..")) return false;
  switch (`${m[1].toLowerCase()}.${m[3].toLowerCase()}`) {
    // Retain the actual helper command (including empty reset entries) as
    // data; this preflight never runs it. Its qualifier is strictly disjoint.
    case "credential.helper": return true;
    case "credential.usehttppath": return value.toLowerCase() === "true";
    case "http.proactiveauth": return value.toLowerCase() === "auto";
    case "http.followredirects": return value.toLowerCase() === "false";
    default: return false;
  }
}

/** One gate for sealing/checking and execution. No mutation, network, helper,
 * or config-file read. Returned pairs are for child Git, never for logging. */
export function inspectFirstOpenInstallHostTransport(env: Environment = process.env) {
  const entries = Object.entries(env);
  if (entries.some(([name, value]) => typeof value === "string" &&
    ((/^NODE_TLS_REJECT_UNAUTHORIZED$/i.test(name) && value === "0") || (value && transportOverride.test(name))))) return reject();
  const active = entries.filter(([name, value]) => value !== undefined && gitConfig.test(name));
  if (active.length === 0) return Object.freeze({ mode: "plain" as const, configCount: 0,
    config: Object.freeze({}) as Readonly<Record<string, string>> });
  const count = env.GIT_CONFIG_COUNT;
  if (typeof count !== "string" || !/^(?:0|[1-9][0-9]?)$/.test(count)) return reject();
  const configCount = Number(count);
  if (configCount > 32 || active.length !== 1 + 2 * configCount) return reject();
  const config: Record<string, string> = { GIT_CONFIG_COUNT: count };
  for (let i = 0; i < configCount; i++) {
    const k = `GIT_CONFIG_KEY_${i}`, v = `GIT_CONFIG_VALUE_${i}`, key = env[k], value = env[v];
    if (typeof key !== "string" || typeof value !== "string" || !isDisjointManagedPair(key, value)) return reject();
    config[k] = key;
    config[v] = value;
  }
  // Explicitly reject unknown slots, case aliases (including on Windows),
  // GIT_CONFIG_PARAMETERS, and config file/redirect overrides.
  if (!active.every(([name]) => Object.hasOwn(config, name))) return reject();
  return Object.freeze({ mode: "managed-disjoint" as const, configCount, config: Object.freeze(config) });
}
