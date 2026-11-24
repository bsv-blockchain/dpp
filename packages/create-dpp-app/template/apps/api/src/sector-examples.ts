// Example product documents for the battery and textile sector bindings.
// Both versions use the same product vocabulary. They were written for this
// starter: every organisation, product and number in them is invented, and
// every identifier is under GS1's demonstration prefix 952, which is
// licensed to nobody. They exist so a form can start from a document that
// already has the profile's nested shape. Replace every value with the
// product's own data before writing a real passport.
//
// An example is completed for this deployment when it is served: the
// product's identifier, GTIN and serial are minted under the configured
// host and prefix, and the contexts are named by the addresses the
// registered binding lists.
import type { BindingProfile } from '@bsv/dpp-profiles'
import { mintGtin, mintPassportId, type IdentifierPolicy } from './identifiers.js'

type Json = Record<string, unknown>

interface SectorExample {
  title: string
  /** Digits for the item reference; cut to the length the configured prefix leaves. */
  itemDigits: string
  serial: string
  /** The contexts the document names, by the file name the binding gives each. */
  contexts: string[]
  type: string[]
  /** The members that state the serial, as the profile's documents write them. */
  serialMembers: string[]
  body: Json
}

const text = (value: string, language = 'en'): Json => ({ '@value': value, '@language': language })
const code = (id: string): Json => ({ '@id': id })
const quantity = (value: string, unitCode: string): Json => ({ type: 'gs1:QuantitativeValue', 'gs1:value': value, 'gs1:unitCode': unitCode })
const country = (countryCode: string): Json => ({ type: 'gs1:Country', 'gs1:countryCode': countryCode })
const address = (parts: { street?: string; locality: string; postalCode?: string; country: string }): Json => ({
  type: 'gs1:PostalAddress',
  ...(parts.street == null ? {} : { 'gs1:streetAddress': parts.street }),
  'gs1:addressLocality': parts.locality,
  ...(parts.postalCode == null ? {} : { 'gs1:postalCode': parts.postalCode }),
  'gs1:addressCountry': country(parts.country),
})
const measurement = (parameter: string, value: string, unitCode: string): Json => ({ type: 'oea:MeasurementResult', 'oea:hasObservedParameter': code(parameter), 'oea:hasMeasuredValue': quantity(value, unitCode) })

