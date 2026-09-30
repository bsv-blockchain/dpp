# Security policy

## Supported versions

The latest published prerelease of each package in this repository is supported, and so are the hosted reference services named on the [deployment page](docs/deployment.md#the-hosted-reference). Older versions stay available without a promise of backported fixes.

## Report a vulnerability privately

**Do not open a public issue or pull request for a suspected vulnerability.**

Use a [private GitHub security advisory](https://github.com/bsv-blockchain/dpp/security/advisories/new) or email **security@bsvassociation.org**. Include:

- the affected package and version, source revision or service;
- the practical impact, and what a deployment has to do for it to apply;
- reproduction steps or a proof of concept;
- whether you believe it is being exploited; and
- a proposed fix or mitigation, if you have one.

Do not include real private keys, production credentials, personal data or other secrets. Use synthetic data, or ask for a private handoff.

## What counts

[GOVERNANCE.md](GOVERNANCE.md#reporting-a-security-problem) defines a security problem. If you are unsure whether something counts, report it privately.

## Disclosure

Disclosure is coordinated with the reporter. A fix comes with a fixture or test that refuses the problem, and the report and the fix are published together.
