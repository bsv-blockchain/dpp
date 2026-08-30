import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownerConsentPolicy } from '../src/index.js'

/** OWNER_CONSENT and TRANSFER_AUTHORITIES, as the README's configuration table states them. */
describe('the owner-consent policy from the environment', () => {
  afterEach(() => {
    delete process.env.OWNER_CONSENT
    delete process.env.TRANSFER_AUTHORITIES
    vi.restoreAllMocks()
  })

  it('is off when unset, quietly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(ownerConsentPolicy()).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('is on with "required", with no authorities unless named', () => {
    process.env.OWNER_CONSENT = 'required'
    expect(ownerConsentPolicy()).toBe(true)
    process.env.TRANSFER_AUTHORITIES = ' 02aa, 03bb ,'
    expect(ownerConsentPolicy()).toEqual({ authorities: ['02aa', '03bb'] })
  })

  it('refuses any other value rather than guessing', () => {
    process.env.OWNER_CONSENT = 'yes'
    expect(() => ownerConsentPolicy()).toThrow('OWNER_CONSENT')
  })

  it('warns when authorities are named with no policy for them to be exempt from', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.TRANSFER_AUTHORITIES = '02aa'
    expect(ownerConsentPolicy()).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })
})
