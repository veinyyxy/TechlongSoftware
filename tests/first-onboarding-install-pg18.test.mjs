import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { sandboxFirstPurchaseAttachReplacement, sandboxFirstPurchaseDdl, sandboxFirstPurchaseInstallStatements } from '../ops/platform-web-database-role-v1/sandbox-first-purchase-ddl.ts';
import { assertFirstPurchaseInstalledRoles } from '../ops/platform-ecs-v1/first-purchase-activation-db.mjs';
import { expectedFunctions, functionFingerprint, installedFunctions, repairCheckoutInTransaction,
  installSandboxBillingFunctionInTransaction } from '../ops/platform-ecs-v1/checkout-repair-db.mjs';

const url = process.env.FIRST_PURCHASE_PG18_CI_DATABASE_URL;
const installer = 'first_purchase_ci_installer', web = 'techlong_platform_web_acceptance_v1';
const definer = 'techlong_sandbox_first_purchase_definer', webhook = 'techlong_sandbox_first_purchase_webhook';
const pw = 'a'.repeat(64), roles = [definer,webhook];
const scope = { workspaceId:'wsp_'+'a'.repeat(24),planId:'pln_'+'a'.repeat(32),releaseId:'release_'+'a'.repeat(32),
  imageUri:'402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:'+'a'.repeat(64) };
const bodies = text => [...text.matchAll(/CREATE FUNCTION sandbox_first_purchase\.[\s\S]*?\$purchase\$;/g)].map(x=>x[0]);

test('PG18 recipe reuses five exact bodies without ownership transfer, secret injection or COMMIT',()=>{
  const plan=sandboxFirstPurchaseInstallStatements(scope,pw);
  assert.deepEqual(bodies(plan.join('\n')),bodies(sandboxFirstPurchaseDdl(scope)));
  assert.equal(bodies(plan.join('\n')).length,5);
  assert.equal(plan.filter(s=>s.startsWith('SET LOCAL ROLE ')).length,2);
  assert.match(plan.at(-1),/^REVOKE .* FROM SESSION_USER GRANTED BY CURRENT_USER RESTRICT$/);
  assert.ok(plan.every(s=>!/^\s*(COMMIT|ALTER FUNCTION)\b/.test(s)));
  assert.throws(()=>sandboxFirstPurchaseInstallStatements(scope,pw.slice(1)+"'"),/Invalid generated/);
});