const BATTERY: SectorExample = {
  title: 'Stationary storage module (invented data)',
  itemDigits: '100200300400',
  serial: 'HC48-2026-000117',
  contexts: ['dpp-core-context.jsonld', 'battery-context.jsonld'],
  type: ['gs1:Product', 'eubat:Battery'],
  serialMembers: ['gs1:hasSerialNumber'],
  body: {
    'eubat:batteryModelIdentifier': 'HC-LFP-48-100',
    'gs1:productName': [text('Harbour 48 V storage module')],
    'schema:model': text('Harbour 48-100'),
    'gs1:productDescription': [text('Lithium iron phosphate module for stationary storage. Example data: nothing here describes a real product.')],
    'schema:schemaVersion': '1.3',
    'oec:passportStatus': 'active',
    'oec:hasReportingGranularity': code('oec:ItemLevel'),
    'oec:lastUpdated': '2026-11-02T09:30:00Z',
    'schema:category': code('eubat:StationaryBattery'),
    'schema:status': code('eubat:Original'),
    'eubat:puttingIntoService': '2026-10-12',
    'gs1:productionDate': '2026-09-18',
    'gs1:countryOfOrigin': country('AU'),
    'eubat:hasCellType': code('eubat:PrismaticCell'),
    'eubat:numberOfCells': 16,
    'eubat:numberOfModules': 1,
    'gs1:netWeight': quantity('41.5', 'KGM'),
    'gs1:grossWeight': quantity('44.0', 'KGM'),
    'gs1:manufacturer': {
      type: 'gs1:Organization',
      'gs1:organizationName': 'Harbour Cells Pty Ltd',
      'gs1:globalLocationNumber': '9520000000011',
      'gs1:address': address({ street: '1 Example Wharf Road', locality: 'Newcastle', postalCode: '2300', country: 'AU' }),
      'gs1:contactPoint': { type: 'gs1:ContactPoint', 'gs1:email': 'info@harbour-cells.example' },
    },
    'eubat:manufacturerIdentifier': '9520000000011',
    'eubat:operatorIdentifier': '9520000000028',
    'eubat:facilityIdentifier': '9520000000035',
    'eubat:hasOperatorInformation': {
      type: 'oec:OperatorInformation',
      'gs1:globalLocationNumber': '9520000000028',
      'gs1:organizationName': 'Harbour Energy Imports B.V.',
      'eubat:hasOperatorRole': code('oec:Importer'),
      'gs1:address': address({ street: 'Voorbeeldkade 12', locality: 'Rotterdam', postalCode: '3011 AA', country: 'NL' }),
      'gs1:contactPoint': { type: 'gs1:ContactPoint', 'gs1:email': 'compliance@harbour-energy.example', 'gs1:telephone': '+31-10-555-0100' },
    },
    'eubat:hasManufacturingPlace': { type: 'gs1:Place', 'gs1:globalLocationNumber': '9520000000035', 'gs1:address': address({ locality: 'Newcastle', country: 'AU' }) },
    'eubat:hasBatteryChemistry': {
      type: 'eubat:BatteryChemistry',
      'schema:name': text('Lithium iron phosphate'),
      'schema:alternateName': 'LFP',
      'eubat:cathodeActiveMaterial': 'LiFePO4',
      'eubat:anodeActiveMaterial': 'Graphite',
      'eubat:electrolyteType': text('Liquid, organic carbonate based'),
    },
    'eubat:hasTechnicalSpecifications': {
      type: 'eubat:TechnicalSpecification',
      'eubat:hasRatedCapacity': quantity('100', 'AMH'),
      'eubat:hasRatedEnergy': quantity('5.12', 'KWH'),
      'eubat:hasNominalVoltage': quantity('51.2', 'VLT'),
      'eubat:hasMinimumVoltage': quantity('44.8', 'VLT'),
      'eubat:hasMaximumVoltage': quantity('58.4', 'VLT'),
      'eubat:hasRatedMaximumPower': quantity('5.0', 'KWT'),
      'eubat:hasMaximumChargingCurrent': quantity('100', 'AMP'),
      'eubat:hasMaximumDischargingCurrent': quantity('100', 'AMP'),
      'eubat:hasExpectedLifetime': quantity('15', 'ANN'),
      'eubat:cRate': '0.5',
      'eubat:hasTemperatureRangeCharging': { type: 'eubat:TemperatureRange', 'eubat:hasMinimumTemperature': quantity('0', 'CEL'), 'eubat:hasMaximumTemperature': quantity('45', 'CEL') },
      'eubat:hasTemperatureRangeDischarging': { type: 'eubat:TemperatureRange', 'eubat:hasMinimumTemperature': quantity('-20', 'CEL'), 'eubat:hasMaximumTemperature': quantity('55', 'CEL') },
    },
    'eubat:hasBatteryState': {
      type: 'eubat:BatteryStateAssessment',
      'oea:hasResult': [measurement('eubat:StateOfHealth', '98.50', 'P1'), measurement('eubat:FullCycleCount', '42', 'C62'), measurement('eubat:RemainingCapacity', '98.5', 'AMH')],
    },
    'eubat:hasMaterialComposition': [
      {
        type: 'eubat:BatteryMaterial',
        'schema:name': text('Lithium'),
        'oec:casNumber': '7439-93-2',
        'oec:ecNumber': '231-102-5',
        'eubat:hasComponentLocation': code('eubat:Cathode'),
        'schema:category': code('eubat:ActiveMaterial'),
        'schema:weightPercentage': '4.1',
        'eubat:isCriticalRawMaterial': true,
        'eubat:isSubstanceOfConcern': false,
        'oec:hasMaterialOrigin': country('AU'),
      },
      {
        type: 'eubat:BatteryMaterial',
        'schema:name': text('Graphite'),
        'oec:casNumber': '7782-42-5',
        'oec:ecNumber': '231-955-3',
        'eubat:hasComponentLocation': code('eubat:Anode'),
        'schema:category': code('eubat:ActiveMaterial'),
        'schema:weightPercentage': '17.9',
        'eubat:isCriticalRawMaterial': true,
        'eubat:isSubstanceOfConcern': false,
      },
    ],
    'eubat:hasHazardousSubstances': [
      {
        type: 'eubat:HazardousSubstance',
        'schema:name': text('Lithium hexafluorophosphate'),
        'oec:casNumber': '21324-40-3',
        'oec:ecNumber': '244-334-7',
        'eubat:hasHazardClass': code('eubat:AcuteToxicity'),
        'eubat:concentration': '11.8',
        'eubat:hazardImpact': text('Toxic if swallowed. Causes severe skin burns and eye damage.'),
        'eubat:hasSubstanceLocation': code('eubat:Electrolyte'),
      },
    ],
    'eubat:hasRecycledContent': {
      type: 'eubat:RecycledContent',
      'eubat:lithiumRecycledShare': '6',
      'eubat:lithiumPreConsumerShare': '4',
      'eubat:lithiumPostConsumerShare': '2',
      'eubat:cobaltRecycledShare': '0',
      'eubat:nickelRecycledShare': '0',
      'eubat:leadRecycledShare': '0',
    },
    'eubat:hasCarbonFootprintDeclaration': {
      type: 'eubat:CarbonFootprintDeclaration',
      'eubat:hasCarbonFootprintTotal': quantity('61.4', 'KGM'),
      'eubat:hasCarbonFootprintProduction': quantity('22.0', 'KGM'),
      'eubat:carbonFootprintStudyUrl': 'https://harbour-cells.example/docs/carbon-footprint-study.pdf',
      'eubat:functionalUnit': '1 kWh of total energy provided over the service life',
      'eubat:calculationStandard': 'ISO 14067:2018',
      'oea:hasIndicator': { type: 'oea:Indicator', 'oea:hasIndicatorKind': code('eubat:CarbonFootprintPerformanceClass'), 'oea:hasCategoricalValue': code('eubat:CFClassC') },
    },
    'gs1:manufacturersWarranty': { type: 'gs1:WarrantyPromise', 'gs1:durationOfWarranty': quantity('10', 'ANN'), 'gs1:warrantyScopeDescription': 'Covers manufacturing defects.' },
    'eubat:ceMarkingIndicator': true,
    'eubat:hasComplianceStatus': code('eubat:Compliant'),
    'eubat:hasLabels': [
      {
        type: 'eubat:Label',
        'eubat:hasLabelSubject': code('eubat:SeparateCollection'),
        'eubat:labelSymbol': 'https://harbour-cells.example/symbols/separate-collection.svg',
        'eubat:labelMeaning': text('Do not dispose of with household waste. Return to a collection point.'),
      },
    ],
    'eubat:hasEndOfLifeInfo': {
      type: 'eubat:EndOfLifeInfo',
      'eubat:recyclabilityRate': '92',
      'eubat:hasMaterialRecoveryTargets': [{ type: 'eubat:MaterialRecoveryTarget', 'eubat:recoveryMaterial': 'Lithium', 'eubat:recoveryRate': '70' }],
      'eubat:hasDismantlingTime': quantity('40', 'MIN'),
      'eubat:extinguishingAgent': text('Class D extinguisher or dry sand'),
      'eubat:safetyInstructions': 'https://harbour-cells.example/docs/safety-instructions.pdf',
    },
    'eubat:hasSupplyChainDueDiligence': {
      type: 'eubat:SupplyChainDueDiligence',
      'eubat:dueDiligenceReportUrl': 'https://harbour-cells.example/docs/due-diligence-report.pdf',
      'eubat:supplyChainMappingAvailable': true,
      'schema:auditDate': '2026-06-30',
      'eubat:auditBody': 'Example Assurance Ltd',
    },
  },
}

