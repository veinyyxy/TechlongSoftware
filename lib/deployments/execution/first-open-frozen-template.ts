import { canonicalJson } from "./hash.ts";

const fail = (): never => { throw Error("FIRST_OPEN_FIXED_TEMPLATE_PARAMETERS"); };
const maskedReferences = new Set(["TenantRuntimeSecretArn", "ControlPublicKeyValueFrom"]);
const subnetType = "List<AWS::EC2::Subnet::Id>";

/** Keep the cloud's parameter readback useful, but make every parameter a
 * scalar singleton. A list AllowedValues would allow a subset or reordering. */
function fixedDefinitions(parameters: Record<string, string>) {
  return Object.fromEntries(Object.entries(parameters).map(([name, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || typeof value !== "string" || /[\r\n\x00]/.test(value) ||
      value.includes("{{resolve:") || (maskedReferences.has(name) && !/^arn:aws:secretsmanager:/.test(value))) fail();
    if (name === "SubnetIds" && !/^subnet-[a-f0-9]+(?:,subnet-[a-f0-9]+)*$/.test(value)) fail();
    return [name, { Type: "String", Default: value, AllowedValues: [value] }];
  }));
}

export function freezeFirstOpenTemplate(template: Record<string, unknown>, parameters: Record<string, string>) {
  const copy = structuredClone(template);
  if (Object.hasOwn(copy, "Transform") || !copy.Parameters || typeof copy.Parameters !== "object" ||
    Array.isArray(copy.Parameters) ||
    canonicalJson(Object.keys(copy.Parameters).sort()) !== canonicalJson(Object.keys(parameters).sort())) return fail();
  const orig = copy.Parameters as Record<string, { Type?: unknown; NoEcho?: unknown }>;
  for (const [name, definition] of Object.entries(orig)) {
    if (!definition || (definition.NoEcho === true && !maskedReferences.has(name)) ||
      !(name === "SubnetIds" ? definition.Type === subnetType : ["String", "AWS::EC2::VPC::Id", "AWS::EC2::SecurityGroup::Id"].includes(String(definition.Type)))) return fail();
  }
  const defs = fixedDefinitions(parameters);
  delete copy.Parameters;
  let subnetRefs = 0;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0][0] === "Ref" && entries[0][1] === "SubnetIds") {
      subnetRefs++;
      return { "Fn::Split": [",", { Ref: "SubnetIds" }] };
    }
    return Object.fromEntries(entries.map(([key, child]) => [key, visit(child)]));
  };
  const body = visit(copy) as Record<string, unknown>;
  if (Object.hasOwn(parameters, "SubnetIds") && subnetRefs !== 1) return fail();
  return { ...body, Parameters: defs };
}

export function assertFirstOpenFrozenTemplate(template: Record<string, unknown>, parameters: Record<string, string>) {
  if (!Object.keys(parameters).length || canonicalJson(template.Parameters ?? null) !== canonicalJson(fixedDefinitions(parameters))) fail();
}
