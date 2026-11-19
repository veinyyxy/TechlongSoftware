import { parseEnv } from 'node:util';
import pg from 'pg';
import { sandboxFirstPurchaseAttachReplacement } from '../platform-web-database-role-v1/sandbox-first-purchase-ddl.ts';
import { sandboxCheckoutSessionIdFromUrl } from '../../lib/purchases/sandbox-first-purchase-config.ts';
import { parseTarget } from '../platform-web-database-v1/local.mjs';
import { assertFirstPurchaseInstalledRoles, firstPurchaseProtectedLayout } from './first-purchase-activation-db.mjs';
import { hash, same } from './contract.mjs';

const definer='techlong_sandbox_first_purchase_definer';
const check=(ok,code)=>{if(!ok)throw Error('CHECKOUT_REPAIR_DB_'+code);};
const stable=(prefix,value)=>prefix+'_'+hash(prefix+':'+value).slice(0,24);
const grant=`GRANT ${definer} TO SESSION_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER`;
const revoke=`REVOKE ${definer} FROM SESSION_USER GRANTED BY CURRENT_USER RESTRICT`;

export const installedFunctions = q=>q(`SELECT p.proname AS name,p.oid::text AS oid,p.prosrc AS body,
  pg_get_userbyid(p.proowner) AS owner,pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result,p.prosecdef AS definer,p.proconfig AS config,
  ARRAY(SELECT coalesce(r.rolname,'PUBLIC')||':'||x.privilege_type||':'||x.is_grantable::text
    FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee ORDER BY r.rolname) AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sandbox_first_purchase' ORDER BY p.proname`);
export const functionFingerprint=rows=>hash(JSON.stringify(rows.map(({name,body,acl})=>({name,bodySha256:hash(body),acl}))));
const newAttachBody=ddl=>ddl.slice(ddl.indexOf('AS $purchase$')+13,-11);
// Check both the fixed prior definition and the one expected URL-rule change.
export function expectedFunctions(rows,ddl,previousFingerprint){
  const next=newAttachBody(ddl);
  const old=next.replace(/^    OR octet_length\(p_url\)>[0-9]+\n    OR substring\(p_url FROM .+\) IS DISTINCT FROM p_session THEN RETURN false; END IF;$/m,
    "    OR split_part(coalesce(p_url,''),'#',1) <> 'https://checkout.stripe.com/c/pay/' || p_session\n"+
    "    OR octet_length(p_url)>8192 THEN RETURN false; END IF;");
  check(old!==next&&rows.length===5&&new Set(rows.map(r=>r.name)).size===5&&functionFingerprint(rows)===previousFingerprint&&
    rows.every(r=>r.owner===definer&&r.definer&&same(r.config,['search_path=pg_catalog, public, pg_temp']))&&
    rows.find(r=>r.name==='attach')?.body===old,'LEGACY_FUNCTIONS');
  return rows.map(r=>r.name==='attach'?{...r,body:next}:r);
}

