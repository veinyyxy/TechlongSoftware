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
  "state": "PUBLISHED",
  "platform": {
    "state": "PUBLISHED",
    "workflowId": "390829326",
    "actorId": "344813947",
    "reusableCommit": "4588febb7b33378ccf2aa1a2b552a18660be8292",
    "closureSha256": "828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a",
    "identityProofSha256": "1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca",
    "installationSha256": "0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1",
    "riskSha256": "e248044029c1c9f38965be6018b0b52bb045677ce48dc5c262d1a54e6400300f"
  },
  "publisher": {
    "state": "PUBLISHED",
    "releaseSha256": "268efbd9674824f79cb453e82a05bd09b5d7fd3c01c3c277f6506f850ae79d40",
    "frozenSourceCommit": "ca2b38d8c756dd8fb800a88ded596c93687f278f"
  }
});
