// The operator's commands for moving this application: export, restore and
// declaring that an EPCIS source moved. They are run on the host, by whoever
// holds the deployment's settings, with the API and its worker stopped. That
// is the authorisation: there is no route for any of them, because the API
// has no operator role to give one to, and a signed-in member of a brand is
// not the operator of the deployment.
//
//   export --out <folder> [--public] [--passport <id>]... [--public-source <name>]... [--cursors include] [--custody-profile managed-custody@3]
//   restore --from <folder> [--exporter-key <key>] [--index-exporter-key <key>] [--report <file>] [--require-custody-profile managed-custody@3]
//   epcis-remap --source <name>
//
// Each opens the platform from the configuration, as the API does, and calls
// the functions beside this file. None of them writes a state, signs for
// anyone but this application as the exporter of a package, or touches
// custody.
import { lookup } from 'node:dns/promises'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { remapEpcisSourceEndpoint } from '@bsv/dpp-credentials/epcis-exchange'
import { MANAGED_CUSTODY_EXPORT_PROFILE } from '@bsv/dpp-protocol'
import { loadConfig } from '../config.js'
import { openExchangeStorage } from '../epcis/exchange.js'
import { openPlatform } from '../platform.js'
import { exportApplication } from './export.js'
import { PortabilityRefused, readPackageFolder, writePackageFolder } from './package.js'
import { restoreApplication, verifyApplicationPackage, type RestoreReport } from './restore.js'

export interface CommandContext {
  env: NodeJS.ProcessEnv
  /** One line of the command's answer. */
  out: (line: string) => void
  /** The folder a relative path is read from: where the command was called. */
  cwd: string
}

export const PORTABILITY_USAGE =
  'export --out <folder> [--public] [--passport <id>]... [--public-source <name>]... [--cursors include] [--custody-profile managed-custody@3] | restore --from <folder> [--exporter-key <key>] [--index-exporter-key <key>] [--report <file>] [--require-custody-profile managed-custody@3] | epcis-remap --source <name>'

/** The command's options, or nothing when one was given that the command does not take: the caller then prints how it is used. */
function optionsOf<T>(read: () => T, context: CommandContext): T | undefined {
  try {
    return read()
  } catch (cause) {
    context.out(cause instanceof Error ? cause.message : String(cause))
    return undefined
  }
}

/** A refusal is the command's answer, with its code. Anything else is a failure and is thrown on. */
async function answering(context: CommandContext, run: () => Promise<number>): Promise<number> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof PortabilityRefused) {
      context.out(`Refused (${cause.code}): ${cause.message}`)
      return 1
    }
    throw cause
  }
}

function custodyProfileOption(value: string | undefined, context: CommandContext): typeof MANAGED_CUSTODY_EXPORT_PROFILE | undefined | false {
  if (value === undefined || value === MANAGED_CUSTODY_EXPORT_PROFILE) return value
  context.out(`Refused (not-selected): Unsupported custody export profile ${JSON.stringify(value)}. Nothing was written.`)
  return false
}