// Return only the owner ID needed for the call and comparisons, not business/configuration bodies or the URL.
async function orderState(q,binding,orderId,sessionId,{checkout,lock=false}={}){
  const args=[orderId,binding.workspaceId,binding.planId,stable('pay',orderId),sessionId];
  if(checkout)args.push(checkout.expiry,checkout.url);
  const [x]=await q(`SELECT r.created_by_user_id AS actor,r.amount,r.currency,
    (r.status=${checkout?"'checkout_pending'":"'draft'"} AND
    ${checkout?'r.provider_session_id=$5 AND r.expires_at=$6 AND r.checkout_url=$7 AND p.reference=$5':
      'r.provider_session_id IS NULL AND r.checkout_url IS NULL AND p.reference IS NULL AND NOT EXISTS(SELECT 1 FROM public.subscription_purchase_orders o WHERE o.provider_session_id=$5)'}
    ) AS correct_state
    FROM public.subscription_purchase_orders r JOIN public.payment_records p ON p.id=r.payment_record_id
    JOIN public.workspaces w ON w.id=r.workspace_id AND w.owner_id=r.created_by_user_id
    JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=w.owner_id AND m.role='owner'
    JOIN public.users u ON u.id=w.owner_id AND u.status='active' AND u.is_platform_admin=0
    WHERE r.id=$1 AND r.workspace_id=$2 AND r.plan_id=$3 AND p.id=$4 AND p.workspace_id=$2
      AND r.product_id='prd_restaurant_order_system' AND r.order_type='new_subscription' AND r.deployment_profile_key='standard-v1'
      AND r.provider='stripe' AND p.provider='stripe' AND p.status='pending'
      AND p.amount=r.amount AND p.currency=r.currency AND p.recorded_by_user_id=r.created_by_user_id
      AND r.subscription_id IS NULL AND r.renewal_subscription_id IS NULL AND r.provider_payment_id IS NULL AND r.completed_at IS NULL
      AND p.subscription_id IS NULL AND p.provider_payment_id IS NULL AND p.provider_event_id IS NULL AND p.paid_at IS NULL
      AND w.status='active' AND w.subscription_status='not_configured' AND w.app_instance_status='not_provisioned'
      AND NOT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.workspace_id=$2 AND s.product_id=r.product_id)
      AND NOT EXISTS(SELECT 1 FROM public.app_instances a WHERE a.workspace_id=$2 AND a.product_id=r.product_id)
      AND NOT EXISTS(SELECT 1 FROM public.workspace_product_entitlements e WHERE e.workspace_id=$2 AND e.product_id=r.product_id)
      AND NOT EXISTS(SELECT 1 FROM public.payment_webhook_events e WHERE e.purchase_order_id=r.id)
    ${lock?'FOR UPDATE OF r,p,w,m,u':''}`,args);
  check(x?.correct_state===true&&/^usr_[A-Za-z0-9_-]{1,100}$/.test(x.actor)&&Number.isSafeInteger(x.amount)&&x.amount>0&&
    /^[A-Z]{3}$/.test(x.currency),'ORDER_NOT_EXACT');
  return {actor:x.actor,amount:x.amount,currency:x.currency};
}

// Transaction is owned by the caller. No COMMIT, external requests or direct table writes.
export async function repairCheckoutInTransaction(q,{binding,orderId,sessionId,checkout,expected,before,ddl,verifyGuards}){
  check(checkout&&checkout.expiry>Date.now()+30_000&&sandboxCheckoutSessionIdFromUrl(checkout.url)===sessionId&&
    checkout.amount===expected.amount&&checkout.currency===expected.currency,'PROVIDER_BINDING');
  await verifyGuards(q);
  check(same(await installedFunctions(q),before),'FUNCTIONS_CHANGED');
  check(same(await orderState(q,binding,orderId,sessionId,{lock:true}),expected),'ORDER_CHANGED');
  await q(grant);
  await q('SET LOCAL ROLE '+definer);
  await q(ddl);
  const [result]=await q('SELECT sandbox_first_purchase.attach($1::text,$2::text,$3::text,$4::text,$5::bigint) AS ok',
    [expected.actor,orderId,sessionId,checkout.url,checkout.expiry]);
  check(result?.ok===true,'ATTACH_REFUSED');
  await q('SET LOCAL ROLE NONE');
  await q(revoke);
  await verifyGuards(q);
  check(same(await installedFunctions(q),expectedFunctions(before,ddl,functionFingerprint(before))),'ONLY_ATTACH_MAY_CHANGE');
  check(same(await orderState(q,binding,orderId,sessionId,{checkout}),expected),'ATTACH_POSTCONDITION');
}

