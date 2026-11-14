// The form for eu-textile@1: textile passport data for one serialised item
// of clothing. Composition is a list of fibres, each with its share as a
// number. Care is one coded symbol for each of the five treatments. A test
// result is what was measured, the value and its unit, and a rating is a
// code from the profile's own scale. None of them is free text standing in
// for a structured value. Whether a property is public or restricted is
// read from the binding's list, not decided here.
import { ANY_UNIT } from './units'
import { address, certificate, code, contact, country, date, dateTime, decimal, entry, facility, fixed, group, langText, list, measurement, operator, organisation, PASSPORT_STATUSES, quantity, reference, referencedFiles, text, url, warranty, yesNo } from './fields'
import type { CodeSource, GroupField, SectorForm } from './form-model'

const careSymbol = (key: string, label: string, only: string) => code(key, label, { class: 'eutex:CareSymbolCode', only })

/** One test: the method, what it measured, and the result. `scored` adds the points a scoring method awards for it. */
const test = (scored: boolean): GroupField =>
  entry('oea:TestExecution', [
    url('id', 'Identifier of the test', { help: 'Optional. A web address that identifies this test, if it has one.' }),
    code('oea:hasMethod', 'Test method', { class: 'oea:TestMethod', prefix: 'eutex:' }),
    measurement('oea:hasResult', 'Result', 'eutex:'),
    ...(scored ? [decimal('oea:awardedScore', 'Points awarded')] : []),
  ])

/** A rating or a figure derived from the tests: its kind, then either a value with a unit or a class from a scale. */
const indicator = (classes: CodeSource): GroupField =>
  entry('oea:Indicator', [code('oea:hasIndicatorKind', 'Kind', 'oea:IndicatorKind', { required: true }), quantity('oea:hasIndicatorValue', 'Value', ANY_UNIT), code('oea:hasCategoricalValue', 'Class', classes), text('oea:indicatorText', 'Text')])

const GENDER: CodeSource = { options: ['FEMALE', 'MALE', 'UNISEX'].map((value) => ({ value: `gs1:TargetConsumerGenderCode-${value}`, label: value[0] + value.slice(1).toLowerCase() })) }

