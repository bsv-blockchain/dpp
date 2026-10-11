# For AI agents

This page is for an AI agent asked to plan, read, issue, verify or operate digital product passports with this standard. Use the same canonical task guides as a person. Establish the requested outcome, selected version/source, inputs and authorised actions before choosing components. Do not interpret a request to evaluate a platform as permission to deploy it or spend funds.

## Choose a small reading set

| Task | Read first | Completion evidence |
|---|---|---|
| Plan a full production platform | [Platform planning](plan-your-platform.md), [component choices](choose-components-and-services.md), [current status](status.md) | A scoped brief with service responsibilities, actual access arrangements and unresolved dependencies |
| Verify a passport | [Quick start](../quick-start.md), [identifiers](../identifiers.md), [evidence reports](../learn/evidence-and-freshness.md) | Report with exact subject/source, checks and reasons for missing evidence |
| Issue or update | [Build an application](../packages/build-an-application.md), [writer details](../packages/how-the-writer-works.md), [wallet and proofs](../operate/wallet-broadcast-proofs.md) | Controlled write workflow with authorised signing, valid data, journal and retained evidence |
| Add a native claim | [Add a claim](../packages/add-a-claim.md), [registry role](../implement/roles/registry.md), [contracts](../reference/contracts.md) | Supported claim with separately stated validation, storage, anchor and authority results |
| Operate an index | [Create an index](../packages/create-dpp-index.md), [operator hub](../operate/overview.md), [access details](../deployment.md), [recovery](../operate/export-import-recovery.md) | One generated project with its included runtime, correct role/access configuration and evidence of recovery; peers only when selected |
| Implement a role independently | [Independent implementation](../implement/README.md), the selected role guide, [specifications](../reference/specifications.md), [reporting](../implement/reporting.md) | Requirements and fixture evidence, with disagreements recorded |

Read the relevant [limitations](../operate/limitations.md) before promising the outcome. Other tasks remain in [the full task index](choose-your-path.md). No task needs every package or every service merely because they appear in this documentation.

## Facts to rely on

