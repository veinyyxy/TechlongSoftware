export const FIRST_OPEN_TENANT_PRIVATE_SUBNET_OUTPUT = "FirstOpenTenantPrivateSubnetIds";

const subnetId = /^subnet-(?:[a-f0-9]{8}|[a-f0-9]{17})$/;

export function isFirstOpenRdsPrivateSubnetIds(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [first, second] = value;
  return typeof first === "string" && typeof second === "string" && first !== second &&
    subnetId.test(first) && subnetId.test(second);
}