test('isolated PostgreSQL 18: non-superuser creates and verifies exact owners, ACLs and LOGIN', {skip:!url,timeout:25000},async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');
  const original=new URL(url);
  assert.equal(original.protocol,'postgresql:');assert.equal(original.hostname,'127.0.0.1');
  assert.equal(original.pathname,'/first_purchase_pg18_ci');assert.equal(original.username,'postgres');
  assert.equal(original.password,'synthetic-ci-only');assert.equal(original.search+original.hash,'');
  const client=(role,password='synthetic-ci-only')=>{
    const target=new URL(original);target.username=role;target.password=password;
    return new pg.Client({connectionString:target.href,connectionTimeoutMillis:5000,statement_timeout:5000});
  };
  const root=client('postgres'), writer=client(installer), reader=client(installer), runtime=client(webhook,pw);
  const verifyInstalledRoles=db=>assertFirstPurchaseInstalledRoles(async (sql,args)=>(await db.query(sql,args)).rows);
  async function verify(db){
    await verifyInstalledRoles(db);
    const {rows:[identity]}=await db.query(`SELECT current_user AS actor, session_user AS login,
      current_setting('server_version_num')::int / 10000 AS major,r.rolsuper,r.rolcreaterole FROM pg_roles r WHERE r.rolname=current_user`);
    assert.deepEqual(identity,{actor:installer,login:installer,major:18,rolsuper:false,rolcreaterole:true});
    const {rows}=await db.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
      pg_has_role(current_user, oid,'SET') AS installer_set,pg_has_role(current_user,oid,'USAGE') AS installer_inherit
      FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname`,[roles]);
    assert.deepEqual(rows,roles.map((rolname,i)=>({rolname,rolcanlogin:i===1,rolinherit:false,rolsuper:false,rolcreaterole:false,
      rolcreatedb:false,rolreplication:false,rolbypassrls:false,installer_set:false,installer_inherit:false})));
    const {rows:members}=await db.query(`SELECT r.rolname,m.rolname AS member,g.rolname AS grantor,a.admin_option,a.inherit_option,a.set_option
      FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor
      WHERE r.rolname=ANY($1::text[]) OR m.rolname=ANY($1::text[]) ORDER BY r.rolname`,[roles]);
    assert.deepEqual(members,roles.map(rolname=>({rolname,member:installer,grantor:'postgres',admin_option:true,inherit_option:false,set_option:false})));
    const {rows:[{acl}]}=await db.query(`SELECT ARRAY(SELECT r.rolname||':'||x.privilege_type||':'||x.is_grantable::text
      FROM aclexplode(n.nspacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee ORDER BY r.rolname,x.privilege_type) acl
      FROM pg_namespace n JOIN pg_roles owner ON owner.oid=n.nspowner WHERE n.nspname='sandbox_first_purchase' AND owner.rolname=$1`,[definer]);
    assert.deepEqual(acl,[`${definer}:CREATE:false`,`${definer}:USAGE:false`,`${web}:USAGE:false`,`${webhook}:USAGE:false`].sort());
    const {rows:f}=await db.query(`SELECT p.proname,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,p.proconfig,
      ARRAY(SELECT coalesce(r.rolname,'PUBLIC')||':'||x.privilege_type||':'||x.is_grantable::text
        FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee ORDER BY r.rolname) acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sandbox_first_purchase' ORDER BY p.proname`);
    assert.deepEqual(f,['attach','complete','read_order','reserve','webhook_order'].map(proname=>({proname,prosecdef:true,owner:definer,
      proconfig:['search_path=pg_catalog, public, pg_temp'],acl:[`${definer}:EXECUTE:false`,
        `${['complete','webhook_order'].includes(proname)?webhook:web}:EXECUTE:false`].sort()})));
    const {rows:[guard]}=await db.query(`SELECT
      count(*) FILTER (WHERE has_table_privilege($1::name,c.oid,'INSERT'))::int AS definer_insert_tables,
      count(*) FILTER (WHERE has_table_privilege($1::name,c.oid,'DELETE,TRUNCATE,TRIGGER,UPDATE') OR c.relowner=(SELECT oid FROM pg_roles WHERE rolname=$1::name))::int AS definer_extra
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`,[definer]);
    assert.deepEqual(guard,{definer_insert_tables:8,definer_extra:0});
  }
  try {
    await root.connect();
    const {rows:[v]}=await root.query("SELECT current_setting('server_version_num')::int / 10000 AS major");assert.equal(v.major,18);
    await root.query(`CREATE ROLE ${installer} LOGIN CREATEROLE NOSUPERUSER PASSWORD 'synthetic-ci-only'; ALTER DATABASE first_purchase_pg18_ci OWNER TO ${installer}`);
    await writer.connect();
    await writer.query(await readFile(new URL('../db/postgres-schema.sql',import.meta.url),'utf8'));
    await writer.query(await readFile(new URL('../ops/platform-web-database-role-v1/no-login.sql',import.meta.url),'utf8'));
    await writer.query(`ALTER ROLE ${web} LOGIN`);
    await writer.query('BEGIN');
    for(const sql of sandboxFirstPurchaseInstallStatements(scope,pw)) await writer.query(sql);
    await verify(writer);
    for(const extraGrant of [
      `INSERT ON public.subscriptions TO ${web}`,
      `UPDATE ON public.auth_sessions TO ${web}`,
      `INSERT ON public.auth_sessions TO ${web} WITH GRANT OPTION`,
      `DELETE ON public.auth_sessions TO ${web} WITH GRANT OPTION`,
      `UPDATE ON public.user_credentials TO ${web}`,
      `UPDATE (password_hash) ON public.user_credentials TO ${web}`,
      `UPDATE (failed_attempts) ON public.user_credentials TO ${web} WITH GRANT OPTION`,
      `INSERT ON public.auth_sessions TO ${webhook}`,
      `UPDATE (failed_attempts) ON public.user_credentials TO ${webhook}`,
    ]){
      await writer.query('SAVEPOINT extra_acl');
      await writer.query('GRANT '+extraGrant);
      await assert.rejects(verifyInstalledRoles(writer),/FIRST_PURCHASE_DB_INSTALLED_ROLE_OR_ACL/,extraGrant);
      await writer.query('ROLLBACK TO SAVEPOINT extra_acl');
      await writer.query('RELEASE SAVEPOINT extra_acl');
    }
    await verifyInstalledRoles(writer);
    await writer.query('COMMIT');
    await reader.connect();await reader.query('BEGIN READ ONLY');await verify(reader);await reader.query('COMMIT');

    const actor='usr_checkout_repair_fixture', templateId='tpl_fast_food_ordering_v1_detail';
    const stable=(prefix,x)=>prefix+'_'+createHash('sha256').update(prefix+':'+x).digest('hex').slice(0,24);
    const orderId=stable('ord','sandbox-first-purchase:v1:'+scope.workspaceId), pay=stable('pay',orderId);
    const sessionId='cs_test_OriginalSandbox', expiry=Date.now()+3600000;
    const expected={actor,amount:1500,currency:'CAD'}, checkout={...expected,expiry,url:'https://checkout.stripe.com/sandbox/pay/'+sessionId+'#synthetic'};
    const {rows:[published]}=await writer.query("SELECT v.id FROM public.app_instance_template_versions v JOIN public.app_instance_templates t ON t.id=v.template_id WHERE t.product_id='prd_restaurant_order_system' AND v.status='published' ORDER BY v.id LIMIT 1");
    assert.ok(published?.id,templateId);
    await writer.query("INSERT INTO public.users(id,email,name,created_at,updated_at) VALUES ($1,'repair@example.invalid','Synthetic',1,1)",[actor]);
    await writer.query("INSERT INTO public.workspaces(id,name,owner_id,created_at,updated_at) VALUES ($1,'Synthetic',$2,1,1)",[scope.workspaceId,actor]);
    await writer.query("INSERT INTO public.workspace_members(id,workspace_id,user_id,role,joined_at) VALUES ('mem_repair_fixture',$1,$2,'owner',1)",[scope.workspaceId,actor]);
    await writer.query(`INSERT INTO public.plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at)
      VALUES ($1,'prd_restaurant_order_system',$2,'Synthetic',1500,'CAD','month',1,1)`,[scope.planId,published.id]);
    await writer.query(`INSERT INTO public.payment_records(id,workspace_id,amount,currency,status,payment_method,provider,recorded_by_user_id,created_at,updated_at)
      VALUES ($1,$2,1500,'CAD','pending','Stripe Checkout (sandbox test)','stripe',$3,1,1)`,[pay,scope.workspaceId,actor]);
    await writer.query(`INSERT INTO public.subscription_purchase_orders(id,workspace_id,product_id,plan_id,template_version_id,payment_record_id,
      configuration_snapshot,amount,currency,billing_interval,deployment_profile_key,created_by_user_id,expires_at,created_at,updated_at)
      VALUES ($1,$2,'prd_restaurant_order_system',$3,$4,$5,'{}',1500,'CAD','month','standard-v1',$6,1,1,1)`,
    [orderId,scope.workspaceId,scope.planId,published.id,pay,actor]);
    const ddl=sandboxFirstPurchaseAttachReplacement(scope);
    const legacy=ddl.replace(/^    OR octet_length\(p_url\)>8192\n    OR substring\(p_url FROM .+\) IS DISTINCT FROM p_session THEN RETURN false; END IF;$/m,
      "    OR split_part(coalesce(p_url,''),'#',1) <> 'https://checkout.stripe.com/c/pay/' || p_session\n"+
      "    OR octet_length(p_url)>8192 THEN RETURN false; END IF;");
    assert.notEqual(ddl,legacy);
    await root.query("BEGIN; SET LOCAL ROLE "+definer+";\n"+legacy+"\nCOMMIT;");
    const qFor=db=>async (sql,params)=>(await db.query(sql,params)).rows;
    const q=qFor(writer), read=qFor(reader);
    const before=await installedFunctions(q), input={binding:scope,orderId,sessionId,checkout,expected,before,ddl,verifyGuards:assertFirstPurchaseInstalledRoles};
    const after=expectedFunctions(before,ddl,functionFingerprint(before));
    const begin=()=>q("BEGIN; SET LOCAL search_path=pg_catalog");
    await begin();
    await assert.rejects(repairCheckoutInTransaction(async (stmt,args)=>{
      const rows=await q(stmt,args);
      return stmt.startsWith('SELECT sandbox_first_purchase.attach(')?[{ok:false}]:rows;
    },input),/CHECKOUT_REPAIR_DB_ATTACH_REFUSED/);
    await q('ROLLBACK');
    assert.deepEqual(await installedFunctions(read),before);
    assert.deepEqual(await read('SELECT status,provider_session_id FROM public.subscription_purchase_orders WHERE id=$1',[orderId]),
      [{status:'draft',provider_session_id:null}]);
    await begin();
    await repairCheckoutInTransaction(q,input);
    await q('COMMIT');
    assert.deepEqual(await installedFunctions(read),after);
    await verify(reader);
    assert.deepEqual(await read('SELECT status,provider_session_id FROM public.subscription_purchase_orders WHERE id=$1',[orderId]),
      [{status:'checkout_pending',provider_session_id:sessionId}]);
    assert.deepEqual(await read('SELECT status,reference FROM public.payment_records WHERE id=$1',[pay]),[{status:'pending',reference:sessionId}]);
    assert.deepEqual(await read('SELECT id FROM public.deployment_jobs'),[]);

    // Install only the new read function as the existing definer; the five
    // previously deployed routines and role ACLs must still match.
    await begin();
    const added=await installSandboxBillingFunctionInTransaction(q,{before:after,verifyGuards:assertFirstPurchaseInstalledRoles,
      verifyOrder:async (query,lock)=>{
        const rows=await query('SELECT status,provider_session_id,checkout_url FROM public.subscription_purchase_orders WHERE id=$1'+(lock?' FOR UPDATE':''),[orderId]);
        assert.deepEqual(rows,[{status:'checkout_pending',provider_session_id:sessionId,checkout_url:checkout.url}]);
      }});
    assert.equal(added.name,'read_billing_order');
    await q('COMMIT');
    const functions=await installedFunctions(read);
    assert.deepEqual(functions.filter(r=>r.name!=='read_billing_order'),after);
    assert.equal(functions.find(r=>r.name==='read_billing_order')?.owner,definer);
    const billingSql='SELECT sandbox_first_purchase.read_billing_order($1,$2) AS value';
    async function readAsWeb(sql,args) {
      await root.query('BEGIN READ ONLY');
      try {
        await root.query('SET LOCAL ROLE '+web);
        return (await root.query(sql,args)).rows;
      } finally {
        await root.query('ROLLBACK');
      }
    }
    await assert.rejects(readAsWeb('SELECT id FROM public.subscription_purchase_orders'),{code:'42501'});
    assert.deepEqual(await readAsWeb(billingSql,[actor,orderId]),
      [{value:{orderId,status:'checkout_pending',amount:1500,currency:'CAD',checkoutUrl:checkout.url}}]);
    assert.deepEqual(await readAsWeb(billingSql,['usr_other_fixture',orderId]),[{value:null}]);
    assert.deepEqual(await readAsWeb(billingSql,[actor,'ord_other_fixture']),[{value:null}]);
    for(const [column,value] of [['expires_at',1],['checkout_url','https://checkout.stripe.com/sandbox/pay/cs_test_Other']]){
      await writer.query(`UPDATE public.subscription_purchase_orders SET ${column}=$1 WHERE id=$2`,[value,orderId]);
      assert.deepEqual(await readAsWeb(billingSql,[actor,orderId]),
        [{value:{orderId,status:'checkout_pending',amount:1500,currency:'CAD',checkoutUrl:null}}]);
      await writer.query(`UPDATE public.subscription_purchase_orders SET ${column}=$1 WHERE id=$2`,
        [column==='expires_at'?expiry:checkout.url,orderId]);
    }
    assert.deepEqual(await readAsWeb('SELECT sandbox_first_purchase.read_order($1,$2) AS value',[actor,orderId]),
      [{value:{orderId,status:'checkout_pending',amount:1500,currency:'CAD'}}]);

    await runtime.connect();await runtime.query('BEGIN READ ONLY');
    const {rows:[r]}=await runtime.query('SELECT current_user AS actor,session_user AS login');assert.deepEqual(r,{actor:webhook,login:webhook});
    await runtime.query('SAVEPOINT no_billing');
    await assert.rejects(runtime.query(billingSql,[actor,orderId]),{code:'42501'});
    await runtime.query('ROLLBACK TO SAVEPOINT no_billing');
    await assert.rejects(runtime.query('SELECT sandbox_first_purchase.read_order($1,$2)',['usr_mock','ord_mock']),{code:'42501'});
  }finally{await Promise.allSettled([root.end(),writer.end(),reader.end(),runtime.end()]);}
});
