// Only a separately reviewed Git publication may replace this public binding.
import type { ReleaseBinding } from './contract.ts';
export interface InstalledBindingV6 {
  state: 'UNPUBLISHED' | 'PUBLISHED';
  platform: ReleaseBinding;
  publisher: {state: 'UNPUBLISHED' | 'PUBLISHED'; releaseSha256: string | null; frozenSourceCommit: string | null};
}
const freeze = (value:InstalledBindingV6) => Object.freeze({...value,
  platform:Object.freeze(value.platform),publisher:Object.freeze(value.publisher)});
export const INSTALLED_BINDING_V6: Readonly<InstalledBindingV6> = freeze({
  "state": "UNPUBLISHED",
  "platform": {"state":"UNPUBLISHED","workflowId":null,"actorId":null,"reusableCommit":null,"closureSha256":null,"identityProofSha256":null,"installationSha256":null,"riskSha256":null},
  "publisher": {"state":"UNPUBLISHED","releaseSha256":null,"frozenSourceCommit":null}
});
