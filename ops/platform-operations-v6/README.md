# Reviewed platform operations V6

This is the **portable operator core**, consolidated after the W6w independent cloud acceptance. These modules have no CLI, credential discovery, default SDK client, server, workflow dispatcher or database connection. Importing them activates nothing. They are not imported by the web runtime or the published cloud execution closure.

| Module | Responsibility | Required capabilities |
| --- | --- | --- |
| `credentials.mjs` | Identity-verified temporary credential cache/refresh; at most6 loads; no fabricated expiry | Explicit `load`, `verifyIdentity`, approval/source `guard`, deadline and exact expected identity |
| `window.mjs` | Human page-ready receipt; bounded exact-plan ACK/run waits; page → Review → RunOnce orchestration | Explicit read/probe/record/publish ports, release/source/job, verified30min lease and bridge factory |
| `handoff.mjs` | Full Review reconstruction before observe1/proof1/reserved-plan1; eight-minute execution reserve | Separately approved exact observation/owner-write ports and permanent claim port |
| `evidence.mjs` | Full RunOnce/Inspect artifact verification, optionally deriving an Inspect plan **in memory only** | Exact authenticated run metadata, pinned result reference, explicit versioned-object reader and published release binding |

## Entry points and non-goals

```js
import {createVerifiedCredentialPort} from './credentials.mjs';
import {createReadyGatedDriver} from './window.mjs';
import {createRecoveryHandoff} from './handoff.mjs';
import {verifyCloudResultContent} from './evidence.mjs';
```

No module is itself an approved live command. The separate [reviewed Inspect CLI](../platform-operator-v6/cli.mjs) now binds a fresh manifest, exact source/job/release/endpoints, permanent write-once slots, bounded I/O and private-material scope; its [risk and usage document](../../docs/aws-auto-deployment-platform-w6y-operator-entry.md) distinguishes implementation from authorization. Constructing these functions or setting an environment variable does not grant that authority. There is deliberately no “resume”, automatic re-run, catch-up or implicit owner fallback.

`createReadyGatedDriver` requires `bridgeFactory:createRecoveryHandoff` explicitly; it never dispatches workflows. The human must approve the exact plan/action/risk and GitHub environment. The anonymous login probe is not a substitute for the separate human page-ready receipt. The bridge has real write capabilities **only when passed approved ports**, and its three submissions are not a distributed transaction.

`verifyCloudResultContent` supplies an explicitly ephemeral observed view based on exact authenticated GitHub metadata solely for the original publisher's complete content reconstruction. It does **not** load, verify or attest a persisted controller ledger. Its output always says `platformLedgerVerified:false`, `physicalOwnerWrites:0`, `proofImported:false`, `successorPublished:false` and `executionApproved:false`. `independentCloudAcceptanceVerified` is true only for a successfully reconstructed independent Inspect, never merely a successful RunOnce or GitHub run. A derived Inspect plan is not published or approved.

The new core retains the published controller's fixed sandbox instance contract. Explicit source/job inputs remove historical run coupling; they do not turn this into an unrestricted multi-tenant executor.

## Reproducible tests (no external archive or credentials)

From the repository root, Node22.13+:

```sh
node --experimental-strip-types --test tests/platform-operations-credentials-v6.test.mjs tests/platform-operations-window-v6.test.mjs tests/platform-operations-evidence-v6.test.mjs
node node_modules/eslint/bin/eslint.js ops/platform-operations-v6/ tests/platform-operations-credentials-v6.test.mjs tests/platform-operations-window-v6.test.mjs tests/platform-operations-evidence-v6.test.mjs tests/fixtures/platform-operations-v6.mjs --max-warnings 0
```

All fixtures are synthetic and repository-relative. Existing No-AWS CI runs these checks. `package.json` and both existing cloud closures remain unchanged; adding an npm script there would change the published closure.

See [consolidation scope/provenance](../../docs/aws-auto-deployment-platform-w6x-code-consolidation.md) and [independent acceptance summary](../../docs/aws-auto-deployment-platform-w6w-independent-acceptance.md). The date-named original operators, manifests, private evidence and consumed slots stay in their original external archive. Never rewrite them to point at these new modules or run them again against an advanced main.
