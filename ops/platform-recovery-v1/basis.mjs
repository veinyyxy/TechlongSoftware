// Local request profile. Cloud entry imports basis-core, never this local slot.
import {RECOVERY_SCOPE} from './profile.mjs';
import {freeze,recoveryBasisCompiler} from './basis-core.mjs';
export {must,same,freeze,recoveryData,assertRetirement,recoveryBasisCompiler} from './basis-core.mjs';
export const RECOVERY=freeze({...RECOVERY_SCOPE,requestSlot:'F:/ChatGPT_workshop/techlong-w9e-new-held-request.intent.json'});
export const prepareRecoveryBasis=recoveryBasisCompiler(RECOVERY);
