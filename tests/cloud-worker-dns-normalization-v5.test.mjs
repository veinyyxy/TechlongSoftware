import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCloudDnsV5} from '../ops/cloud-worker/aws-initialized-workload-v5.mjs';
const expected='techlong-sandbox-cell-sandbox-1-335750443.ca-central-1.elb.amazonaws.com';
test('actual Route53 trailing-dot form matches the frozen ALB DNS name',()=>{
  assert.equal(normalizeCloudDnsV5(expected+'.'),expected);
  assert.equal(normalizeCloudDnsV5(expected),expected);
});
test('DNS case and a single dualstack label normalize with or without a terminal dot',()=>{
  for(const input of [expected.toUpperCase()+'.','dualstack.'+expected,'DUALSTACK.'+expected.toUpperCase()+'.'])
    assert.equal(normalizeCloudDnsV5(input),expected);
});
test('normalization does not swallow a different target, suffix, port, URL or repeated dots',()=>{
  for(const input of [expected.replace('335750443','335750444'),expected+'.evil.example',expected+':443',
    'https://'+expected,'notdualstack.'+expected,'dualstack.dualstack.'+expected,expected+'..',expected+'. ',expected+'\\.'])
    assert.notEqual(normalizeCloudDnsV5(input),expected);
});
test('production DNS guard still binds name/type/zone/health and HTTPS/mTLS independently',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/aws-initialized-workload-v5.mjs',import.meta.url),'utf8');
  assert.match(code,/alias\?\.Name === wanted\.Name && alias\.Type === 'A' && !alias\.ResourceRecords/);
  assert.match(code,/alias\.AliasTarget\?\.HostedZoneId === wanted\.AliasTarget\.HostedZoneId/);
  assert.match(code,/normalizeCloudDnsV5\(alias\.AliasTarget\.DNSName\) === normalizeCloudDnsV5\(wanted\.AliasTarget\.DNSName\)/);
  assert.match(code,/alias\.AliasTarget\.EvaluateTargetHealth === false/);
  assert.match(code,/listeners\.Listeners\.every\(l => l\.Protocol === 'HTTPS'\)/);
  assert.match(code,/MutualAuthentication\?\.Mode === 'verify'/);
});
