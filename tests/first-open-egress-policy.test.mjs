import assert from "node:assert/strict";
import test from "node:test";
import { compileFirstOpenEgressPolicy } from "../ops/aws-sandbox/first-open-egress-policy.mjs";

const input = {
  taskSubnetCidr: "10.90.41.64/28",
  dnsFirewallRuleGroupId: "rslvr-frg-0123456789abcdef0",
  statefulRuleGroupArn: "arn:aws:network-firewall:ca-central-1:402010193138:stateful-rulegroup/first-open-offline-fixture",
  httpsHosts: ["logs.ca-central-1.amazonaws.com", "api.us-east-2.aws.neon.tech", "api.ecr.ca-central-1.amazonaws.com"],
  expressWriterHost: "techlong-sandbox-express-d001.cluster-abcd1234.ca-central-1.rds.amazonaws.com",
  tenantHost: "fixture-a.sandbox.techlong.cloud",
};

test("first-open egress compiles exact scoped CloudFormation rules without TLS interception", () => {
  const { ruleGroup, firewallPolicy } = compileFirstOpenEgressPolicy(input);
  assert.deepEqual(ruleGroup.StatefulRuleOptions, { RuleOrder: "STRICT_ORDER" });
  assert.deepEqual(firewallPolicy, {
    StatelessDefaultActions: ["aws:forward_to_sfe"],
    StatelessFragmentDefaultActions: ["aws:drop"],
    StatefulDefaultActions: ["aws:drop_established_app_layer_to_server"],
    StatefulEngineOptions: { RuleOrder: "STRICT_ORDER", StreamExceptionPolicy: "DROP" },
    StatefulRuleGroupReferences: [{ Priority: 1, ResourceArn: input.statefulRuleGroupArn }],
    Route53ResolvedIPValidation: {
      Action: "DROP",
      DNSExpiryExceptionPolicy: "DROP",
      DNSFirewallRuleGroupId: input.dnsFirewallRuleGroupId,
      SourceIPRanges: [{ AddressDefinition: input.taskSubnetCidr }],
    },
  });

  const rules = ruleGroup.RulesSource.RulesString.split("\n");
  const [transport, ports, github, postgres, ...tls] = rules;
  const source = `${input.taskSubnetCidr} any -> any`;
  assert.equal(transport, `drop ip ${source} any (ip_proto:!TCP; sid:1000001;)`);
  assert.equal(ports, `drop tcp ${source} ![443,5432,8443] (sid:1000002;)`);
  assert.ok(github.startsWith(`drop tcp ${source} any (aws_route_53_resolved_domain:"github.com,.github.com,`));
  assert.match(github, /flow:to_server; sid:1000003;\)$/);
  assert.equal(postgres, `pass tcp ${source} 5432 (aws_route_53_resolved_domain:"${input.expressWriterHost}"; ` +
    "flow:to_server,established; sid:1000004;)");
  const expected443 = [...input.httpsHosts, input.tenantHost].sort();
  const tlsBindings = [...expected443.map(host => [443, host]), [8443, input.tenantHost]];
  assert.deepEqual(tls, tlsBindings.map(([port, host], index) =>
    `pass tls ${source} ${port} (ssl_state:client_hello; tls.sni; content:"${host}"; startswith; endswith; ` +
    `aws_route_53_resolved_domain:"${host}"; flow:to_server,established; sid:${1_000_005 + index};)`));
  assert.deepEqual(compileFirstOpenEgressPolicy({ ...input, httpsHosts: [...input.httpsHosts.toReversed(), input.tenantHost, input.httpsHosts[0]] }),
    { ruleGroup, firewallPolicy });
});

test("first-open egress rejects incomplete scope, GitHub hosts and rule injection", () => {
  const compile = overrides => compileFirstOpenEgressPolicy({ ...input, ...overrides });
  for (const taskSubnetCidr of ["0.0.0.0/0", "10.90.41.65/28", "010.90.41.64/28", "10.90.41.64/29", "2001:db8::/64", "10.90.41.64/28\n"]) {
    assert.throws(() => compile({ taskSubnetCidr }), /FIRST_OPEN_EGRESS_SUBNET/);
  }
  assert.throws(() => compile({ dnsFirewallRuleGroupId: "rslvr-frg-0123\n" }), /FIRST_OPEN_EGRESS_DNS_RULE_GROUP/);
  assert.throws(() => compile({ statefulRuleGroupArn: input.statefulRuleGroupArn.replace("ca-central-1", "us-east-2") }),
    /FIRST_OPEN_EGRESS_STATEFUL_RULE_GROUP/);
  assert.throws(() => compile({ statefulRuleGroupArn: input.statefulRuleGroupArn.replace("402010193138", "123456789012") }),
    /FIRST_OPEN_EGRESS_STATEFUL_RULE_GROUP/);
  for (const httpsHosts of [undefined, [], "api.ecr.ca-central-1.amazonaws.com"]) {
    assert.throws(() => compile({ httpsHosts }), /FIRST_OPEN_EGRESS_HTTPS_HOSTS/);
  }
  for (const host of ["github.com", "api.github.com", "raw.githubusercontent.com", "x.githubassets.com", "some.github.io", "ghcr.io", "team.ghe.com"]) {
    assert.throws(() => compile({ httpsHosts: [host] }), /FIRST_OPEN_EGRESS_GITHUB_HOST/);
  }
  for (const host of ["*.amazonaws.com", "API.example.com", "192.0.2.7", "[::1]", "s3.ca-central-1.amazonaws.com:443",
    "api.example.com.", "api.example.com\n", 'api.example.com"; sid:5;', "https://api.example.com", "api..example.com"]) {
    assert.throws(() => compile({ httpsHosts: [host] }), /FIRST_OPEN_EGRESS_HOST/);
  }
  assert.throws(() => compile({ httpsHosts: ["other.sandbox.techlong.cloud"] }), /FIRST_OPEN_EGRESS_TARGET/);
  assert.throws(() => compile({ httpsHosts: [input.expressWriterHost] }), /FIRST_OPEN_EGRESS_TARGET/);
  assert.throws(() => compile({ expressWriterHost: input.expressWriterHost.replace("cluster-", "cluster-ro-") }), /FIRST_OPEN_EGRESS_TARGET/);
  assert.throws(() => compile({ tenantHost: "fixture-a.example.com" }), /FIRST_OPEN_EGRESS_TARGET/);
});
