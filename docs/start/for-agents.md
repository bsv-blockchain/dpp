# For AI agents

AI agents planning, reading, issuing, verifying or operating digital product passports can use this page to select a guide and report evidence. Follow the same canonical task guides as a person.

## Before you start

| Establish | Source |
|---|---|
| Requested outcome | The user's task and completion criteria. Evaluation does not authorise deployment or spending. |
| Selected version or source | The release selection, publication receipt or checkout revision. |
| Inputs | Task guide, user or operator: identifiers, data, services and evidence. |
| Authorised actions | The user's exact authority and spending scope; check before choosing components. |

## Choose a small reading set

| Task | Read first | Completion evidence |
|---|---|---|
| Plan a full production platform | [Platform planning](plan-your-platform.md), [component choices](choose-components-and-services.md), [current status](status.md) | Scoped brief, service responsibilities, confirmed access and unresolved dependencies |
| Verify a passport | [Quick start](../quick-start.md), [identifiers](../identifiers.md), [evidence reports](../learn/evidence-and-freshness.md) | Report naming subject/source, checks and missing-evidence reasons |
| Issue or update | [Build an application](../packages/build-an-application.md), [writer details](../packages/how-the-writer-works.md), [wallet and proofs](../operate/wallet-broadcast-proofs.md) | Controlled writes, authorised signing, valid data, journal and retained evidence |
| Add a native claim | [Add a claim](../packages/add-a-claim.md), [registry role](../implement/roles/registry.md), [contracts](../reference/contracts.md) | Supported claim; separate validation, storage, anchor and authority results |
| Operate an index | [Create an index](../packages/create-dpp-index.md), [operator hub](../operate/overview.md), [access details](../deployment.md), [recovery](../operate/export-import-recovery.md) | One generated project and included runtime, correct role/access settings, recovery evidence; peers only if selected |
| Implement a role independently | [Independent implementation](../implement/README.md), the selected role guide, [specifications](../reference/specifications.md), [reporting](../implement/reporting.md) | Requirements and fixture evidence, with disagreements recorded |

Read relevant [limitations](../operate/limitations.md) before promising an outcome. Find other routes in [the full task index](choose-your-path.md). Select only the packages and services the task needs.

## Facts to rely on

