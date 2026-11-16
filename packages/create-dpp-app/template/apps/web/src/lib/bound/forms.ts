// The sector forms this application has, by the profile each writes. A
// profile held by a binding that has no form here is written as a JSON
// document instead.
import { BATTERY_FORM } from './battery-form'
import type { SectorForm } from './form-model'
import { TEXTILE_FORM } from './textile-form'

const FORMS: SectorForm[] = [BATTERY_FORM, TEXTILE_FORM]

export const sectorFormFor = (profile: string): SectorForm | undefined => FORMS.find((form) => form.profile === profile)
