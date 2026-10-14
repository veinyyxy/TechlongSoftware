'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local V5 query decorator; no credential or connection API. */
const legacy=require('./aurora-express-c3-restore-capture.cjs');
const {EMPTY_CATALOG_SHA,CATALOG_POLICY_SHA}=require('./aurora-express-c3g-restore-review.cjs');
const fail=code=>{throw Error(code);},list=Array.isArray;
function catalogReport({result,tables,phase,verifyCatalog,frozenVerify}) {
  if(typeof verifyCatalog!=='function'||typeof frozenVerify!=='function') fail('EXPRESS_C3G_CATALOG_ARGUMENTS_REJECTED');
  const previous=legacy.catalogReport({result,tables,phase,verifyCatalog:frozenVerify});
  const c=result.rows[0].identity;
  const checks=previous.checks.map(p=>p.id==='uuid_extension_version_schema_owner'
    ? {...p,accepted:c.extensions?.[0]?.version==='1.1'&&c.extensions[0].schema==='public'&&c.extensions[0].owner==='rdsadmin'}:p);
  let admission={accepted:true,code:null};
  try {const verified=verifyCatalog(result,tables);
    if(verified.catalogSha256!==previous.catalogSha256||verified.catalogPolicySha256!==CATALOG_POLICY_SHA)
      fail('EXPRESS_C3G_ACTUAL_CATALOG_REQUIRED');
  } catch(e) {
    if(e.message!=='AURORA_V5_PG17_CATALOG_REJECTED') fail('EXPRESS_C3G_CATALOG_VERIFIER_UNEXPLAINED');
    admission={accepted:false,code:e.message};
  }
  if(admission.accepted!==checks.every(v=>v.accepted)) fail('EXPRESS_C3G_CATALOG_EXPLAINER_DISAGREES');
  return {...previous,schema:'techlong/express-restore-catalog-report/v2',frozenChecks:previous.checks,
    checks,rejectedPredicates:checks.filter(v=>!v.accepted).map(v=>v.id),admissionValidation:admission,
    catalogPolicySha256:CATALOG_POLICY_SHA,actualCatalogDigestPreserved:true};
}
function createCaptureQuery({nativeQuery,approval,programs,tables,verifyCatalog,saveReport,frozenVerify,inspectOnly=false}) {
  if ([nativeQuery,approval,verifyCatalog,saveReport,frozenVerify].some(f=>typeof f!=='function') || typeof inspectOnly!=='boolean' ||
    !programs || ![programs.empty,programs.catalog,programs.restore,programs.verification,programs.rows].every(v=>typeof v==='string') ||
    !list(programs.migrations) || programs.migrations.length!==2) fail('EXPRESS_C3G_CAPTURE_ARGUMENTS_REJECTED');
  let empty=false,restore=false,catalogs=0,baselineAccepted=false,finalAccepted=false,migrations=0;
  const report=async(result,phase)=>{const r=catalogReport({result,tables,phase,verifyCatalog,frozenVerify}); await saveReport(r);return r;};
  return async(query,...args)=>{
    approval(); const text=typeof query==='string'?query:query?.text;
    if (inspectOnly && [programs.empty,programs.restore,programs.verification,...programs.migrations].includes(text))
      fail('EXPRESS_C3G_INSPECT_WRITE_REJECTED');
    if(text===programs.restore && (!empty || restore)) fail('EXPRESS_C3G_RESTORE_PRECONDITION_REQUIRED');
    if(programs.migrations.includes(text) && (!baselineAccepted || text!==programs.migrations[migrations]))
      fail('EXPRESS_C3G_MIGRATION_ORDER_REJECTED');
    if(text==='COMMIT' && (!finalAccepted || !inspectOnly && migrations!==2)) fail('EXPRESS_C3G_COMMIT_CAPTURE_REQUIRED');
    // Mark submission before dispatch: a lost response never permits replay.
    if(text===programs.restore) restore=true;
    const result=await nativeQuery(query,...args); approval();
    if(text===programs.empty) {
      if(empty || result.rowCount!==1 || String(result.rows?.[0]?.objects)!=='0' || String(result.rows?.[0]?.closed_public_schema)!=='1')
        fail('EXPRESS_C3G_EMPTY_DATABASE_REQUIRED');
      const observed=await nativeQuery(programs.catalog),r=await report(observed,'empty-before-write');
      if(!r.allUserObjectsEmpty || r.catalogSha256!==EMPTY_CATALOG_SHA) fail('EXPRESS_C3G_EMPTY_CATALOG_CHANGED');
      empty=true;
    } else if(text===programs.catalog) {
      const phase=inspectOnly?'independent-final':catalogs===0?'baseline-before-verifier':'migrated-before-verifier';
      if(catalogs>=(inspectOnly?1:2) || !inspectOnly && (!restore || catalogs===1 && migrations!==2)) fail('EXPRESS_C3G_CATALOG_ORDER_REJECTED');
      const r=await report(result,phase); catalogs++;
      if(phase==='baseline-before-verifier') baselineAccepted=r.admissionValidation.accepted;
      else finalAccepted=r.admissionValidation.accepted;
    } else if(programs.migrations.includes(text)) migrations++;
    return result;
  };
}
module.exports={catalogReport,createCaptureQuery};
