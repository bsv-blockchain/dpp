# For AI agents

This page is for an AI agent asked to read, issue, verify or operate digital product passports with this standard. It gives the facts to rely on, how to run what the pages show, where a human must act, and where to stop and ask. Then follow the path for your task in [choose your path](choose-your-path.md).

## Facts to rely on

| Fact | Value |
|---|---|
| Current release set | `dpp-release-2026-10-4`, published on npm under `latest` on 2 October 2026 |
| Packages | `@bsv/dpp-core@0.3.0-beta.7`, `@bsv/dpp-profiles@0.3.0-beta.7`, `@bsv/dpp-overlay-topics@0.4.0-beta.7`, `@bsv/vsc@0.2.0-beta.5`, with `@bsv/sdk@2.8.10` |
| Install | Always name the exact version, even though npm's `latest` tag names the current set |
| Runtime | Node.js 22 or later, ECMAScript modules |
| Record version to write | Version 2, under the custody profile `managed-custody@1`; version 1 passports still verify |
| Demonstration application | `https://dpp.bsvb.net`, with the verifier at `https://dpp.bsvb.net/verify`: sample brands, mock data, real mainnet transactions |
| Hosted index | `https://dpp-overlay.bsvb.net`: lookups, `/history`, `/capabilities`, `/evidence-package`, `/health` and the synchronisation routes are open; `/submit`, `/retract`, `/arc-ingest` and `/evidence-export` need its operator's tokens |
| Hosted registry | `https://dpp-resolver.bsvb.net`: validation and reads are open; storing a claim needs its write token |
| These pages as text | [`llms.txt`](https://dpp.bsvb.net/docs/llms.txt) lists every page; [`llms-full.txt`](https://dpp.bsvb.net/docs/llms-full.txt) holds them all in one file |
| Source | [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp), default branch `main` |
| Words | [Words used here](glossary.md) defines every term |

## How to run what the pages show

- **Shell blocks** run from the root of a checkout of the repository on `main`, after `npm ci` and `npm run build`, unless the page says otherwise. The examples import the packages the checkout builds.
- **JavaScript blocks** run as a file: save the block as `name.mjs` in a project where the exact package versions are installed, and run `node name.mjs`. They use top-level `await`.
- **A block marked as a fragment** shows one step and does not run alone; the page links the complete example.
- **Success** reads the same everywhere: one sentence per check, never a score. A line starting `ok:` or `Holds:` held; `FAIL:` did not, and the command exits non-zero. An example that checks itself ends with `Every sentence above holds.`
- **A report** gives each check `pass`, `fail`, `unknown` or `not-applicable` with a reason code. `unknown` means the evidence was missing, not that the check failed.
- **Dry runs** come first. `node examples/write-passport.mjs --dry-run` and `node examples/lifecycle-v2.mjs` write passports without a wallet, funds or network.

## Steps a human must take

Stop and hand over to a person for these:

- funding a wallet, and approving its prompts;
- anything that spends satoshis on mainnet, which every live write does;
- obtaining a token for a hosted service, or asking the programme to name an index as a peer ([contact the programme](choose-your-path.md#contact-the-programme));
- obtaining a GS1 company prefix and GTINs, or choosing and controlling the host a passport identifier uses ([identifiers](../identifiers.md));
- signing a publisher policy with an operator's keys.

## Stop and ask, do not invent

The [open questions](../operate/limitations.md#open-questions-in-the-standard) are not settled, for example how restricted tiers other than the owner tier are disclosed, or which fields `event_data` carries. If a task depends on one, say so and ask. Read the rest of [known limitations](../operate/limitations.md) before you promise an outcome.

## Never

- Write a passport under a GTIN the brand is not entitled to. For tests, use GS1 demonstration prefix 952 on a host you control.
- Use `id.gs1.org` as the host for a new passport's identifier.
- Send one index's token to another index.
- Treat an index's or registry's answer as proof. Verify the bytes yourself, as every reading example does.
- Describe a result as compliance, certification or product qualification. The standard claims none of these.
