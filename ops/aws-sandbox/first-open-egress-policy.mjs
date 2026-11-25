const githubDomains = ["github.com", "githubusercontent.com", "githubassets.com", "github.io", "github.dev",
  "ghcr.io", "ghe.com", "githubapp.com", "githubcopilot.com", "githubstatus.com"];
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const expressWriter = /^techlong-sandbox-express-d001\.cluster-[a-z0-9]+\.ca-central-1\.rds\.amazonaws\.com$/;
const tenant = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sandbox\.techlong\.cloud$/;
const ruleGroupArn = /^arn:aws:network-firewall:ca-central-1:402010193138:stateful-rulegroup\/[a-zA-Z0-9-]{1,128}$/;
const dnsFirewallId = /^rslvr-frg-[0-9a-f]+$/;
const tenantSuffix = ".sandbox.techlong.cloud";

function checkSubnet(cidr) {
  const valid = typeof cidr === "string" && /^(?:\d{1,3}\.){3}\d{1,3}\/\d{2}$/.test(cidr) && !/\s/.test(cidr);
  if (!valid) throw Error("FIRST_OPEN_EGRESS_SUBNET");
  const [address, length] = cidr.split("/");
  const labels = address.split(".");
  const octets = labels.map(Number);
  const [first, second] = octets;
  const privateRange = first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  const prefix = Number(length);
  const network = octets.reduce((value, octet) => value * 256 + octet, 0);
  if (!privateRange || prefix < 16 || prefix > 28 || network % 2 ** (32 - prefix) !== 0 ||
    octets.some((octet, i) => octet > 255 || String(octet) !== labels[i])) throw Error("FIRST_OPEN_EGRESS_SUBNET");
}

function checkHost(host) {
  if (typeof host !== "string" || host.length > 253 || /[^a-z0-9.-]/.test(host)) throw Error("FIRST_OPEN_EGRESS_HOST");
  const labels = host.split(".");
  if (labels.length < 2 || !/^[a-z]/.test(labels.at(-1)) || !labels.every(label => dnsLabel.test(label))) {
    throw Error("FIRST_OPEN_EGRESS_HOST");
  }
  if (githubDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) throw Error("FIRST_OPEN_EGRESS_GITHUB_HOST");
  return host;
}

/** Return only the inner RuleGroup and FirewallPolicy CFN properties. */
export function compileFirstOpenEgressPolicy({ taskSubnetCidr, dnsFirewallRuleGroupId, statefulRuleGroupArn,
  httpsHosts, expressWriterHost, tenantHost } = {}) {
  checkSubnet(taskSubnetCidr);
  if (typeof dnsFirewallRuleGroupId !== "string" || dnsFirewallRuleGroupId.length > 256 || /\s/.test(dnsFirewallRuleGroupId) ||
    !dnsFirewallId.test(dnsFirewallRuleGroupId)) throw Error("FIRST_OPEN_EGRESS_DNS_RULE_GROUP");
  if (typeof statefulRuleGroupArn !== "string" || /\s/.test(statefulRuleGroupArn) || !ruleGroupArn.test(statefulRuleGroupArn)) {
    throw Error("FIRST_OPEN_EGRESS_STATEFUL_RULE_GROUP");
  }
  if (!Array.isArray(httpsHosts) || !httpsHosts.length) throw Error("FIRST_OPEN_EGRESS_HTTPS_HOSTS");
  const writerHost = checkHost(expressWriterHost);
  const apiHost = checkHost(tenantHost);
  if (!expressWriter.test(writerHost) || !tenant.test(apiHost)) throw Error("FIRST_OPEN_EGRESS_TARGET");
  const targets = [...new Set([...httpsHosts, apiHost].map(checkHost))].sort();
  if (targets.some(host => host === writerHost || (host.endsWith(tenantSuffix) && host !== apiHost))) {
    throw Error("FIRST_OPEN_EGRESS_TARGET");
  }

  const outbound = `${taskSubnetCidr} any -> any`;
  const blockedDomains = githubDomains.flatMap(domain => [domain, `.${domain}`]).join(",");
  const rules = [
    `drop ip ${outbound} any (ip_proto:!TCP; sid:1000001;)`,
    `drop tcp ${outbound} ![443,5432,8443] (sid:1000002;)`,
    `drop tcp ${outbound} any (aws_route_53_resolved_domain:"${blockedDomains}"; flow:to_server; sid:1000003;)`,
    // PostgreSQL can negotiate TLS after sending SSLRequest.
    `pass tcp ${outbound} 5432 (aws_route_53_resolved_domain:"${writerHost}"; flow:to_server,established; sid:1000004;)`,
  ];
  for (const [host, port] of [...targets.map(host => [host, 443]), [apiHost, 8443]]) {
    rules.push(`pass tls ${outbound} ${port} (ssl_state:client_hello; tls.sni; content:"${host}"; startswith; endswith; ` +
      `aws_route_53_resolved_domain:"${host}"; flow:to_server,established; sid:${1_000_001 + rules.length};)`);
  }
  return {
    ruleGroup: { RulesSource: { RulesString: rules.join("\n") }, StatefulRuleOptions: { RuleOrder: "STRICT_ORDER" } },
    firewallPolicy: {
      StatelessDefaultActions: ["aws:forward_to_sfe"],
      StatelessFragmentDefaultActions: ["aws:drop"],
      StatefulDefaultActions: ["aws:drop_established_app_layer_to_server"],
      StatefulEngineOptions: { RuleOrder: "STRICT_ORDER", StreamExceptionPolicy: "DROP" },
      StatefulRuleGroupReferences: [{ Priority: 1, ResourceArn: statefulRuleGroupArn }],
      Route53ResolvedIPValidation: {
        Action: "DROP",
        DNSExpiryExceptionPolicy: "DROP",
        DNSFirewallRuleGroupId: dnsFirewallRuleGroupId,
        SourceIPRanges: [{ AddressDefinition: taskSubnetCidr }],
      },
    },
  };
}
