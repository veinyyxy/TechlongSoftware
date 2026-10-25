// Fixed-size, allowlisted diagnostics. Never copy message, stack, cause or request.
const carried=new WeakMap();
const boundaries=new Set(['READ_PORT','CYCLE_TRANSPORT','HOSTED_HANDOFF','HOSTED_DRIVER','CYCLE_RUN','CYCLE_ENTRY']);
const stages=new Set(['UNCLASSIFIED','REFERENCE','S3_SEND','S3_METADATA','S3_BODY','S3_JSON','S3_SAFETY','S3_DIGEST',
  'GITHUB_REFERENCE','GITHUB_SEND','GITHUB_STATUS','GITHUB_BODY','GITHUB_JSON','S3_OBJECT','GITHUB_RUN','GITHUB_JOBS','GITHUB_LOG',
  'LOG_REDIRECT','LOG_BODY','HANDOFF_STOPPED','SOURCE_PRECHECK','RUN_ENTRY','INSPECT_ENTRY','PRE_APPROVAL','READONLY_PREFLIGHT',
  'PERMANENT_CLAIM','WINDOW_INTENT','UPDATE_STACK_SUBMISSION','WAIT_WINDOW','INDEPENDENT_WINDOW_READBACK','HOSTED_CONTINUOUS_APPROVAL',
  'SLOT_CLAIM_SUBMISSION','FULL_RECONSTRUCTION','OBSERVATION_SUBMISSION','PROOF_SUBMISSION','RESERVED_PLAN_SUBMISSION','INDEPENDENT_READBACK']);
const providerCodes=new Set(['AccessDenied','AccessDeniedException','NoSuchKey','NoSuchVersion','InvalidObjectState','ExpiredToken',
  'ExpiredTokenException','InvalidAccessKeyId','InvalidToken','InvalidClientTokenId','InvalidSignatureException','SignatureDoesNotMatch',
  'RequestTimeTooSkewed','SlowDown','ServiceUnavailable','InternalError','RequestTimeout','TimeoutError','AbortError',
  'CredentialsProviderError','ChecksumMismatchError','DeserializationError','SyntaxError','TypeError']);
const networkCodes=new Set(['ECONNRESET','ETIMEDOUT','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_STREAM_PREMATURE_CLOSE','UND_ERR_CONNECT_TIMEOUT']);
const validationCodes=new Set(['CYCLE_READS_REFERENCE','CYCLE_READS_METADATA','CYCLE_READS_BODY_SIZE','CYCLE_READS_BODY_LENGTH',
  'CYCLE_READS_HASH','CYCLE_READS_GITHUB_ID','CYCLE_READS_GITHUB_STATUS','CLOUD_V5_EVIDENCE_CAPABILITY_FIELD',
  'CLOUD_V5_EVIDENCE_SECRET_VALUE','CLOUD_V5_EVIDENCE_SIZE','CLOUD_WORKER_V5_EVIDENCE_CAPABILITY_FIELD',
  'CLOUD_WORKER_V5_EVIDENCE_SECRET_VALUE','CLOUD_WORKER_V5_EVIDENCE_SIZE','HOSTED_CYCLE_S3_OBJECT','CONTROL_V6_EXACT_RUN']);
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max?v:null;
export function operatorFailure(error,boundary,stage,observed={}){
  const existing=error&&typeof error==='object'?carried.get(error):null;
  if(existing)return Object.freeze({...existing,diagnosticRecordFailed:existing.diagnosticRecordFailed||observed.diagnosticRecordFailed===true});
  const names=[error?.name,error?.Code,error?.code],network=[error?.code,error?.cause?.code];
  return Object.freeze({schema:'techlong/operator-safe-failure/v6',boundary:boundaries.has(boundary)?boundary:'CYCLE_ENTRY',
    stage:stages.has(stage)?stage:'UNCLASSIFIED',providerCode:names.find(v=>providerCodes.has(v))??null,
    networkCode:network.find(v=>networkCodes.has(v))??null,validationCode:validationCodes.has(error?.message)?error.message:null,
    httpStatus:integer(observed.httpStatus??error?.$metadata?.httpStatusCode,100,599),
    sdkAttempts:integer(observed.sdkAttempts??error?.$metadata?.attempts,1,10),
    diagnosticRecordFailed:observed.diagnosticRecordFailed===true,detailsWithheld:true});
}
export function operatorError(error,boundary,stage,observed={}){
  const wrapped=new Error('OPERATOR_FAILED_REQUIRES_INSPECT_NO_RETRY');carried.set(wrapped,operatorFailure(error,boundary,stage,observed));return wrapped;
}
// Only a live, locally constructed diagnostic can be carried across this boundary.
export function recordedFailureError(failure,boundary,stage){
  const wrapped=new Error('OPERATOR_FAILED_REQUIRES_INSPECT_NO_RETRY');
  const safe=operatorFailure(null,boundary,stage);
  // Returned results are untrusted unless branded by this module in this process.
  carried.set(wrapped,branded.has(failure)?failure:safe);return wrapped;
}
const branded=new WeakSet();
export function recordedFailure(error,boundary,stage){const f=operatorFailure(error,boundary,stage);branded.add(f);return f;}