| Fact | Value |
|---|---|
| Source candidate | `dpp-release-2026-10-8`, publication pending; [release status and receipts](../reference/release-sets.md) distinguish it from the earlier published packages |
| Candidate packages | `@bsv/dpp-protocol@0.3.0-beta.9`, `@bsv/dpp-profiles@0.3.0-beta.9`, `@bsv/dpp-overlay-topics@0.4.0-beta.11`, `@bsv/vsc@0.2.0-beta.5`, with `@bsv/sdk@2.8.10` |
| Install | Use the [local candidate archives](../packages/README.md#use-the-renamed-source-candidate) until publication. Pin exact versions and retain the lockfile; do not infer publication from a source version or a dist-tag |
| Runtime | Node.js 22 or later, ECMAScript modules |
| Record version to write | Version 2, under the custody profile `managed-custody@1`; version 1 passports still verify |
| Demonstration application | `https://dpp.bsvb.net`, with the verifier at `https://dpp.bsvb.net/verify`: sample brands that write nothing to the chain; brands a signed-in user creates write real mainnet transactions, marked as samples |
| Hosted index | `https://dpp-overlay.bsvb.net`: lookups, `/history`, `/capabilities`, `/evidence-package`, `/health` and the synchronisation routes are open; `/submit`, `/retract`, `/arc-ingest` and `/evidence-export` need its operator's tokens |
| Hosted registry | `https://dpp-resolver.bsvb.net`: validation and reads are open; storing a claim needs its write token |
| Hosted proof page | `https://dpp-proof.bsvb.net`: the hosted registry's claims checked against their anchors. `node examples/check-registry.mjs <registry>` does the same for any registry ([run an anchor proof page](../implement/roles/attestation-verifier.md#run-an-anchor-proof-page)) |
| These pages as text | [`llms.txt`](https://dpp.bsvb.net/docs/llms.txt) lists every page; [`llms-full.txt`](https://dpp.bsvb.net/docs/llms-full.txt) holds them all in one file |
| Source | [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp), default branch `main` |
| Example source | Record `git rev-parse HEAD` in the [source checkout](../quick-start.md#get-the-code); use a receipt's exact revision to reproduce that historical publication |
| Words | [Words used here](glossary.md) defines every term |

## How to run what the pages show

- **Shell blocks** run from the root of the [reviewed checkout](../quick-start.md#get-the-code), after `npm ci` and `npm run build`, unless the page names another directory or revision. Run starter project commands inside the generated project. The repository examples import the packages the checkout builds. Use a publication receipt's revision to reproduce that package; a matching version string does not prove source and npm archives are identical.
- **JavaScript blocks** run as a file: save the block as `name.mjs` in a project where the exact package versions are installed, and run `node name.mjs`. They use top-level `await`.
- **A block marked as a fragment** shows one step and does not run alone; the page links the complete example.
- **Success** reads the same everywhere: one sentence per check, never a score. A line starting `ok:` or `Holds:` held; `FAIL:` did not, and the command exits non-zero. An example that checks itself ends with `Every sentence above holds.`
- **A report** gives each check `pass`, `fail`, `unknown` or `not-applicable` with a reason code. `unknown` means the evidence was missing, not that the check failed.
- **A bare `01/<gtin>/21/<serial>` is not a passport identifier.** Resolve it with `node examples/verify-passport.mjs 01/<gtin>/21/<serial> <index URL>`, which lists every passport the index holds for that GS1 key by its exact identifier; never add a host yourself ([identifiers](../identifiers.md#use-the-identifier-throughout-the-request)).
- **Dry runs** come first. `node examples/write-passport-v2.mjs --dry-run` and `node examples/lifecycle-v2.mjs` construct and check version 2 passports without a wallet, funds or network. `node examples/check-registry.mjs --fixture` checks registry claims offline. The historical `node examples/write-passport.mjs --dry-run` remains for version 1 compatibility, not as the default new-write path.
- **Runtime support** comes from the [support table](../packages/support-table.md). Node/ESM support does not establish browser module support. Declare the SDK when directly importing it, and follow profile asset-packaging instructions.
- **Product data** needs a separate check against its declared profile. A valid transaction report does not establish profile validity. Start with `node examples/sample-payload.mjs` and the [profile validation guide](../packages/dpp-profiles.md#check-a-payload-against-its-profile), not an unchecked hosted sample.
- **Service choices** come from the selected task. Native lifecycle claims use core helpers, without a mandatory VSC dependency. A reader does not need a funded wallet. An HTTP index client does not need the overlay hosting package.
- **Index scaffolding** starts with `@bsv/create-dpp-index`, which includes `@bsv/dpp-overlay-topics` as the generated project's runtime dependency. Do not add a separate runtime installation or start the repository's index alongside it. Direct runtime integration and source deployment are alternatives for custom requirements. The [index starter guide](../packages/create-dpp-index.md) names its publication prerequisite, setup commands, explicit flags, JSON configuration and results, and app connection settings. A successful configuration check does not establish blockchain settlement or production readiness.

## Steps a human must take

Establish the appropriate human authority and any required external action for these. If the user has already authorised the exact action and spending scope, proceed within it; otherwise prepare the reversible work and stop before the unauthorised action:

- funding a wallet, and approving its prompts;
- anything that spends satoshis on mainnet, which every live write does;
- obtaining a token for a hosted service, or asking the programme to name an index as a peer ([contact the programme](choose-your-path.md#contact-the-programme));
- obtaining a GS1 company prefix and GTINs, or choosing and controlling the host a passport identifier uses ([identifiers](../identifiers.md));
- signing a publisher policy with an operator's keys.

## Stop and ask, do not invent

The [open questions](../operate/limitations.md#open-questions-in-the-standard) are not settled, for example how restricted tiers other than the owner tier are disclosed, or which fields `event_data` carries. If a task depends on one, say so and ask. Read the rest of [known limitations](../operate/limitations.md) before you promise an outcome.

State the specific missing input, authority or decision and the step it blocks. Continue independent work that does not depend on it. Do not invent an index from the identifier host, a registry from an anchor, a trusted key from an operator name, a service token or an unsupported claim field. If discovery returns several exact passport identifiers, obtain the intended selection rather than silently choosing one.

For an index, verify the signed publisher policy against independently trusted operator identity keys before relying on its admission windows. Public reads do not grant write access. A discovered peer is not authorised to receive another service's credentials.

Keep published, source and deployed capabilities separate. The reviewed source has opt-in peer discovery and retry changes beyond npm overlay beta.9; the [hosted reference](../deployment.md) reports its own version and features. Follow the [disagreement process](../contribute/disagreements.md) when sources conflict. Do not silently settle an open standard question or claim a validation-only service implements the complete registry role.

## Never

- Write a passport under a GTIN the brand is not entitled to. For tests, use GS1 demonstration prefix 952 on a host you control.
- Use `id.gs1.org` as the host for a new passport's identifier.
- Send one index's token to another index.
- Treat an index's or registry's answer as proof. Verify the bytes yourself, as every reading example does.
- Describe a result as compliance, certification or product qualification. The standard claims none of these.
- Report missing proof, claim bytes or authority evidence as verified, or treat a bounded evidence package as a complete long-history backup.

## Report the outcome

Name the task completed, exact version or source revision, relevant configured services, checks performed and evidence still missing. Distinguish a verified result from a documented stop. Point to [production readiness](../operate/production-readiness.md) when the task concerns a complete platform; a successful example is not evidence that every production responsibility has been met.
