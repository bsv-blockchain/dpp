// Short ways to write a form's fields, and the groups both sector forms
// share: an address, a contact, a measurement, a certificate.
import type { CodeSource, Field, FixedField, GroupField, ListField, ScalarField } from './form-model'
import { ANY_UNIT } from './units'

interface Extra {
  help?: string
  required?: boolean
}

type Simple = 'text' | 'longText' | 'date' | 'dateTime' | 'integer' | 'boolean'
const simple =
  (kind: Simple) =>
  (key: string, label: string, extra: Extra = {}): ScalarField => ({ kind, key, label, ...extra })

export const text = simple('text')
export const longText = simple('longText')
export const url = (key: string, label: string, extra: Extra = {}): ScalarField => ({ kind: 'url', key, label, ...extra })
/** A web address written as a link to the thing at that address. */
export const link = (key: string, label: string, extra: Extra = {}): ScalarField => ({ kind: 'url', key, label, as: 'reference', ...extra })
export const date = simple('date')
export const dateTime = simple('dateTime')
export const integer = simple('integer')
export const yesNo = simple('boolean')
export const decimal = (key: string, label: string, extra: Extra & { typed?: boolean } = {}): ScalarField => ({ kind: 'decimal', key, label, ...extra })
export const langText = (key: string, label: string, extra: Extra = {}): ScalarField => ({ kind: 'langText', key, label, ...extra })
export const quantity = (key: string, label: string, units: string[], extra: Extra = {}): ScalarField => ({ kind: 'quantity', key, label, units, ...extra })
/** A coded value from a class of the profile's vocabulary, or from the list given. */
export const code = (key: string, label: string, codes: string | CodeSource, extra: Extra & { as?: 'text' } = {}): ScalarField => ({ kind: 'code', key, label, codes: typeof codes === 'string' ? { class: codes } : codes, ...extra })
export const country = (key: string, label: string, extra: Extra & { as?: 'text' } = {}): ScalarField => ({ kind: 'country', key, label, ...extra })
export const fixed = (key: string, value: unknown): FixedField => ({ kind: 'fixed', key, value })
export const reference = (id: string): { '@id': string } => ({ '@id': id })
export const group = (key: string, label: string, type: string | undefined, fields: Array<Field | FixedField>, extra: Extra = {}): GroupField => ({ kind: 'group', key, label, ...(type == null ? {} : { type }), fields, ...extra })
export const list = (key: string, label: string, itemLabel: string, item: ScalarField | GroupField, extra: Extra = {}): ListField => ({ kind: 'list', key, label, itemLabel, item, ...extra })
/** One entry of a list: a group with no property of its own, since the list names it. */
export const entry = (type: string | undefined, fields: Array<Field | FixedField>): GroupField => group('', '', type, fields)

const GLN_HELP = 'A Global Location Number: 13 digits.'

export const address = (): GroupField =>
  group('gs1:address', 'Address', 'gs1:PostalAddress', [text('gs1:streetAddress', 'Street'), text('gs1:addressLocality', 'Town or city'), text('gs1:postalCode', 'Postcode'), country('gs1:addressCountry', 'Country')])

export const contact = (key = 'gs1:contactPoint', label = 'Contact'): GroupField => group(key, label, 'gs1:ContactPoint', [text('gs1:email', 'Email'), text('gs1:telephone', 'Telephone'), link('schema:url', 'Web page')])

/** An organisation: its name as people read it, kept apart from the number that identifies it. */
export const organisation = (key: string, label: string, extra: Extra = {}): GroupField =>
  group(
    key,
    label,
    'gs1:Organization',
    [
      url('id', 'Identifier of the organisation', { help: 'Optional. A web address that identifies the organisation, if it has one. Leave it empty otherwise.' }),
      text('gs1:organizationName', 'Name'),
      text('gs1:globalLocationNumber', 'Location number (GLN)', { help: GLN_HELP }),
      address(),
      contact(),
    ],
    extra
  )