export function checkoutRepairDatabase({configText,historical,protectedLayout,binding,orderId,sessionId,previousFingerprint,deadline,record}){
  check(!Object.keys(process.env).some(k=>/^PG|^SSL_CERT_(?:DIR|FILE)$/i.test(k)&&process.env[k])&&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&orderId===stable('ord','sandbox-first-purchase:v1:'+binding.workspaceId)&&
    /^cs_test_[A-Za-z0-9]{1,200}$/.test(sessionId),'BINDING');
  const {target,config}=parseTarget(parseEnv(configText).DATABASE_URL),known=historical.catalog?.identity;
  check(same(target,historical.target)&&known?.actor_role?.oid&&known.database_metadata?.oid,'NEON_TARGET');
  const ddl=sandboxFirstPurchaseAttachReplacement(binding),counts={connections:0,sql:0,writeTransactions:0};
  let before,expected,after;
  async function session(work,readOnly=true){
    check(++counts.connections<=3&&Date.now()+20000<deadline,'CONNECTION_LIMIT');
    const db=new pg.Client({...config,application_name:'Techlong-Reviewed-Checkout-Repair'});
    db.on('error',()=>{});
    let started=false,commitSent=false;
    const q=async(text,args)=>{
      check(Date.now()+1000<deadline&&++counts.sql<=60,'STATEMENT_LIMIT');
      return (await db.query(text,args)).rows;
    };
    try{
      await db.connect();check(db.connection.stream?.encrypted&&db.connection.stream.authorized,'TLS');
      if(!readOnly)check(++counts.writeTransactions===1,'SINGLE_TRANSACTION');
      await q(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');started=true;
      await q("SET LOCAL search_path=pg_catalog");
      await q("SET LOCAL statement_timeout='10s'");
      await q("SET LOCAL lock_timeout='4s'");
      const [r]=await q(`SELECT r.rolname AS actor,session_user AS login,d.datname AS db,r.oid::text AS oid,d.oid::text AS db_oid,
        d.datdba::text AS owner,current_setting('server_version_num')::int/10000 AS major,r.rolsuper,r.rolcreaterole
        FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`);
      check(r?.actor===target.actor&&r.login===target.actor&&r.db===target.database&&r.oid===known.actor_role.oid&&
        r.db_oid===known.database_metadata.oid&&r.owner===known.database_metadata.owner&&r.major===18&&!r.rolsuper&&r.rolcreaterole,'DB_IDENTITY');
      const result=await work(q);
      if(!readOnly)await record('db-commit-intent',{transactions:counts.writeTransactions});
      commitSent=true;await q('COMMIT');started=false;
      if(!readOnly)await record('db-commit-ack',{acknowledged:true});
      return result;
    }finally{
      if(started&&!commitSent&&counts.sql<60&&Date.now()+1000<deadline)await q('ROLLBACK').catch(()=>{});
      await db.end().catch(()=>{});
    }
  }
  const verifyGuards=async q=>{
    await assertFirstPurchaseInstalledRoles(q);
    check(same(await firstPurchaseProtectedLayout(q),protectedLayout),'PROTECTED_LAYOUT');
  };
  return {counts,
    async preflight(){
      check(!before,'PREFLIGHT_ONCE');
      return session(async q=>{
        await verifyGuards(q);
        before=await installedFunctions(q);
        after=expectedFunctions(before,ddl,previousFingerprint);
        expected=await orderState(q,binding,orderId,sessionId);
        return {amount:expected.amount,currency:expected.currency};
      });
    },
    async repairAndReadBack(checkout){
      check(before&&expected&&after,'PREFLIGHT_REQUIRED');
      await session(q=>repairCheckoutInTransaction(q,{binding,orderId,sessionId,checkout,before,expected,ddl,verifyGuards}),false);
      return session(async q=>{
        await verifyGuards(q);
        check(same(await installedFunctions(q),after)&&same(await orderState(q,binding,orderId,sessionId,{checkout}),expected),'INDEPENDENT_READBACK');
        return {sameOrderAndSession:true,orderStatus:'checkout_pending',paymentStatus:'pending',functionsSha256:functionFingerprint(after)};
      });
    }};
}
