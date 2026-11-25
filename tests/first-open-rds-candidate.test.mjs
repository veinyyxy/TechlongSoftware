import assert from "node:assert/strict";
import test from "node:test";
import { renderFirstOpenRdsCandidate } from "../ops/aws-sandbox/first-open-rds-candidate.mjs";

function fixture() {
  const target = (vpcId, databaseName, subnetPrefix, applicationSecurityGroups) => ({
    databaseName, instanceClass: "db.t4g.micro", storageGiB: 20, backupRetentionDays: 7, multiAz: false,
    kmsKeyArn: "arn:aws:kms:ca-central-1:402010193138:key/01234567-0123-0123-0123-0123456789ab",
    subnets: ["a", "b"].map((letter, index) => ({ id: `subnet-${subnetPrefix}00000${index + 1}`,
      vpcId, availabilityZone: `ca-central-1${letter}`, routeTableId: `rtb-${subnetPrefix}00000${index + 1}`,
      mapPublicIpOnLaunch: false, ipv4DefaultRoutePresent: false, ipv6DefaultRoutePresent: false })),
    applicationSecurityGroups,
  });
  return {
    control: target("vpc-011dab69fff93972b", "techlong_control", "11",
      { Web: "sg-33000001", Launcher: "sg-33000002", FirstOpenTask: "sg-33000003" }),
    tenant: target("vpc-0136b6ba92a72cbf9", "tenant_fixture_db", "22",
      { TenantApi: "sg-44000001", FirstOpenTask: "sg-33000003" }),
  };
}

test("T4.2 renders two additive private PostgreSQL 16.14 targets under their existing owner stacks", () => {
  const result = renderFirstOpenRdsCandidate(fixture());
  assert.equal(result.installationAuthorized, false);
  assert.equal(result.control.ownerStack, "techlong-sandbox-platform-hosting-v1");
  assert.equal(result.tenant.ownerStack, "techlong-sandbox-cell-sandbox-1");
  for (const [fragment, sourceCount] of [[result.control, 3], [result.tenant, 2]]) {
    const { FirstOpenPostgresDatabase: database, FirstOpenPostgresParameters: parameters } = fragment.Resources;
    assert.equal(database.Type, "AWS::RDS::DBInstance");
    assert.equal(database.DeletionPolicy, "Retain");
    assert.equal(database.UpdateReplacePolicy, "Retain");
    const p = database.Properties;
    assert.deepEqual([p.Engine, p.EngineVersion, p.PubliclyAccessible, p.DeletionProtection, p.StorageEncrypted,
      p.ManageMasterUserPassword, p.MasterUserPassword, p.AutoMinorVersionUpgrade],
    ["postgres", "16.14", false, true, true, true, undefined, false]);
    assert.deepEqual(parameters.Properties.Parameters, { "rds.force_ssl": "1" });
    const ingress = Object.values(fragment.Resources).filter(r => r.Type === "AWS::EC2::SecurityGroupIngress");
    assert.equal(ingress.length, sourceCount);
    assert.ok(ingress.every(r => r.Properties.FromPort === 5432 && r.Properties.ToPort === 5432 &&
      r.Properties.SourceSecurityGroupId && !r.Properties.CidrIp && !r.Properties.CidrIpv6));
  }
  assert.notEqual(result.control.Resources.FirstOpenPostgresDatabase.Properties.DBInstanceIdentifier,
    result.tenant.Resources.FirstOpenPostgresDatabase.Properties.DBInstanceIdentifier);
});

test("T4.2 RDS fragments reject public or unmatched routes, AZs, databases and callers", () => {
  for (const [change, reason] of [
    [input => { input.control.subnets[0].ipv4DefaultRoutePresent = true; }, /PRIVATE_SUBNET_SCOPE/],
    [input => { input.tenant.subnets[0].ipv6DefaultRoutePresent = true; }, /PRIVATE_SUBNET_SCOPE/],
    [input => { input.control.subnets[0].mapPublicIpOnLaunch = true; }, /PRIVATE_SUBNET_SCOPE/],
    [input => { input.control.subnets[0].vpcId = input.tenant.subnets[0].vpcId; }, /PRIVATE_SUBNET_SCOPE/],
    [input => { input.control.subnets[0].availabilityZone = input.control.subnets[1].availabilityZone; }, /PRIVATE_SUBNET_SCOPE/],
    [input => { input.tenant.databaseName = "techlong_control"; }, /RDS_INSTANCE_SCOPE/],
    [input => { input.tenant.applicationSecurityGroups.FirstOpenTask = "sg-44000003"; }, /SPLIT_SCOPE/],
    [input => { input.tenant.applicationSecurityGroups.Web = "sg-44000006"; }, /SECURITY_GROUP_SCOPE/],
  ]) {
    const input = fixture();
    change(input);
    assert.throws(() => renderFirstOpenRdsCandidate(input), reason);
  }
});
