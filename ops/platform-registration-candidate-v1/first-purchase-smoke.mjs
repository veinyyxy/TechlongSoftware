// Executed in the non-root, network-disabled candidate; no actual account or signature secret.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';

const { CLOSED_BINDINGS } = await import(pathToFileURL(process.cwd() + '/ops/platform-hosting-v1/contract.mjs'));
for (const [name, expected] of Object.entries(CLOSED_BINDINGS)) assert.equal(process.env[name], expected);
assert.equal(process.env.TECHLONG_SANDBOX_FIRST_PURCHASE, 'true');
assert.equal(process.env.TECHLONG_SANDBOX_STRIPE_TEST_WEBHOOK_SECRET, 'whsec_synthetic_only');
const path = '/api/stripe/webhook';
const headers = { host:'console.sandbox.techlong.cloud', 'x-forwarded-proto':'https', 'x-forwarded-port':'443' };
function send(target, method, values, body='') {
  return new Promise((resolve, reject) => {
    const req=request({hostname:'127.0.0.1',port:3000,path:target,method,headers:values,timeout:5000}, res => {
      let data=''; res.setEncoding('utf8');
      res.on('data', chunk => {
        data+=chunk;
        if (data.length>4096) req.destroy(Error('FIRST_PURCHASE_SMOKE_RESPONSE_BOUND'));
      });
      res.on('end',()=>resolve({status:res.statusCode,data}));
    });
    req.on('error',reject); req.on('timeout',()=>req.destroy(Error('FIRST_PURCHASE_SMOKE_TIMEOUT')));
    req.end(body);
  });
}
let ready=false;
for (let n=0;n<30;n++) {
  try { if ((await send('/api/health','GET',headers)).status===200) {ready=true;break;} }
  catch { /* bounded liveness only */ }
  await new Promise(resolve=>setTimeout(resolve,1000));
}
assert(ready);
function payload(live, order) {
  return JSON.stringify({id:'evt_SyntheticOnly',type:'checkout.session.completed',api_version:'2026-05-27.dahlia',livemode:live,
    data:{object:{id:'cs_test_SyntheticOnly',mode:'payment',livemode:live,payment_status:'paid',status:'complete',
      client_reference_id:order,metadata:{subscription_purchase_order_id:order},
      amount_total:100,currency:'cad',payment_intent:'pi_SyntheticOnly'}}});
}
const signed=async (body, target=path, corrupt=false)=>{
  const time=Math.floor(Date.now()/1000);
  const digest=corrupt?'0'.repeat(64):createHmac('sha256','whsec_synthetic_only').update(`${time}.${body}`).digest('hex');
  return send(target,'POST',{...headers,'content-type':'application/json','content-length':Buffer.byteLength(body),
    'stripe-signature':`t=${time},v1=${digest}`},body);
};
const fixture=payload(false,'ord_nonmatching_fixture');
const order=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ord:sandbox-first-purchase:v1:wsp_aaaaaaaaaaaaaaaaaaaaaaaa'));
const live=payload(true,'ord_'+Buffer.from(order).toString('hex').slice(0,24));
for (const body of [fixture,live]) {
  const got=await signed(body);
  assert.equal(got.status,200);
  assert.deepEqual(JSON.parse(got.data),{received:true,outcome:'ignored'});
}
assert.equal((await signed(fixture,path,true)).status,400);
assert.equal((await signed(fixture,path+'?fixture=1')).status,403);
console.log(JSON.stringify({outcome:'SANDBOX_FIRST_PURCHASE_SYNTHETIC_CALLBACK_PASSED',
  validOutOfScopeIgnored:true,liveModeIgnored:true,badSignatureRejected:true,exactRouteOnly:true,workerClosed:true}));