/** Write the complete export of this application into an empty folder. */
export async function runExportCommand(args: string[], context: CommandContext): Promise<number> {
  const values = optionsOf(() => parseArgs({ args, options: { out: { type: 'string' }, public: { type: 'boolean', default: false }, passport: { type: 'string', multiple: true }, 'public-source': { type: 'string', multiple: true }, cursors: { type: 'string' }, 'custody-profile': { type: 'string' } } }).values, context)
  if (values?.out == null) {
    context.out('usage: export --out <folder> [--public] [--passport <id>]... [--public-source <name>]... [--cursors include] [--custody-profile managed-custody@3]')
    return 2
  }
  if (values.cursors != null && values.cursors !== 'include' && values.cursors !== 'exclude') {
    context.out('--cursors is include or exclude')
    return 2
  }
  const custodyProfile = custodyProfileOption(values['custody-profile'], context)
  if (custodyProfile === false) return 1
  const folder = resolve(context.cwd, values.out)
  const config = loadConfig(context.env)
  const platform = await openPlatform({ config, mode: 'live', log: () => {} })
  const store = await openExchangeStorage({ setting: config.epcis.storage, ...(platform.db == null ? {} : { db: platform.db }), log: () => {} })
  try {
    return await answering(context, async () => {
      // Without its database this process holds no record of the deployment, and an export of nothing would read as an export of everything.
      if (platform.db == null) throw new PortabilityRefused('source-not-reachable', 'MongoDB is not reachable, so this command has none of the deployment\'s records to export. Nothing was exported.')
      const exported = await exportApplication({
        platform,
        epcis: { storage: store.storage, sources: config.epcis.sources },
        access: values.public ? 'public-evidence' : 'authorised-recovery',
        custodyProfile,
        ...(values.passport == null ? {} : { passportIds: values.passport }),
        ...(values['public-source'] == null ? {} : { publicSources: values['public-source'] }),
        ...(values.cursors == null ? {} : { cursors: values.cursors as 'include' | 'exclude' }),
      })
      writePackageFolder(folder, exported.manifest, exported.files)
      const { descriptor } = exported
      const withoutIndex = descriptor.passports.filter((passport) => passport.index.form === 'none')
      context.out(`${values.public ? 'Public export' : 'Authorised export'} written to ${folder}: ${exported.files.size + 1} files under one signed manifest.`)
      context.out(`Passports: ${descriptor.passports.length}${descriptor.selection === 'all-passports' ? ', every one in the journal' : ', the ones named'}. Profiles carried: ${descriptor.profiles.carried.join(', ') || 'none'}${descriptor.profiles.named.length === 0 ? '' : `; named and not carried: ${descriptor.profiles.named.join(', ')}`}.`)
      context.out(descriptor.epcis.root == null ? `EPCIS exchange: nothing carried (${descriptor.epcis.reason}).` : `EPCIS exchange: the ${descriptor.epcis.access === 'authorised-recovery' ? 'recovery snapshot' : 'public form'} of ${descriptor.epcis.scopes.join(', ')}, cursors ${descriptor.epcis.cursors}.`)
      if (withoutIndex.length > 0) context.out(`The index gave no evidence for ${withoutIndex.length} passport${withoutIndex.length === 1 ? '' : 's'}: ${withoutIndex.map((passport) => `${passport.passportId} (${passport.index.reason})`).join('; ')}. The manifest declares each absent.`)
      context.out(`Exporter identity key, which a restore is given: ${exported.exporter.identityKey}`)
      // The test wallet's keys are fixed and public knowledge, so anyone can make this signature. The package is then held together by its digests and vouched for by nobody.
      if (platform.wallet.kind === 'test') context.out('This deployment has no wallet root key: the export is signed by the test wallet, whose key is public. Its signature says nothing about who assembled the package.')
      context.out(values.public ? 'A public export is not a recovery backup, and a restore refuses it.' : 'This folder holds restricted records. It holds no key and no credential: the wallet\'s keys travel by the wallet\'s own recovery, and each credential is configured again at the destination.')
      return 0
    })
  } finally {
    await store.close()
    await platform.close()
  }
}

/** One line per thing the restore did, then what is the operator's to provide and what needs attention. */
function printReport(report: RestoreReport, out: (line: string) => void): void {
  out(`Restore ${report.outcome}: export ${report.exportId.slice(-16)} of ${report.exportedAt}, exported by ${report.exporter}.`)
  out(`Passports: ${report.passports.written.length} written, ${report.passports.unchanged.length} already held and equal. Brands ${report.records.brands.written}/${report.records.brands.unchanged}, offers ${report.records.offers.written}/${report.records.offers.unchanged}, claims ${report.records.claims.written}/${report.records.claims.unchanged} (written/unchanged).`)
  out(`Profiles: resolved from ${report.profiles.resolver === 'bundle' ? `the bundle in ${report.profiles.folder}` : 'the installed profiles package'}; ${report.profiles.filesWritten} bundle files written, ${report.profiles.filesUnchanged} unchanged; held now: ${report.profiles.registered.map((entry) => entry.profile).join(', ') || 'none of the carried ones'}.`)
  if (report.epcis != null) out(`EPCIS exchange: ${report.epcis.outcome}; ${report.epcis.written.originals} originals, ${report.epcis.written.imports} imports, ${report.epcis.written.observations} observations, ${report.epcis.written.resolutions} decisions, ${report.epcis.written.pulls} pulls and ${report.epcis.written.pullPages} pages written; ${report.epcis.relocations} originals placed${report.epcis.associationsRebuilt == null ? '' : `; ${report.epcis.associationsRebuilt} index entries rebuilt`}.`)
  out(report.index.rebuilt ? `Index: ${report.index.announced} states announced, ${report.index.admitted} admitted and ${report.index.duplicate} already held.` : `Index: not rebuilt. ${report.index.reason}`)
  if (report.index.rebuilt && report.index.proofsApplied + report.index.proofsNotApplied.length > 0) out(`The replacement index applied ${report.index.proofsApplied} retained proofs. ${report.index.proofsNotApplied.length} attempted deliveries still need an acknowledgement.`)
  out(`Readings: ${report.readings.same} of ${report.readings.compared} passports read here as they read where they were exported${report.readings.notCompared.length === 0 ? '' : `; ${report.readings.notCompared.length} not compared`}.`)
  out('Provide separately:')
  for (const line of report.provisionSeparately) out(`  ${line}`)
  if (report.attention.length > 0) {
    out('Needs attention:')
    for (const line of report.attention) out(`  ${line}`)
  }
}

