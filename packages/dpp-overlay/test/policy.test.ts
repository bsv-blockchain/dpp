import { afterEach, describe, expect, it } from 'vitest'
import { exportIdentityKey, refuseRemovedCustodySettings, versionTwoAdmission } from '../src/index.js'

/** The custody settings read from the environment, as the README's configuration table states them. */
describe('the custody settings from the environment', () => {
  afterEach(() => {
    delete process.env.ACCEPTANCE_COMMITMENT
    delete process.env.CONTROL_AUTHORITIES
  })

  it('name no control authorities and select no profile when unset', () => {
    expect(versionTwoAdmission()).toEqual({ managedAcceptance: false })
  })

  it('select the managed-custody profile with "required" and name control authorities comma-separated', () => {
    process.env.ACCEPTANCE_COMMITMENT = 'required'
    process.env.CONTROL_AUTHORITIES = ' 02aa, 03bb ,'
    expect(versionTwoAdmission()).toEqual({ managedAcceptance: true, controlAuthorities: ['02aa', '03bb'] })
  })

  it('refuse any other value of ACCEPTANCE_COMMITMENT rather than guessing', () => {
    process.env.ACCEPTANCE_COMMITMENT = 'yes'
    expect(() => versionTwoAdmission()).toThrow('ACCEPTANCE_COMMITMENT')
  })
})

/** OWNER_CONSENT, TRANSFER_AUTHORITIES and INSTRUCTION_COMMITMENT selected rules this release does not run. */
describe('the removed custody settings', () => {
  it('pass when none is set, or each is empty', () => {
    expect(() => refuseRemovedCustodySettings({})).not.toThrow()
    expect(() => refuseRemovedCustodySettings({ OWNER_CONSENT: '', TRANSFER_AUTHORITIES: ' ', INSTRUCTION_COMMITMENT: '' })).not.toThrow()
  })

  it('fail the boot when one is set, saying why', () => {
    expect(() => refuseRemovedCustodySettings({ OWNER_CONSENT: 'required' })).toThrow(/OWNER_CONSENT is no longer read.*CONTROL_AUTHORITIES/)
    expect(() => refuseRemovedCustodySettings({ TRANSFER_AUTHORITIES: '02aa' })).toThrow(/TRANSFER_AUTHORITIES is no longer read.*were also the index's control authorities, so move them to CONTROL_AUTHORITIES/)
    expect(() => refuseRemovedCustodySettings({ INSTRUCTION_COMMITMENT: 'required' })).toThrow('INSTRUCTION_COMMITMENT is no longer read: the instruction rule of the managed-custody profile is parked')
  })
})

/** Evidence packages are signed by the exporter identity key's child per passport (spec/portable-evidence.md section 2), never by a raw export key. */
describe('the export signing settings', () => {
  it('read EXPORTER_PRIVATE_KEY as the exporter identity, and nothing when it is unset', () => {
    expect(exportIdentityKey({ EXPORTER_PRIVATE_KEY: '77'.repeat(32) })).toBe('77'.repeat(32))
    expect(exportIdentityKey({})).toBeUndefined()
    expect(() => exportIdentityKey({ EXPORTER_PRIVATE_KEY: 'not hex' })).toThrow('EXPORTER_PRIVATE_KEY is not a private key in hex')
  })

  it('never take the exporter identity from OPERATOR_SIGNING_KEY, so registration does not switch exports on', () => {
    expect(exportIdentityKey({ OPERATOR_SIGNING_KEY: '77'.repeat(32) })).toBeUndefined()
  })

  it('fail the boot when the raw EXPORT_SIGNING_KEY of an earlier release is set, saying what replaces it', () => {
    expect(() => exportIdentityKey({ EXPORT_SIGNING_KEY: '77'.repeat(32) })).toThrow(/EXPORT_SIGNING_KEY is no longer read.*EXPORTER_PRIVATE_KEY/)
    expect(() => exportIdentityKey({ EXPORT_SIGNING_KEY: '77'.repeat(32), EXPORTER_PRIVATE_KEY: '77'.repeat(32) })).toThrow('EXPORT_SIGNING_KEY is no longer read')
  })
})
