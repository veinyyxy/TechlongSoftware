// Public regional AWS offer files only. No account cost API, credentials or writes.
import {hash,must} from './contract.mjs';
const ITEMS=[['AmazonECS','AMFFWAW2YZ4NE23V','vcpuHour'],['AmazonECS','6VAMAU37C7C88BUA','gbHour'],
  ['AWSELB','QMDFDZRE84T95832','albHour'],['AWSELB','4CB824Z6CRKPUBG4','lcuHour'],['AmazonVPC','4Q2UVHZNUYYAPGTD','ipv4Hour'],['AWSSecretsManager','4H7JXWCMWMQERTVA','secretMonth']];
export function estimate(rates){const hourly=0.5*rates.vcpuHour+rates.gbHour+rates.albHour+0.1*rates.lcuHour+3*rates.ipv4Hour;
  return {exampleHourlyUsd:hourly,exampleTwoHoursUsd:hourly*2,core730HoursUsd:hourly*730+rates.secretMonth,
    assumptions:{tasks:1,vcpu:0.5,memoryGb:1,alb:1,averageLcu:0.1,publicIpv4:3},
    excludes:['existing resources','ECR storage/scans','logs','data transfer','extra ALB capacity/addresses','task restarts/overlap','provision/cleanup time','tax'],notAHardCap:true};}
export async function prices(){const catalogs=[],rates={};for(const service of [...new Set(ITEMS.map(x=>x[0]))]){
  const url=`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/ca-central-1/index.json`,r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  must(r.status===200,'PRICE_HTTP');const raw=await r.text();must(raw.length<30*1024*1024,'PRICE_SIZE');const c=JSON.parse(raw);
  catalogs.push({service,url,version:c.version,publicationDate:c.publicationDate,sha256:hash(raw)});
  for(const [,sku,key]of ITEMS.filter(x=>x[0]===service)){must(c.products?.[sku]?.attributes?.regionCode==='ca-central-1','PRICE_SKU');
    const offers=Object.values(c.terms.OnDemand[sku]??{});must(offers.length===1,'PRICE_OFFER');const dims=Object.values(offers[0].priceDimensions);
    must(dims.length===1&&dims[0].beginRange==='0'&&Number.isFinite(Number(dims[0].pricePerUnit.USD)),'PRICE_DIMENSION');rates[key]=Number(dims[0].pricePerUnit.USD);}
  }return {observedAtUtc:new Date().toISOString(),currency:'USD',catalogs,rates,estimate:estimate(rates)};}