/** Restore an authorised export into this deployment. Everything is verified before anything is written. */
export async function runRestoreCommand(args: string[], context: CommandContext): Promise<number> {
  const values = optionsOf(() => parseArgs({ args, options: { from: { type: 'string' }, 'exporter-key': { type: 'string' }, 'index-exporter-key': { type: 'string' }, report: { type: 'string' }, 'require-custody-profile': { type: 'string' } } }).values, context)
  if (values?.from == null) {
    context.out('usage: restore --from <folder> [--exporter-key <key>] [--index-exporter-key <key>] [--report <file>] [--require-custody-profile managed-custody@3]')
    return 2
  }
  const requiredCustodyProfile = custodyProfileOption(values['require-custody-profile'], context)
  if (requiredCustodyProfile === false) return 1
  for (const name of ['exporter-key', 'index-exporter-key'] as const) {
    if (values[name] != null && !/^0[23][0-9a-f]{64}$/.test(values[name]!)) {
      context.out(`--${name} is a compressed public key: 66 lower-case hexadecimal characters starting 02 or 03`)
      return 2
    }
  }
  const config = loadConfig(context.env)
  return await answering(context, async () => {
    const read = readPackageFolder(resolve(context.cwd, values.from!))
    const platform = await openPlatform({ config, mode: 'live', log: () => {} })
    try {
      // Without the key of the deployment that exported, the package is held to this deployment's own publisher key: the same key, once the wallet was recovered here.
      const exporterKey = values['exporter-key'] ?? platform.wallet.identityKey
      const verified = await verifyApplicationPackage(read, {
        exporterKey,
        requiredCustodyProfile,
        trustedBindingDigests: config.customProfiles.trustedBindingDigests,
        ...(values['index-exporter-key'] ?? config.indexExport.exporterKey) == null ? {} : { indexExporterKey: (values['index-exporter-key'] ?? config.indexExport.exporterKey)! },
      })
      // A restore into memory would be gone when this command ends, and would have said it was done.
      if (platform.db == null) throw new PortabilityRefused('destination-not-durable', 'MongoDB is not reachable, so this deployment would keep the restored records in memory and lose them when this command ends. Nothing was written.')
      const store = await openExchangeStorage({ setting: config.epcis.storage, db: platform.db, log: () => {} })
      try {
        const report = await restoreApplication({
          verified,
          platform,
          epcis: { storage: store.storage, sources: config.epcis.sources, artefactsDir: config.epcis.gs1Dir },
          // The index inside this process is gone when the command ends. Only an index this deployment has joined is given the states.
          rebuildIndex: config.index.joined,
        })
        printReport(report, context.out)
        if (values.report != null) writeFileSync(resolve(context.cwd, values.report), `${JSON.stringify(report, null, 2)}\n`)
        return report.attention.length === 0 ? 0 : 3
      } finally {
        await store.close()
      }
    } finally {
      await platform.close()
    }
  })
}

/**
 * Declare that a configured EPCIS source is now reached at the address the
 * configuration gives it. Every pull of the source is bound to that address,
 * with its identity, its pages and its checkpoint kept. No request is made
 * and no credential is read.
 */
export async function runRemapCommand(args: string[], context: CommandContext): Promise<number> {
  const values = optionsOf(() => parseArgs({ args, options: { source: { type: 'string' } } }).values, context)
  const config = loadConfig(context.env)
  const source = config.epcis.sources.find((candidate) => candidate.sourceId === values?.source)
  if (values?.source == null || source == null) {
    context.out(`usage: epcis-remap --source <name>, where the name is one of EPCIS_SOURCES${config.epcis.sources.length === 0 ? ' (none is configured)' : `: ${config.epcis.sources.map((candidate) => candidate.sourceId).join(', ')}`}`)
    return 2
  }
  const platform = await openPlatform({ config, mode: 'live', log: () => {} })
  const store = await openExchangeStorage({ setting: config.epcis.storage, ...(platform.db == null ? {} : { db: platform.db }), log: () => {} })
  try {
    const outcome = await remapEpcisSourceEndpoint({
      storage: store.storage,
      sourceId: source.sourceId,
      baseUrl: source.baseUrl,
      permittedOrigins: source.permittedOrigins,
      localTest: source.localTest,
      remappedAt: new Date().toISOString(),
      remappedBy: 'operator',
      resolveHost: async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address),
    })
    if (outcome.outcome === 'refused') {
      context.out(`Refused (${outcome.reason}): ${outcome.detail}`)
      return 1
    }
    for (const pull of outcome.pulls) context.out(`${pull.queryId}: ${pull.changed ? `now bound to ${pull.to.baseUrl}, from ${pull.from.baseUrl}` : `already bound to ${pull.to.baseUrl}`}; cursor ${pull.cursor}.`)
    context.out(`The source ${source.sourceId} keeps its identity, its imports and each pull's checkpoint. A pull whose cursor was dropped replays from its retained bounds.`)
    return 0
  } finally {
    await store.close()
    await platform.close()
  }
}
