// AWS public price-list GETs only; no credentials, AWS mutation or estimator
// activation. Preserve the exact regional feeds and selected dimensions.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [output]=process.argv.slice(2),root=path.resolve('F:/ChatGPT_workshop');
if(!output||path.dirname(path.resolve(output))!==root||!/^techlong-f3-prices-[a-z0-9-]+$/.test(path.basename(output))||fs.existsSync(output))throw new Error('Fresh price evidence directory required');
fs.mkdirSync(output);
const snapshots=[];
for(const service of ['AmazonECS','AWSELB','AmazonRDS','AmazonVPC','AWSSecretsManager']){
  const url=`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/ca-central-1/index.json`;
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`Price feed unavailable: ${service}`);
  const raw=Buffer.from(await response.arrayBuffer());
  if(raw.length>80*1024*1024)throw new Error('Price feed exceeds bound');
  const source=JSON.parse(raw);
  fs.writeFileSync(path.join(output,`${service}.json`),raw,{flag:'wx'});
  const selected=[];
  for(const [sku,product] of Object.entries(source.products)){
    const a=product.attributes;
    if(a.regionCode!=='ca-central-1')continue;
    const text=JSON.stringify(a);
    const match=service==='AmazonECS'?/Fargate/.test(text)&&!(/Windows|ARM|Spot|Ephemeral/.test(text)):
      service==='AWSELB'?/LoadBalancerUsage|LCUUsage|TrustStore/.test(text):
      service==='AmazonRDS'?a.databaseEngine==='Aurora PostgreSQL'&&/ServerlessV2|StorageUsage|StorageIOUsage/.test(text)&&!(/IO-Optimized|Limitless|ExtendedSupport/.test(text)):
      service==='AmazonVPC'?/PublicIPv4/.test(text):/Secret|API/.test(text);
    if(!match)continue;
    for(const term of Object.values(source.terms.OnDemand?.[sku]??{}))for(const d of Object.values(term.priceDimensions)){
      selected.push({sku,attributes:a,effectiveDate:term.effectiveDate,unit:d.unit,beginRange:d.beginRange,endRange:d.endRange,usd:d.pricePerUnit.USD,description:d.description});
    }
  }
  const sha256=createHash('sha256').update(raw).digest('hex');
  snapshots.push({service,url,sha256,publicationDate:source.publicationDate,version:source.version,selected});
  console.log(JSON.stringify({service,selected:selected.length,sha256}));
}
const result={schemaVersion:1,purpose:'fast-track-f3-regional-pricing-evidence/v1',at:new Date().toISOString(),region:'ca-central-1',currency:'USD',
  monthlyBudgetTargetUsd:50,cloudMutationPerformed:false,estimateIsHardCap:false,snapshots};
const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(path.join(output,'selected-prices.json'),bytes,{flag:'wx'});
console.log(JSON.stringify({output:path.join(output,'selected-prices.json'),sha256:createHash('sha256').update(bytes).digest('hex')}));