const TEXTILE: SectorExample = {
  title: 'Rain jacket (invented data)',
  itemDigits: '100200400500',
  serial: 'TL-RS-2026-000408',
  contexts: ['dpp-core-context.jsonld', 'textile-context.jsonld'],
  type: ['gs1:Clothing', 'eutex:TextileApparel'],
  serialMembers: ['schema:serialNumber'],
  body: {
    'gs1:productName': [text('Tideline rain shell, slate')],
    'gs1:productDescription': [text('Waterproof shell jacket with a recycled polyester face. Example data: nothing here describes a real product.')],
    'oec:passportStatus': 'active',
    'oec:passportVersion': '1.0',
    'oec:passportIssueDate': '2026-10-20',
    'oec:lastUpdated': '2026-11-02T09:30:00Z',
    'oec:hasProductCategory': code('oec:Textiles'),
    'schema:category': code('eutex:Apparel'),
    'eutex:hasApparelSubcategory': code('eutex:JacketsCoats'),
    'eutex:garmentType': 'Rain jacket',
    'eutex:hasFabricType': code('eutex:WovenNonDenim'),
    'gs1:targetConsumerGender': code('gs1:TargetConsumerGenderCode-UNISEX'),
    'eutex:sizeRange': 'XS-XXL',
    'eutex:seasonCollection': 'AW2026',
    'gs1:countryOfOrigin': country('PT'),
    'gs1:productionDate': '2026-09-05',
    'gs1:netWeight': quantity('0.42', 'KGM'),
    'gs1:manufacturer': {
      type: 'gs1:Organization',
      'gs1:organizationName': 'Tideline Outdoor Lda',
      'gs1:globalLocationNumber': '9520000000042',
      'gs1:address': address({ street: 'Rua do Exemplo 8', locality: 'Porto', postalCode: '4000-001', country: 'PT' }),
      'gs1:contactPoint': { type: 'gs1:ContactPoint', 'gs1:email': 'hello@tideline.example' },
    },
    'oec:hasOperatorInformation': {
      type: 'oec:OperatorInformation',
      'gs1:globalLocationNumber': '9520000000042',
      'gs1:organizationName': 'Tideline Outdoor Lda',
      'oec:hasOperatorRole': code('oec:Manufacturer'),
      'gs1:address': address({ street: 'Rua do Exemplo 8', locality: 'Porto', postalCode: '4000-001', country: 'PT' }),
      'gs1:contactPoint': { type: 'gs1:ContactPoint', 'gs1:email': 'compliance@tideline.example', 'gs1:telephone': '+351-22-555-0100' },
    },
    'gs1:textileMaterial': [
      {
        type: 'gs1:TextileMaterialDetails',
        'gs1:textileMaterialPercentage': { '@value': '88', '@type': 'xsd:decimal' },
        'gs1:textileMaterialDescription': text('Recycled polyester (shell)'),
        'eutex:fiberOrigin': 'TW',
        'eutex:isRecycledFiber': true,
        'eutex:recycledContentSource': 'Post-consumer bottles',
        'eutex:hasFiberCertification': { type: 'gs1:CertificationDetails', 'gs1:certificationAgency': 'Example Certification Body', 'gs1:certificationStandard': 'Global Recycled Standard', 'gs1:certificationValue': 'DEMO-GRS-0001' },
      },
      {
        type: 'gs1:TextileMaterialDetails',
        'gs1:textileMaterialPercentage': { '@value': '12', '@type': 'xsd:decimal' },
        'gs1:textileMaterialDescription': text('Polyamide (lining)'),
        'eutex:fiberOrigin': 'IT',
        'eutex:isRecycledFiber': false,
      },
    ],
    'eutex:hasCareInstructions': {
      type: 'eutex:CareInstruction',
      'eutex:hasWashingSymbol': code('eutex:Wash30'),
      'eutex:hasBleachingSymbol': code('eutex:DoNotBleach'),
      'eutex:hasDryingSymbol': code('eutex:DripDry'),
      'eutex:hasIroningSymbol': code('eutex:DoNotIron'),
      'eutex:hasDryCleaningSymbol': code('eutex:DoNotDryClean'),
      'eutex:additionalCareInstructions': text('Close all zips before washing. Reproof after ten washes.'),
    },
    'eutex:hasDurabilityInfo': {
      type: 'eutex:DurabilityInfo',
      'oea:hasSubAssessment': [
        { type: 'oea:TestExecution', 'oea:hasMethod': code('eutex:MartindaleAbrasionTest'), 'oea:hasResult': measurement('eutex:AbrasionResistance', '30000', 'C62') },
        { type: 'oea:TestExecution', 'oea:hasMethod': code('eutex:PillingTest'), 'oea:hasResult': measurement('eutex:PillingResistance', '4', 'C62') },
        { type: 'oea:TestExecution', 'oea:hasMethod': code('eutex:TearStrengthTest'), 'oea:hasResult': measurement('eutex:TearStrength', '32.5', 'NEW') },
      ],
      'oea:hasIndicator': [{ type: 'oea:Indicator', 'oea:hasIndicatorKind': code('eutex:DurabilityRating'), 'oea:hasCategoricalValue': code('eutex:DurabilityB') }],
    },
    'eutex:hasMicroplasticInfo': {
      type: 'eutex:MicroplasticInfo',
      'eutex:syntheticFiberContent': '100',
      'eutex:microplasticMitigationMeasures': text('Tightly woven face fabric. Wash in a fibre-catching laundry bag.'),
    },
    'oec:hasRecycledContentDetails': { type: 'oec:RecycledContent', 'oec:recycledContent': '0.88', 'oec:postConsumerRecycledContent': '0.88' },
    'eutex:hasRecycledContentDeclaration': [
      {
        type: 'eutex:RecycledContentDeclaration',
        'eutex:secondaryMaterialFraction': '88',
        'eutex:hasWasteOriginType': code('eutex:PostConsumer'),
        'eutex:hasRecycledSourceType': code('eutex:OpenLoop'),
        'eutex:hasChainOfCustodyMethod': code('eutex:Certified'),
        'eutex:meetsTargetThreshold': true,
      },
    ],
    'oec:carbonFootprintTotal': '9.6',
    'oec:declaredUnit': 'kg CO2e per garment',
    'eutex:hasWaterUsage': quantity('1400', 'LTR'),
    'eutex:hasEnergyUsage': quantity('21.5', 'KWH'),
    'eutex:productionWastePercentage': '6.5',
    'eutex:pfasFree': true,
    'eutex:biodegradable': false,
    'eutex:hasSubstancesOfConcern': [
      {
        type: 'eutex:SubstanceOfConcern',
        'eutex:hasSocType': code('eutex:SoCTypeB'),
        'schema:name': 'Formaldehyde',
        'oec:casNumber': '50-00-0',
        'oec:ecNumber': '200-001-8',
        'eutex:substanceConcentration': '0.002',
        'eutex:hasClpHazardCategory': code('eutex:CMR'),
        'oec:substanceLocation': 'Seam tape adhesive',
        'eutex:safeUseInstructions': 'Wash before first wear.',
      },
    ],
    'eutex:takeBackProgramAvailable': true,
    'eutex:hasTakeBackProgram': {
      type: 'eutex:TakeBackProgram',
      'eutex:takeBackUrl': 'https://tideline.example/take-back',
      'eutex:takeBackIncentive': text('A repair voucher for each returned jacket.'),
      'eutex:endOfLifeDestination': text('Resale when sound, fibre recycling when not.'),
    },
    'gs1:consumerRecyclingInstructions': [text('Return the jacket to a Tideline shop. Do not put it in household waste.')],
    'eutex:isRepairable': true,
    'eutex:repairGuideUrl': 'https://tideline.example/repair',
    'eutex:hasRepairServices': [
      {
        type: 'gs1:Organization',
        'gs1:organizationName': 'Tideline Repairs',
        'gs1:address': address({ locality: 'Porto', country: 'PT' }),
        'gs1:contactPoint': { type: 'gs1:ContactPoint', 'gs1:email': 'repairs@tideline.example' },
      },
    ],
    'gs1:certification': [
      {
        type: 'gs1:CertificationDetails',
        'gs1:certificationAgency': 'Example Certification Body',
        'gs1:certificationStandard': 'Global Recycled Standard',
        'gs1:certificationIdentification': 'DEMO-GRS-0001',
        'gs1:certificationStartDate': '2026-01-01',
        'gs1:certificationEndDate': '2026-12-31',
      },
    ],
    'eutex:hasCutAndSewFacility': {
      type: 'oec:FacilityInformation',
      'gs1:globalLocationNumber': '9520000000059',
      'schema:name': 'Porto sewing unit',
      'oec:facilityType': 'Cut and sew',
      'gs1:address': address({ locality: 'Porto', country: 'PT' }),
      'oec:hasFacilityCertifications': [{ type: 'gs1:CertificationDetails', 'gs1:certificationStandard': 'ISO 14001:2015', 'gs1:certificationIdentification': 'DEMO-EMS-0007' }],
    },
    'gs1:manufacturersWarranty': { type: 'gs1:WarrantyPromise', 'gs1:durationOfWarranty': quantity('2', 'ANN'), 'gs1:warrantyScopeDescription': 'Covers manufacturing defects, not wear.' },
  },
}