/** The economic operator behind the product. `roleKey` is the property the profile writes the role under. */
export const operator = (key: string, roleKey: string, extra: Extra = {}): GroupField =>
  group(
    key,
    'Economic operator',
    'oec:OperatorInformation',
    [
      url('id', 'Identifier of the operator', { help: 'Optional. A web address that identifies the operator, if it has one.' }),
      text('gs1:globalLocationNumber', 'Location number (GLN)', { help: GLN_HELP, required: true }),
      text('gs1:organizationName', 'Name'),
      code(roleKey, 'Role', 'oec:OperatorRole', { required: true, help: 'The role the operator has for this product.' }),
      text('oec:eoriNumber', 'EORI number'),
      text('schema:vatID', 'VAT number'),
      address(),
      contact(),
    ],
    extra
  )

/** A site: its location number and name, with the certificates it holds. */
export const facility = (key: string, label: string): GroupField =>
  group(key, label, 'oec:FacilityInformation', [
    url('id', 'Identifier of the site', { help: 'Optional. A web address that identifies the site, if it has one.' }),
    text('gs1:globalLocationNumber', 'Location number (GLN)', { help: GLN_HELP, required: true }),
    text('schema:name', 'Name', { required: true }),
    text('oec:facilityType', 'Kind of site'),
    address(),
    list('oec:hasFacilityCertifications', 'Certificates of the site', 'certificate', entry('gs1:CertificationDetails', [text('gs1:certificationStandard', 'Standard'), text('gs1:certificationIdentification', 'Certificate number')])),
  ])

/** One measured value: what was measured, how much, in which unit. `prefix` keeps the choices to the sector's own parameters. */
export const measurement = (key: string, label: string, prefix: string): GroupField =>
  group(key, label, 'oea:MeasurementResult', [
    code('oea:hasObservedParameter', 'What was measured', { class: 'oea:PerformanceParameter', prefix }, { required: true }),
    quantity('oea:hasMeasuredValue', 'Measured value', ANY_UNIT, { required: true, help: 'Use the unit "one" for a count or a grade on a scale.' }),
  ])

export const certificate = (): GroupField =>
  entry('gs1:CertificationDetails', [
    text('gs1:certificationAgency', 'Issued by'),
    text('gs1:certificationStandard', 'Standard'),
    text('gs1:certificationIdentification', 'Certificate number'),
    text('gs1:certificationValue', 'Certificate value'),
    url('gs1:certificationURI', 'Web address'),
    date('gs1:certificationStartDate', 'Valid from'),
    date('gs1:certificationEndDate', 'Valid to'),
  ])

export const warranty = (): GroupField =>
  group('gs1:manufacturersWarranty', 'Warranty', 'gs1:WarrantyPromise', [quantity('gs1:durationOfWarranty', 'Length', ['ANN', 'MON', 'DAY']), text('gs1:warrantyScopeDescription', 'What it covers')])

/** A file about the product: its address is its identifier. */
export const referencedFiles = (): ListField =>
  list(
    'gs1:referencedFile',
    'Files',
    'file',
    entry('gs1:ReferencedFileDetails', [
      url('id', 'Web address of the file', { required: true }),
      code('gs1:referencedFileType', 'Kind of file', { options: ['PRODUCT_IMAGE', 'DOCUMENT', 'CERTIFICATION', 'IFU', 'SAFETY_DATA_SHEET', 'WARRANTY_INFORMATION', 'VIDEO', 'WEBSITE'].map((value) => ({ value: `gs1:ReferencedFileTypeCode-${value}`, label: value[0] + value.slice(1).toLowerCase().replace(/_/g, ' ') })) }),
      text('schema:encodingFormat', 'File type'),
      text('schema:description', 'Description'),
      text('gs1:fileLanguageCode', 'Language code'),
    ])
  )

/** The passport statuses the profiles' rules accept. */
export const PASSPORT_STATUSES: CodeSource = { options: ['active', 'inactive', 'archived', 'invalid', 'draft', 'withdrawn', 'suspended'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) }