| Fact | Value |
|---|---|
| Source candidate | `dpp-release-2026-11`, publication pending: `@bsv/dpp-protocol@0.3.0-beta.10`, `@bsv/dpp-profiles@0.3.0-beta.10`, `@bsv/dpp-overlay@0.4.0-beta.13`, `@bsv/dpp-credentials@0.2.0-beta.6`, with `@bsv/sdk@2.8.10` ([release sets](../reference/release-sets.md)) |
| Published set | `dpp-release-2026-10-10`, under `latest` since 16 October 2026: `@bsv/dpp-protocol@0.3.0-beta.9`, `@bsv/dpp-profiles@0.3.0-beta.9`, `@bsv/dpp-overlay@0.4.0-beta.12`, `@bsv/dpp-credentials@0.2.0-beta.5`, with `@bsv/sdk@2.8.10` ([receipt](../reference/beta-11-publication.md)) |
| Former names | `@bsv/dpp-core`, `@bsv/dpp-overlay-topics` and `@bsv/vsc` stay at their historical versions; the [migration guide](../migration.md) maps each to its new name |
| Install | Use [local candidate archives](../packages/README.md#use-the-renamed-source-candidate) until publication. Pin versions, retain the lockfile; source versions and dist-tags do not prove publication |
| Runtime | Node.js 22 or later, ECMAScript modules |
| Record version to write | Version 2, under the custody profile `managed-custody@2` (the published October set selects `managed-custody@1`); version 1 passports still verify |
| Demonstration application | `https://dpp.bsvb.net`, with the verifier at `https://dpp.bsvb.net/verify`: sample brands that write nothing to the chain; brands a signed-in user creates write real mainnet transactions, marked as samples |
| Hosted index | `https://dpp-overlay.bsvb.net`: lookups, `/history`, `/capabilities`, `/evidence-package`, `/health` and the synchronisation routes are open; `/submit`, `/retract`, `/arc-ingest` and `/evidence-export` need its operator's tokens |
| Hosted registry | `https://dpp-resolver.bsvb.net`: validation and reads are open; storing a claim needs its write token |
| Hosted proof page | `https://dpp-proof.bsvb.net`: the hosted registry's claims checked against their anchors. `node examples/check-registry.mjs <registry>` does the same for any registry ([run an anchor proof page](../implement/roles/attestation-verifier.md#run-an-anchor-proof-page)) |
| These pages as text | [`llms.txt`](https://dpp.bsvb.net/docs/llms.txt) lists every page; [`llms-full.txt`](https://dpp.bsvb.net/docs/llms-full.txt) holds them all in one file |
| Source | [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp), default branch `main` |
| Example source | Record `git rev-parse HEAD` in the [checkout](../quick-start.md#get-the-code); reproduce historical publications at the receipt's exact revision |
| Words | [Words used here](glossary.md) defines every term |

## How to run what the pages show

| Command or block | Where and how to run it |
|---|---|
| Shell blocks | [Reviewed checkout](../quick-start.md#get-the-code) root after `npm ci` and `npm run build`, unless another directory or revision is named. Examples import workspace builds. |
| Starter commands | Inside the generated project. |
| Historical reproduction | Use the receipt's revision; matching version strings do not establish identical source and npm archives. |
| JavaScript blocks | Save as `name.mjs` in a project with exact package versions installed; run `node name.mjs`. They use top-level `await`. |
| A block marked as a fragment | One step, not runnable alone; links the complete example. |

1. Check the input rules before running a command.

| Input or component | Rule |
|---|---|
| Bare `01/<gtin>/21/<serial>` | Not a passport identifier. `node examples/verify-passport.mjs 01/<gtin>/21/<serial> <index URL>` lists every passport held for that GS1 key by exact identifier. Never add a host ([identifiers](../identifiers.md#use-the-identifier-throughout-the-request)). |
| Runtime | Use the [support table](../packages/support-table.md). Node/ESM support does not establish browser module support. Declare the SDK if directly imported; follow profile asset-packaging instructions. |
| Product data | Check its declared profile separately; a valid transaction report does not establish profile validity. Start with `node examples/sample-payload.mjs` and [profile validation](../packages/dpp-profiles.md#check-a-payload-against-its-profile), not an unchecked hosted sample. |
| Services | Native lifecycle claims use core helpers without a mandatory VSC dependency. Readers need no funded wallet; HTTP index clients need no overlay hosting package. |
| Index scaffold | `@bsv/create-dpp-index` includes runtime dependency `@bsv/dpp-overlay`. Do not separately install it or start the repository index alongside it. Custom alternatives: direct runtime integration or source deployment. |

For a GS1 key lookup, use the selected index URL:

```sh
node examples/verify-passport.mjs 01/<gtin>/21/<serial> <index URL>
```

2. Run dry exercises first.

| Command | Expected scope |
|---|---|
| `node examples/write-passport-v2.mjs --dry-run` and `node examples/lifecycle-v2.mjs` | Construct and check version 2 passports without wallet, funds or network. |
| `node examples/check-registry.mjs --fixture` | Check registry claims offline. |
| `node examples/write-passport.mjs --dry-run` | Historical version 1 compatibility, not the default new-write path. |

```sh
node examples/write-passport-v2.mjs --dry-run
node examples/lifecycle-v2.mjs
node examples/check-registry.mjs --fixture
```

The [index starter guide](../packages/create-dpp-index.md) supplies the publication prerequisite, setup, explicit flags, JSON configuration, results and app connection settings. Passing configuration checks establishes neither blockchain settlement nor production readiness.

3. Interpret the output check by check.

| Output | Meaning |
|---|---|
| `ok:` or `Holds:` | The check held. |
| `FAIL:` | The check did not hold; the command exits non-zero. |
| `Every sentence above holds.` | A self-checking example's final line. Success uses one sentence per check, never a score. |
| Report | Each check gives `pass`, `fail`, `unknown` or `not-applicable` and a reason code. `unknown` means missing evidence, not a failed check. |

## Steps a human must take

Proceed within existing authorisation for the exact action and spending scope. Otherwise prepare reversible work, then stop before actions needing human authority or external action:

- funding a wallet, and approving its prompts;
- anything that spends satoshis on mainnet, which every live write does;
- obtaining a token for a hosted service, or asking the programme to name an index as a peer ([contact the programme](choose-your-path.md#contact-the-programme));
- obtaining a GS1 company prefix and GTINs, or choosing and controlling the host a passport identifier uses ([identifiers](../identifiers.md));
- signing a publisher policy with an operator's keys.

## Stop and ask, do not invent

The [open questions](../operate/limitations.md#open-questions-in-the-standard) are not settled, for example how restricted tiers other than the owner tier are disclosed, or which fields `event_data` carries. If a task depends on one, say so and ask. Read the rest of [known limitations](../operate/limitations.md) before you promise an outcome.

Name the missing input, authority or decision and the blocked step; continue independent work. Never invent an index from an identifier host, a registry from an anchor, a trusted key from an operator name, a token or an unsupported claim field. If discovery returns several exact passport identifiers, obtain the intended selection.

Verify an index's signed publisher policy against independently trusted operator identity keys before relying on admission windows. Public reads grant no write access. A discovered peer is not authorised to receive another service's credentials.

Keep published, source and deployed capabilities separate. The published beta.10 overlay offers opt-in peer discovery, advertising and retry; the [hosted reference](../deployment.md) reports its own version and features and leaves those options off. Follow the [disagreement process](../contribute/disagreements.md) for conflicting sources. Do not settle open standard questions or describe validation alone as the complete registry role.

## Never

- Write a passport under a GTIN the brand is not entitled to. For tests, use GS1 demonstration prefix 952 on a host you control.
- Mint a new passport's identifier under a host that does not answer for it. `id.gs1.org` answers only for GTINs whose licensee has registered link targets with GS1, and never for one under 952, so use a host you control unless that registration exists ([what registering with GS1 gives you](../identifiers.md#what-registering-with-gs1-gives-you)).
- Send one index's token to another index.
- Treat an index's or registry's answer as proof. Verify the bytes yourself, as every reading example does.
- Describe a result as compliance, certification or product qualification. The standard claims none of these.
- Report missing proof, claim bytes or authority evidence as verified, or treat a bounded evidence package as a complete long-history backup.

## Report the outcome

Report the task, exact version or source revision, configured services, checks and missing evidence. Distinguish verified results from documented stops. For a complete platform, use [production readiness](../operate/production-readiness.md): a successful example does not establish every production responsibility.
