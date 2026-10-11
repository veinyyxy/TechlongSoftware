import {mkdir,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
const out=path.resolve(process.argv[2]??""),root=await realpath("F:/ChatGPT_workshop");
if(path.dirname(out).toLowerCase()!==root.toLowerCase()||!/^techlong-f3c2-prices-[a-z0-9-]+$/.test(path.basename(out)))throw Error("Private new price output required");
await mkdir(out);
const url="https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ca-central-1/index.json",r=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(30000)});
if(!r.ok)throw Error("Official regional price GET failed");const raw=Buffer.from(await r.arrayBuffer());if(raw.length>30000000)throw Error("Price feed too large");const feed=JSON.parse(raw),selected=[];
for(const[sku,p]of Object.entries(feed.products)){const a=p.attributes;if(a.regionCode!=="ca-central-1"||!(["CAN1-TimedStorage-ByteHrs","CAN1-Requests-Tier1","CAN1-Requests-Tier2"].includes(a.usagetype)))continue;
 for(const term of Object.values(feed.terms.OnDemand[sku]??{}))for(const d of Object.values(term.priceDimensions))selected.push({sku,attributes:a,effectiveDate:term.effectiveDate,unit:d.unit,beginRange:d.beginRange,endRange:d.endRange,usd:d.pricePerUnit.USD,description:d.description});}
const report={schemaVersion:1,purpose:"material-foundation-s3-prices/v1",observedAt:new Date().toISOString(),url,snapshotSha256:createHash("sha256").update(raw).digest("hex"),publicationDate:feed.publicationDate,selected,cloudWrites:0,estimateIsHardCap:false};
await writeFile(path.join(out,"official-s3-snapshot.json"),raw,{flag:"wx"});const bytes=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(out,"selected-prices.json"),bytes,{flag:"wx"});console.log(JSON.stringify({fileSha256:createHash("sha256").update(bytes).digest("hex"),...report}));