const EXAMPLES: Record<string, SectorExample[]> = {
  'eu-battery@1': [BATTERY],
  'eu-battery@2': [BATTERY],
  'eu-textile@1': [TEXTILE],
  'eu-textile@2': [TEXTILE],
}

/**
 * The examples for a registered profile, each a complete product document
 * for this deployment, with the item reference and serial its identifier
 * was minted from. A profile with no example answers with an empty list.
 */
export function sectorExamples(profile: BindingProfile, policy: IdentifierPolicy): Array<{ title: string; itemReference: string; serial: string; passportId: string; product: Json }> {
  const contexts = new Map(profile.artefacts.filter((a) => a.artefact.role === 'context').map((a) => [a.artefact.path, a.artefact.uri!]))
  return (EXAMPLES[profile.profile] ?? []).flatMap((example) => {
    const itemReference = example.itemDigits.slice(0, Math.max(0, 12 - policy.prefix.length))
    let passportId: string
    let gtin: string
    try {
      passportId = mintPassportId(policy, itemReference, example.serial)
      gtin = mintGtin(policy.prefix, itemReference)
    } catch {
      // A prefix the example's digits cannot fill has no example; the form still works without one.
      return []
    }
    const named = example.contexts.map((path) => contexts.get(path))
    if (named.some((uri) => uri == null)) return []
    const product: Json = {
      '@context': named,
      id: passportId,
      type: example.type,
      'oec:granularityLevel': 'item',
      'gs1:gtin': gtin,
      ...Object.fromEntries(example.serialMembers.map((member) => [member, example.serial])),
      ...structuredClone(example.body),
    }
    return [{ title: example.title, itemReference, serial: example.serial, passportId, product }]
  })
}