export const TEXTILE_FORM: SectorForm = {
  profile: 'eu-textile@1',
  contexts: ['dpp-core-context.jsonld', 'textile-context.jsonld'],
  type: ['gs1:Clothing', 'eutex:TextileApparel'],
  serialMembers: ['schema:serialNumber'],
  sections: [
    {
      title: 'The garment',
      fields: [
        list('gs1:productName', 'Product name', 'name', langText('', 'Name')),
        list('gs1:productDescription', 'Description', 'description', langText('', 'Description')),
        code('oec:hasProductCategory', 'Product group', 'oec:ProductCategory'),
        code('schema:category', 'Textile category', 'eutex:TextileCategory'),
        code('eutex:hasApparelSubcategory', 'Kind of clothing', 'eutex:ApparelSubcategory'),
        text('eutex:garmentType', 'Garment'),
        code('eutex:hasFabricType', 'Fabric', 'eutex:FabricType'),
        code('gs1:targetConsumerGender', 'Made for', GENDER),
        text('eutex:sizeRange', 'Sizes', { help: 'The range of sizes the model is made in, as the brand writes it.' }),
        text('eutex:seasonCollection', 'Collection'),
        quantity('gs1:netWeight', 'Net weight', ['KGM', 'GRM']),
        date('gs1:productionDate', 'Made on'),
        country('gs1:countryOfOrigin', 'Country of origin'),
      ],
    },
    {
      title: 'The passport',
      fields: [
        code('oec:passportStatus', 'Passport status', PASSPORT_STATUSES, { as: 'text' }),
        text('oec:passportVersion', 'Passport version'),
        date('oec:passportIssueDate', 'Passport issued on'),
        dateTime('oec:lastUpdated', 'Last updated'),
        url('oec:passportIdentifier', 'Passport identifier of the model', { help: 'Optional. A link for the same product at model level. It must not name another product.' }),
      ],
    },
    {
      title: 'Manufacturer, operator and sites',
      description: 'Each party and each site is identified by a location number. A name is a label, and does not identify anything on its own.',
      fields: [
        organisation('gs1:manufacturer', 'Manufacturer'),
        operator('oec:hasOperatorInformation', 'oec:hasOperatorRole'),
        facility('eutex:hasSpinningFacility', 'Spinning'),
        facility('eutex:hasWeavingFacility', 'Weaving or knitting'),
        facility('eutex:hasDyeingFacility', 'Dyeing'),
        facility('eutex:hasCutAndSewFacility', 'Cutting and sewing'),
        facility('eutex:hasFinishingFacility', 'Finishing'),
      ],
    },
    {
      title: 'Composition',
      description: 'One entry for each fibre, with its share of the weight as a number.',
      fields: [
        list(
          'gs1:textileMaterial',
          'Fibres',
          'fibre',
          entry('gs1:TextileMaterialDetails', [
            decimal('gs1:textileMaterialPercentage', 'Share', { typed: true, required: true, help: 'A percentage, from 0 to 100.' }),
            langText('gs1:textileMaterialDescription', 'Fibre', { required: true }),
            country('eutex:fiberOrigin', 'Country the fibre comes from', { as: 'text' }),
            yesNo('eutex:isRecycledFiber', 'Recycled fibre'),
            text('eutex:recycledContentSource', 'What it was recycled from'),
            group('eutex:hasFiberCertification', 'Certificate', 'gs1:CertificationDetails', [text('gs1:certificationAgency', 'Issued by'), text('gs1:certificationStandard', 'Standard'), text('gs1:certificationValue', 'Certificate value')]),
          ])
        ),
        group('oec:hasRecycledContentDetails', 'Recycled content', 'oec:RecycledContent', [
          decimal('oec:recycledContent', 'Recycled share', { help: 'A fraction from 0 to 1.' }),
          decimal('oec:preConsumerRecycledContent', 'From manufacturing waste', { help: 'A fraction from 0 to 1.' }),
          decimal('oec:postConsumerRecycledContent', 'From used products', { help: 'A fraction from 0 to 1.' }),
        ]),
        list(
          'eutex:hasRecycledContentDeclaration',
          'Recycled content declarations',
          'declaration',
          entry('eutex:RecycledContentDeclaration', [
            url('id', 'Identifier of the declaration', { help: 'Optional. A web address that identifies this declaration, if it has one.' }),
            decimal('eutex:secondaryMaterialFraction', 'Share of recycled material', { help: 'A percentage, from 0 to 100.' }),
            code('eutex:hasWasteOriginType', 'Where the waste came from', 'eutex:WasteOriginType'),
            code('eutex:hasRecycledSourceType', 'Recycling route', 'eutex:RecycledSourceType'),
            code('eutex:hasChainOfCustodyMethod', 'Chain of custody', 'eutex:ChainOfCustodyMethod'),
            yesNo('eutex:meetsTargetThreshold', 'Meets the target'),
            group('eutex:hasVerificationCertification', 'Certificate', 'gs1:CertificationDetails', [text('gs1:certificationAgency', 'Issued by'), text('gs1:certificationStandard', 'Standard'), text('gs1:certificationIdentification', 'Certificate number')]),
          ])
        ),
      ],
    },
    {
      title: 'Care',
      description: 'One symbol for each treatment, from the profile\'s care symbols.',
      fields: [
        group('eutex:hasCareInstructions', 'Care instructions', 'eutex:CareInstruction', [
          url('id', 'Identifier of the care instructions', { help: 'Optional. A web address that identifies them, if they have one.' }),
          careSymbol('eutex:hasWashingSymbol', 'Washing', 'Wash'),
          careSymbol('eutex:hasBleachingSymbol', 'Bleaching', 'Bleach'),
          careSymbol('eutex:hasDryingSymbol', 'Drying', '^(TumbleDry|DoNotTumbleDry|LineDry|DryFlat|DripDry)'),
          careSymbol('eutex:hasIroningSymbol', 'Ironing', 'Iron|Steam'),
          careSymbol('eutex:hasDryCleaningSymbol', 'Professional cleaning', 'DryClean|WetClean'),
          langText('eutex:additionalCareInstructions', 'Further instructions'),
        ]),
      ],
    },
    {
      title: 'Durability',
      description: 'Each test is a method, what it measured and the result with its unit. A grade on a scale is a value in the unit "one".',
      fields: [
        group('eutex:hasDurabilityInfo', 'Durability', 'eutex:DurabilityInfo', [
          url('id', 'Identifier of the durability record', { help: 'Optional. A web address that identifies it, if it has one.' }),
          list('oea:hasSubAssessment', 'Tests', 'test', test(false)),
          list('oea:hasIndicator', 'Ratings and figures', 'rating', indicator({ class: 'eutex:DurabilityClass' })),
        ]),
        group('eutex:hasRobustnessAssessment', 'Robustness after washing', 'eutex:RobustnessAssessment', [
          url('id', 'Identifier of the assessment', { help: 'Optional. A web address that identifies it, if it has one.' }),
          fixed('oea:hasMethod', reference('eutex:JRCRobustnessScoring')),
          list('oea:hasSubAssessment', 'Tests', 'test', test(true), { help: 'At most three: spirality, dimensional change and appearance after washing.' }),
        ]),
        group('eutex:hasMicroplasticInfo', 'Microfibre shedding', 'eutex:MicroplasticInfo', [
          url('id', 'Identifier of the record', { help: 'Optional. A web address that identifies it, if it has one.' }),
          code('oea:hasMethod', 'Test method', { class: 'oea:TestMethod', prefix: 'eutex:' }),
          measurement('oea:hasResult', 'Result', 'eutex:'),
          group('oea:hasIndicator', 'Shedding risk', 'oea:Indicator', [fixed('oea:hasIndicatorKind', reference('eutex:SheddingRiskLevel')), code('oea:hasCategoricalValue', 'Level', 'eutex:MicroplasticRiskLevel')]),
          decimal('eutex:syntheticFiberContent', 'Synthetic fibre share', { help: 'A percentage, from 0 to 100.' }),
          langText('eutex:microplasticMitigationMeasures', 'What reduces shedding'),
        ]),
      ],
    },
    {
      title: 'Environment and substances',
      fields: [
        decimal('oec:carbonFootprintTotal', 'Carbon footprint', { help: 'A number, in the unit named in the next field.' }),
        text('oec:declaredUnit', 'Unit of the carbon footprint'),
        url('oec:carbonFootprintStudyUrl', 'Carbon footprint study'),
        quantity('eutex:hasWaterUsage', 'Water used in production', ['LTR']),
        quantity('eutex:hasEnergyUsage', 'Energy used in production', ['KWH']),
        decimal('eutex:productionWastePercentage', 'Production waste', { help: 'A percentage.' }),
        yesNo('eutex:pfasFree', 'Free of PFAS'),
        yesNo('eutex:biodegradable', 'Biodegradable'),
        list(
          'eutex:hasSubstancesOfConcern',
          'Substances of concern',
          'substance',
          entry('eutex:SubstanceOfConcern', [
            url('id', 'Identifier of the entry', { help: 'Optional. A web address that identifies it, if it has one.' }),
            code('eutex:hasSocType', 'Type', 'eutex:SubstanceOfConcernType', { required: true }),
            text('schema:name', 'Name', { required: true }),
            text('schema:iupacName', 'IUPAC name'),
            text('oec:casNumber', 'CAS number'),
            text('oec:ecNumber', 'EC number'),
            decimal('eutex:substanceConcentration', 'Concentration', { help: 'A percentage of the weight.' }),
            decimal('eutex:maxConcentration', 'Highest concentration', { help: 'A percentage of the weight.' }),
            code('eutex:hasClpHazardCategory', 'Hazard category', 'eutex:CLPHazardCategory'),
            text('oec:substanceLocation', 'Where in the garment'),
            text('eutex:safeUseInstructions', 'Safe use'),
            text('eutex:endOfLifeHandling', 'Handling at end of life'),
          ])
        ),
      ],
    },
    {
      title: 'Repair, take-back and recycling',
      fields: [
        yesNo('eutex:isRepairable', 'Can be repaired'),
        url('eutex:repairGuideUrl', 'Repair guide'),
        yesNo('eutex:sparePartsAvailable', 'Spare parts available'),
        url('eutex:sparePartsUrl', 'Spare parts'),
        list('eutex:hasRepairServices', 'Repair services', 'repair service', entry('gs1:Organization', [url('id', 'Identifier of the service', { help: 'Optional. A web address that identifies it, if it has one.' }), text('gs1:organizationName', 'Name', { required: true }), address(), contact()])),
        yesNo('eutex:takeBackProgramAvailable', 'Take-back programme'),
        group('eutex:hasTakeBackProgram', 'Take-back programme details', 'eutex:TakeBackProgram', [
          url('id', 'Identifier of the programme', { help: 'Optional. A web address that identifies it, if it has one.' }),
          url('eutex:takeBackUrl', 'Web address'),
          langText('eutex:takeBackIncentive', 'What the customer gets'),
          langText('eutex:endOfLifeDestination', 'What happens to returned items'),
        ]),
        list('gs1:consumerRecyclingInstructions', 'Recycling instructions', 'instruction', langText('', 'Instruction')),
        group('oec:hasRepairabilityInfo', 'Repairability', 'oec:RepairabilityInfo', [
          quantity('oec:hasSparePartsAvailability', 'Spare parts are available for', ['ANN', 'MON']),
          yesNo('oec:diyRepairPossible', 'Can be repaired at home'),
          url('oec:professionalRepairNetwork', 'Repair network'),
          list('oea:hasIndicator', 'Ratings and figures', 'rating', indicator({ options: [] })),
        ]),
      ],
    },
    {
      title: 'Certificates, documents and warranty',
      fields: [
        list('gs1:certification', 'Certificates', 'certificate', certificate()),
        warranty(),
        list(
          'oec:hasDocuments',
          'Documents',
          'document',
          entry('oec:DocumentReference', [
            url('id', 'Identifier of the document', { help: 'A web address that identifies the document, usually its own address.' }),
            code('oec:hasDocumentType', 'Kind of document', 'oec:DocumentType'),
            url('oec:documentUrl', 'Web address'),
            text('schema:name', 'Title'),
            text('oec:mimeType', 'File type'),
            text('oec:languageCode', 'Language code'),
            date('oec:issueDate', 'Issued on'),
          ])
        ),
        referencedFiles(),
        group('oec:hasAccessRights', 'Access rights statement', 'oec:AccessRights', [code('oec:hasAccessLevel', 'Access level', 'oec:AccessLevel')], {
          help: 'A statement inside the document. It does not decide what this application publishes: that is the Public and Restricted labels.',
        }),
        text('oec:dataQualityAssessment', 'Data quality rating'),
      ],
    },
  ],
}
