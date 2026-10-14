'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local audited query decorator; no credential or connection API. */
const db=require('./aurora-database-contract-v2.cjs');
const {explain}=require('./aurora-express-c3-catalog-diagnostic.cjs');
const {EMPTY_CATALOG_SHA}=require('./aurora-express-c3-restore-review.cjs');
const fail=code=>{throw Error(code);};
const phases=['empty-before-write','baseline-before-verifier','migrated-before-verifier','independent-final','independent-after-stop'];
const list=Array.isArray;
const safeLabel=v=>['public','postgres','rdsadmin','rds_iam','rds_superuser','pg_database_owner','PUBLIC','EXTENSION_SCRIPT_OWNER','uuid-ossp'].includes(v)
  ? {value:v}:{sha256:db.digest(v??null)};
const safeAcl=acl=>list(acl)?acl.slice(0,16).map(a=>({grantor:safeLabel(a.grantor),grantee:safeLabel(a.grantee),
  privilege:['CREATE','USAGE','SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','EXECUTE'].includes(a.privilege)?a.privilege:'OTHER',
  grantable:a.grantable===true})):null;
function objectFailures(c){
  return ['relations','functions','types'].flatMap(kind=>c[kind].map(v=>{
    const reasons=[];
    if(v.schema!=='public')reasons.push('schema');
    if(v.owner!=='postgres'&&!(kind==='functions'&&v.extensionOwned))reasons.push('owner');
    if(kind==='relations'){
      if(!['r','i','S'].includes(v.kind))reasons.push('kind');
      if(v.persistence!=='p'||v.rls!==false||v.forceRls!==false)reasons.push('persistence_rls');
      if(!list(v.rules)||v.rules.length||!list(v.policies)||v.policies.length)reasons.push('rules_policies');
      if(!list(v.acl)||v.acl.some(a=>a.grantee!=='postgres'||a.grantor!=='postgres'||a.grantable))reasons.push('acl');
      if(!list(v.columns)||v.columns.some(a=>a.acl!==null))reasons.push('column_acl');
    }else if(kind==='functions'){
      if(v.securityDefiner||v.leakproof||v.config!==null)reasons.push('security_config');
      if(!list(v.acl)||v.acl.some(a=>a.grantor!==v.owner||!['PUBLIC',v.owner].includes(a.grantee)||a.privilege!=='EXECUTE'||a.grantable))reasons.push('acl');
    }else if(v.acl!==null)reasons.push('acl');
    return reasons.length?{kind,objectSha256:db.digest([v.schema,v.name,v.arguments||null]),reasons,owner:safeLabel(v.owner),
      acl:kind==='types'?undefined:safeAcl(v.acl),aclIsNull:kind==='types'?v.acl===null:undefined,
      configIsNull:kind==='functions'?v.config===null:undefined,securityDefiner:kind==='functions'?v.securityDefiner===true:undefined,
      leakproof:kind==='functions'?v.leakproof===true:undefined,extensionOwned:kind==='functions'?v.extensionOwned===true:undefined}:null;
  }).filter(Boolean).slice(0,8));
}
function catalogReport({result,tables,phase,verifyCatalog}) {
  const c=result?.rows?.[0]?.identity;
  if (!phases.includes(phase) || result?.rowCount!==1 || !c || Buffer.byteLength(db.canonicalJson(c))>4000000 ||
    !['schemas','relations','functions','extensions','types','collations','eventTriggers'].every(k=>list(c[k])) ||
    !list(tables) || tables.length!==73 || new Set(tables).size!==73 || typeof verifyCatalog!=='function') fail('EXPRESS_C3F_CATALOG_REPORT_REJECTED');
  const checks=explain(c,tables); let original={accepted:true,code:null};
  try {verifyCatalog(result,tables);} catch(e) {
    if(e.message!=='AURORA_V3_PG17_CATALOG_REJECTED') fail('EXPRESS_C3F_CATALOG_VERIFIER_UNEXPLAINED');
    original={accepted:false,code:e.message};
  }
  if (original.accepted!==checks.every(v=>v.accepted)) fail('EXPRESS_C3F_CATALOG_EXPLAINER_DISAGREES');
  const empty=['relations','functions','extensions','types','collations','eventTriggers'].every(k=>c[k].length===0);
  return {schema:'techlong/express-restore-catalog-report/v1',phase,catalogSha256:db.digest(c),catalogBytes:Buffer.byteLength(db.canonicalJson(c)),
    originalValidation:original,checks,rejectedPredicates:checks.filter(v=>!v.accepted).map(v=>v.id),allUserObjectsEmpty:empty,
    inventory:Object.fromEntries(['schemas','relations','functions','extensions','types','collations','eventTriggers'].map(k=>[k,c[k].length])),
    schemas:c.schemas.slice(0,8).map(s=>({name:safeLabel(s.name),owner:safeLabel(s.owner),acl:list(s.acl)?s.acl.slice(0,16).map(a=>
      ({grantor:safeLabel(a.grantor),grantee:safeLabel(a.grantee),privilege:['CREATE','USAGE'].includes(a.privilege)?a.privilege:'OTHER',grantable:a.grantable===true})):null})),
    extensions:c.extensions.slice(0,8).map(e=>({name:safeLabel(e.name),owner:safeLabel(e.owner),versionMatches:e.version==='1.1',schemaMatches:e.schema==='public'})),
    objectRejections:objectFailures(c),
    rawDefinitionsSaved:false,structuralPinInstalled:false,runtimeEnabled:false,lifecycleCompatible:false};
}
// One decorator per tenant client. Native query allowlisting/counting and exact
// session identity are supplied by the root; management clients are undecorated.
// Empty check adds just one fixed catalog SELECT inside the existing transaction.
function createCaptureQuery({nativeQuery,approval,programs,tables,verifyCatalog,saveReport,inspectOnly=false}) {
  if ([nativeQuery,approval,verifyCatalog,saveReport].some(f=>typeof f!=='function') || typeof inspectOnly!=='boolean' ||
    !programs || ![programs.empty,programs.catalog,programs.restore,programs.verification,programs.rows].every(v=>typeof v==='string') ||
    !list(programs.migrations) || programs.migrations.length!==2) fail('EXPRESS_C3F_CAPTURE_ARGUMENTS_REJECTED');
  let empty=false,restore=false,catalogs=0,baselineAccepted=false,finalAccepted=false,migrations=0;
  const report=async(result,phase)=>{const r=catalogReport({result,tables,phase,verifyCatalog}); await saveReport(r);return r;};
  return async(query,...args)=>{
    approval(); const text=typeof query==='string'?query:query?.text;
    if (inspectOnly && [programs.empty,programs.restore,programs.verification,...programs.migrations].includes(text))
      fail('EXPRESS_C3F_INSPECT_WRITE_REJECTED');
    if(text===programs.restore && (!empty || restore)) fail('EXPRESS_C3F_RESTORE_PRECONDITION_REQUIRED');
    if(programs.migrations.includes(text) && (!baselineAccepted || text!==programs.migrations[migrations]))
      fail('EXPRESS_C3F_MIGRATION_ORDER_REJECTED');
    if(text==='COMMIT' && (!finalAccepted || !inspectOnly && migrations!==2)) fail('EXPRESS_C3F_COMMIT_CAPTURE_REQUIRED');
    // Mark submission before dispatch: a lost response never permits replay.
    if(text===programs.restore) restore=true;
    const result=await nativeQuery(query,...args); approval();
    if(text===programs.empty) {
      if(empty || result.rowCount!==1 || String(result.rows?.[0]?.objects)!=='0' || String(result.rows?.[0]?.closed_public_schema)!=='1')
        fail('EXPRESS_C3F_EMPTY_DATABASE_REQUIRED');
      const observed=await nativeQuery(programs.catalog),r=await report(observed,'empty-before-write');
      if(!r.allUserObjectsEmpty || r.catalogSha256!==EMPTY_CATALOG_SHA) fail('EXPRESS_C3F_EMPTY_CATALOG_CHANGED');
      empty=true;
    } else if(text===programs.catalog) {
      const phase=inspectOnly?'independent-final':catalogs===0?'baseline-before-verifier':'migrated-before-verifier';
      if(catalogs>=(inspectOnly?1:2) || !inspectOnly && (!restore || catalogs===1 && migrations!==2)) fail('EXPRESS_C3F_CATALOG_ORDER_REJECTED');
      const r=await report(result,phase); catalogs++;
      if(phase==='baseline-before-verifier') baselineAccepted=r.originalValidation.accepted;
      else finalAccepted=r.originalValidation.accepted;
    } else if(programs.migrations.includes(text)) migrations++;
    return result;
  };
}
module.exports={catalogReport,createCaptureQuery};
