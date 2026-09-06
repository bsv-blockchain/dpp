# The application service

**Audience:** a team that wants the reference writer, custody workflow and journal without the reference web application. **Where it lives:** `packages/dpp-service` in the application repository ([bsv-blockchain-demos/dpp-app](https://github.com/bsv-blockchain-demos/dpp-app)), package `@dpp/service` 0.2.0. **Not part of the release set.** **Canonical source:** the package's own source and the release set's `serviceInterface` entry, which names it as the account-agnostic entry point over the writer's journal.

This page is the audit the release plan asked for: what the façade exports today, which of it is the supported interface, what it depends on, and what a consumer needs to know before relying on it. It is documentation of an existing component, not a proposal to extract or publish it, and it adds nothing to the four-package standard release.

## What it is

`@dpp/service` is the reference application's protocol layer, extracted so it imports no web framework, no hosting vendor and no database driver. Storage, wallets, indexes, resolvers, proof sources and identity services arrive through interfaces; the application decides what runs and the service decides what it means. Its centre is `PassportService`: one entry point over the writer, the store and the custodian's keys, with nothing of the application's workspaces, brands or sessions in it. A caller names who acts by a principal (an identity the custodian derives keys for), and authority is what the record proves: the principal controls the tip, or is an authority the deployment names, or is refused. There is no account in it to associate, which is why an account association grants no protocol right.

## The supported interface

| Entry point | Exports | Status |
|---|---|---|
| `@dpp/service` | Everything below, as one barrel | Supported |
| `@dpp/service/verify` | The read side: attestation, ownership, resolver, proofs, chain tracker, lifecycle, JWS, profiles, digital link, object DID, the evidence report and UNTP helpers | Supported; imports no wallet and no store |
| `@dpp/service/server` | The write side: identities, wallet, offline mode, workspaces, handles, store, DID methods, photos, the journal, the writer, operator, custody, `PassportService` and `dppService` | Supported; needs the injected services |
| `@dpp/service/*` | Any module by file name | Transitional: exists while the extraction settles, and a consumer should not depend on module names that the two named subpaths do not re-export |

`PassportService` operations: `issue`, `update`, `offer`, `accept`, `decline`, `retire`, `upgrade`, `status`, `operation`, `settle`, `verify` and `exportEvidence`. Every durable one goes through the journal.

## The journal and its states

One durable record per attempt to write a state, keyed by the caller's idempotency key, carrying everything a writer needs to finish or abandon the attempt after a crash. Two vocabularies are kept apart on purpose. The **operation state** says what became of the candidate between the writer and the network: `prepared`, `verified`, `submitted`, `accepted`, `rejected`, `competing`. The **mining state** says what became of it between the network and the headers: `pending`, `proved`, `reorg-pending`. A state can be accepted and pending for an hour without either word changing the other. Duties owed to parties outside the writer (announce to an index, attest to the registry, push a proof) are recorded as target attempts with their own states, and `settle` reconciles what is unsettled. This is what makes a retry, a crash and a restart resume rather than repeat, and it is the reason the plan says not to recreate a writer elsewhere.

## Injected services

A `PassportService` takes an identity service, a passport store, a treasury wallet, an overlay submitter, a resolver client, and optionally a chain tracker (or `'scripts only'`), a proof source and a lock arrangement. The reference application supplies MongoDB, a wallet-toolbox client, its overlay and registry clients and its custody configuration; the offline mode supplies in-memory stand-ins for all of them, which is how the service's suites run without a network.

## Dependencies and compatibility

The package depends on `@bsv/sdk` 2.4.2, `@bsv/wallet-toolbox-client` 2.11.0 and `ajv` 8.20.0, and on the three DPP packages it consumes. Its manifest names those three with wildcard ranges, which works inside the application's workspace and says nothing to an external consumer. The compatibility policy this documentation states, and the application's alignment change applies, is that the service is tested against exactly one release set at a time and names it: today `dpp-release-2026-09-3` (`@bsv/dpp-core` 0.3.0, `@bsv/dpp-overlay-topics` 0.4.0, `@bsv/dpp-profiles` 0.3.0). A consumer that installs the service installs those versions.

## Release lifecycle

The service is an application component with its own dependencies (a wallet client, a JWS library in development) and its own suites, and it changes when the application does. It is therefore not added to the four-package standard release, and publishing it would be a separate decision with its own consumer check. Until then a consumer takes it from the application repository as a workspace package. Nothing here prevents that decision later; the audit's point is that it should be made explicitly, with the wildcard ranges replaced by a stated policy first.

## What using it proves

An application that uses `PassportService` reuses the reference's DPP rules through the core package it imports. That is a reference consumer, and a good way to build one. It is not an independent implementation of those rules, and a second application built on it demonstrates nothing about the standard beyond its reference implementation.
