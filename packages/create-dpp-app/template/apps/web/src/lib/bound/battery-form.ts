// The form for eu-battery@1: battery passport data for one serialised item.
// It follows the profile's own data model. Identifiers the manufacturer
// assigns, such as the model identifier and the location numbers, have
// fields of their own, apart from the names people read. Measurements are a
// value and a unit. Whether a property is public or restricted is not
// decided here: the page reads that from the binding's list.
import { address, certificate, code, contact, country, date, dateTime, decimal, entry, fixed, group, integer, langText, list, longText, measurement, operator, organisation, PASSPORT_STATUSES, quantity, reference, referencedFiles, text, url, warranty, yesNo } from './fields'
import type { GroupField, SectorForm } from './form-model'
import { ANY_UNIT } from './units'

const temperatureRange = (key: string, label: string): GroupField =>
  group(key, label, 'eubat:TemperatureRange', [quantity('eubat:hasMinimumTemperature', 'Lowest', ['CEL']), quantity('eubat:hasMaximumTemperature', 'Highest', ['CEL'])])

const SHARE_HELP = 'A percentage of the metal in the battery.'
const metalShares = (metal: string, label: string) => [
  decimal(`eubat:${metal}RecycledShare`, `${label}, recycled share`, { help: SHARE_HELP }),
  decimal(`eubat:${metal}PreConsumerShare`, `${label}, from manufacturing waste`, { help: SHARE_HELP }),
  decimal(`eubat:${metal}PostConsumerShare`, `${label}, from used products`, { help: SHARE_HELP }),
]

export const BATTERY_FORM: SectorForm = {
  profile: 'eu-battery@1',
  contexts: ['dpp-core-context.jsonld', 'battery-context.jsonld'],
  type: ['gs1:Product', 'eubat:Battery'],
  serialMembers: ['gs1:hasSerialNumber'],
  sections: [
    {
      title: 'The battery',
      description: 'The model identifier is the one the manufacturer assigned. The names beside it are for people to read and can be given in several languages.',
      fields: [
        text('eubat:batteryModelIdentifier', 'Model identifier', { required: true, help: 'Assigned by the manufacturer. Not the product name.' }),
        list('gs1:productName', 'Product name', 'name', langText('', 'Name')),
        langText('schema:model', 'Model name'),
        list('gs1:productDescription', 'Description', 'description', langText('', 'Description')),
        code('schema:category', 'Battery category', 'eubat:BatteryCategory'),
        group('gs1:additionalProductClassification', 'Further classification', 'gs1:AdditionalProductClassificationDetails', [
          text('gs1:additionalProductClassificationCode', 'Code', { help: 'A code from a classification you use, as that classification writes it.' }),
          langText('gs1:additionalProductClassificationCodeDescription', 'What the code means'),
        ]),
        code('schema:status', 'Battery status', 'eubat:BatteryStatus'),
        code('eubat:hasCellType', 'Cell type', 'eubat:CellType'),
        integer('eubat:numberOfCells', 'Number of cells'),
        integer('eubat:numberOfModules', 'Number of modules'),
        quantity('gs1:netWeight', 'Net weight', ['KGM', 'GRM']),
        quantity('gs1:grossWeight', 'Gross weight', ['KGM', 'GRM']),
        date('gs1:productionDate', 'Made on'),
        date('eubat:puttingIntoService', 'Put into service on'),
        country('gs1:countryOfOrigin', 'Country of origin'),
      ],
    },
    {
      title: 'The passport',
      fields: [
        text('schema:schemaVersion', 'Version of the data model', { required: true, help: 'The version of the battery data model this document follows, as its publisher numbers it.' }),
        code('oec:passportStatus', 'Passport status', PASSPORT_STATUSES, { as: 'text', required: true }),
        code('oec:hasReportingGranularity', 'Reported per', 'oec:DPPGranularity', { required: true, help: 'Whether the data is reported per model, per batch or per item.' }),
        dateTime('oec:lastUpdated', 'Last updated', { required: true }),
        url('oec:passportIdentifier', 'Passport identifier of the model', { help: 'Optional. A link for the same product at model level. It must not name another product.' }),
      ],
    },
    {
      title: 'Manufacturer, operator and site',
      description: 'Each party is identified by a location number. A name is a label, and does not identify anything on its own.',
      fields: [
        organisation('gs1:manufacturer', 'Manufacturer'),
        text('eubat:manufacturerIdentifier', 'Manufacturer identifier', { help: 'The identifier of the manufacturer, such as its location number.' }),
        operator('eubat:hasOperatorInformation', 'eubat:hasOperatorRole'),
        text('eubat:operatorIdentifier', 'Operator identifier', { help: 'The identifier of the economic operator, such as its location number.' }),
        group('eubat:hasManufacturingPlace', 'Manufacturing site', 'gs1:Place', [
          url('id', 'Identifier of the site', { help: 'Optional. A web address that identifies the site, if it has one.' }),
          text('gs1:globalLocationNumber', 'Location number (GLN)', { help: 'A Global Location Number: 13 digits.' }),
          address(),
        ]),
        text('eubat:facilityIdentifier', 'Site identifier', { help: 'The identifier of the manufacturing site, such as its location number.' }),
      ],
    },
    {
      title: 'Chemistry and ratings',
      fields: [
        group('eubat:hasBatteryChemistry', 'Chemistry', 'eubat:BatteryChemistry', [
          langText('schema:name', 'Name'),
          text('schema:alternateName', 'Short name'),
          text('eubat:cathodeActiveMaterial', 'Cathode material'),
          text('eubat:anodeActiveMaterial', 'Anode material'),
          langText('eubat:electrolyteType', 'Electrolyte'),
        ]),
        group('eubat:hasTechnicalSpecifications', 'Ratings', 'eubat:TechnicalSpecification', [
          quantity('eubat:hasRatedCapacity', 'Rated capacity', ['AMH']),
          quantity('eubat:hasRatedEnergy', 'Rated energy', ['KWH']),
          quantity('eubat:hasNominalVoltage', 'Nominal voltage', ['VLT']),
          quantity('eubat:hasMinimumVoltage', 'Minimum voltage', ['VLT']),
          quantity('eubat:hasMaximumVoltage', 'Maximum voltage', ['VLT']),
          quantity('eubat:hasRatedMaximumPower', 'Rated maximum power', ['KWT']),
          quantity('eubat:hasMaximumChargingPower', 'Maximum charging power', ['KWT', 'WTT']),
          quantity('eubat:hasMaximumDischargingPower', 'Maximum discharging power', ['KWT', 'WTT']),
          quantity('eubat:hasMaximumChargingCurrent', 'Maximum charging current', ['AMP']),
          quantity('eubat:hasMaximumDischargingCurrent', 'Maximum discharging current', ['AMP']),
          quantity('eubat:hasExpectedLifetime', 'Expected lifetime', ['ANN', 'MON']),
          decimal('eubat:powerCapabilityRatio', 'Power to energy ratio'),
          decimal('eubat:cRate', 'C-rate'),
          temperatureRange('eubat:hasTemperatureRangeStorage', 'Temperature range, storage'),
          temperatureRange('eubat:hasTemperatureRangeCharging', 'Temperature range, charging'),
          temperatureRange('eubat:hasTemperatureRangeDischarging', 'Temperature range, discharging'),
          temperatureRange('eubat:hasTemperatureRangeIdleState', 'Temperature range, idle'),
        ]),
        group('eubat:hasBatteryState', 'State of this battery', 'eubat:BatteryStateAssessment', [
          list('oea:hasResult', 'Measured values', 'measured value', measurement('', '', 'eubat:')),
          list(
            'oea:hasSubAssessment',
            'Values measured under a condition',
            'measurement',
            entry('oea:TestExecution', [
              group('oea:hasCondition', 'Condition', 'oea:AssessmentCondition', [code('oea:hasConditionType', 'Kind of condition', 'oea:ConditionType'), quantity('oea:hasConditionValue', 'At', ANY_UNIT)]),
              measurement('oea:hasResult', 'Result', 'eubat:'),
            ]),
            { help: 'For example the power the battery can deliver at a given state of charge.' }
          ),
        ]),
      ],
    },
    {
      title: 'Materials and substances',
      fields: [
        list(
          'eubat:hasMaterialComposition',
          'Materials',
          'material',
          entry('eubat:BatteryMaterial', [
            langText('schema:name', 'Name', { required: true }),
            text('oec:casNumber', 'CAS number'),
            text('oec:ecNumber', 'EC number'),
            code('eubat:hasComponentLocation', 'Where in the battery', 'eubat:ComponentLocation'),
            code('schema:category', 'Kind of material', 'eubat:MaterialCategory'),
            decimal('schema:weightPercentage', 'Share of the weight', { help: 'A percentage.' }),
            yesNo('eubat:isCriticalRawMaterial', 'A critical raw material'),
            yesNo('eubat:isSubstanceOfConcern', 'A substance of concern'),
            decimal('eubat:renewableContentShare', 'Renewable share', { help: 'A percentage.' }),
            country('oec:hasMaterialOrigin', 'Country it comes from'),
          ])
        ),
        list(
          'eubat:hasHazardousSubstances',
          'Hazardous substances',
          'substance',
          entry('eubat:HazardousSubstance', [
            langText('schema:name', 'Name', { required: true }),
            text('oec:casNumber', 'CAS number'),
            text('oec:ecNumber', 'EC number'),
            code('eubat:hasHazardClass', 'Hazard class', 'eubat:HazardClass'),
            decimal('eubat:concentration', 'Concentration', { help: 'A percentage of the weight.' }),
            langText('eubat:hazardImpact', 'What it does'),
            code('eubat:hasSubstanceLocation', 'Where in the battery', 'eubat:ComponentLocation'),
          ])
        ),
        group('eubat:hasRecycledContent', 'Recycled content', 'eubat:RecycledContent', [...metalShares('lithium', 'Lithium'), ...metalShares('cobalt', 'Cobalt'), ...metalShares('nickel', 'Nickel'), ...metalShares('lead', 'Lead')]),
      ],
    },
    {
      title: 'Carbon footprint',
      fields: [
        group('eubat:hasCarbonFootprintDeclaration', 'Carbon footprint declaration', 'eubat:CarbonFootprintDeclaration', [
          quantity('eubat:hasCarbonFootprintTotal', 'Total', ['KGM'], { required: true, help: 'Kilograms of carbon dioxide equivalent for the unit named below.' }),
          quantity('eubat:hasCarbonFootprintRawMaterialExtraction', 'Raw materials', ['KGM']),
          quantity('eubat:hasCarbonFootprintProduction', 'Production', ['KGM']),
          quantity('eubat:hasCarbonFootprintDistribution', 'Distribution', ['KGM']),
          quantity('eubat:hasCarbonFootprintRecycling', 'End of life and recycling', ['KGM']),
          url('eubat:carbonFootprintStudyUrl', 'Study', { required: true, help: 'The web address of the study behind the figures.' }),
          text('eubat:functionalUnit', 'Unit the figures are for'),
          text('eubat:calculationStandard', 'Calculation standard'),
          text('eubat:carbonFootprintDeclarationId', 'Declaration number'),
          text('eubat:carbonFootprintGeographicScope', 'Geographic scope'),
          group('eubat:hasThirdPartyVerification', 'Verification', 'eubat:ThirdPartyVerification', [
            text('eubat:verificationBodyName', 'Verified by'),
            date('eubat:verificationDate', 'Verified on'),
            url('eubat:verificationCertificateUrl', 'Certificate'),
            text('eubat:verificationStandard', 'Standard'),
          ]),
          group('oea:hasIndicator', 'Performance class', 'oea:Indicator', [fixed('oea:hasIndicatorKind', reference('eubat:CarbonFootprintPerformanceClass')), code('oea:hasCategoricalValue', 'Class', 'eubat:CarbonFootprintClass')], {
            required: true,
          }),
        ]),
      ],
    },
    {
      title: 'Conformity and labels',
      fields: [
        yesNo('eubat:ceMarkingIndicator', 'CE marked'),
        code('eubat:hasComplianceStatus', 'Compliance status', 'eubat:ComplianceStatus'),
        group('eubat:hasEuDeclarationOfConformity', 'EU declaration of conformity', 'cccev:Evidence', [
          text('eubat:euDeclarationOfConformityId', 'Declaration number'),
          url('eubat:declarationOfConformity', 'Document'),
          group('eubat:hasNotifiedBody', 'Notified body', 'cv:PublicOrganisation', [text('eubat:notifiedBodyNumber', 'Number'), text('eubat:notifiedBodyName', 'Name')]),
        ]),
        list('gs1:certification', 'Certificates', 'certificate', certificate()),
        url('eubat:resultOfTestReport', 'Test report'),
        text('eubat:testReportNumber', 'Test report number'),
        url('eubat:separateCollectionSymbolUrl', 'Separate collection symbol'),
        yesNo('eubat:cadmiumSymbolRequired', 'Cadmium symbol required'),
        yesNo('eubat:leadSymbolRequired', 'Lead symbol required'),
        list(
          'eubat:hasLabels',
          'Labels',
          'label',
          entry('eubat:Label', [code('eubat:hasLabelSubject', 'What the label is about', 'eubat:LabelSubject'), url('eubat:labelSymbol', 'Symbol'), langText('eubat:labelMeaning', 'What it means')])
        ),
      ],
    },
    {
      title: 'Warranty, transport and service',
      fields: [
        warranty(),
        url('eubat:warrantyConditions', 'Warranty conditions'),
        yesNo('eubat:extendedWarrantyAvailable', 'Extended warranty available'),
        contact('schema:contactPoint', 'Service contact'),
        url('eubat:authorizedServiceCenters', 'Authorised service centres'),
        text('eubat:transportationSafetyClass', 'Transport class', { help: 'The UN number, for example UN3480.' }),
        langText('eubat:shippingName', 'Proper shipping name'),
        langText('eubat:dangerousGoodsPackingInstructions', 'Packing instructions'),
        langText('eubat:repurposingPotential', 'Suitability for a second use'),
        url('eubat:repurposingGuidelines', 'Guidelines for a second use'),
      ],
    },
    {
      title: 'End of life and due diligence',
      fields: [
        group('eubat:hasEndOfLifeInfo', 'End of life', 'eubat:EndOfLifeInfo', [
          decimal('eubat:recyclabilityRate', 'Recyclable share', { help: 'A percentage.' }),
          list('eubat:hasMaterialRecoveryTargets', 'Recovery targets', 'target', entry('eubat:MaterialRecoveryTarget', [text('eubat:recoveryMaterial', 'Material'), decimal('eubat:recoveryRate', 'Share recovered', { help: 'A percentage.' })])),
          group('eubat:hasSafetyMeasures', 'Safety measures', 'oec:DocumentReference', [url('oec:documentUrl', 'Document')]),
          quantity('eubat:hasDismantlingTime', 'Time to dismantle', ['MIN', 'HUR']),
          langText('eubat:extinguishingAgent', 'Extinguishing agent'),
          url('eubat:wastePrevention', 'Waste prevention'),
          url('eubat:separateCollection', 'Separate collection'),
          url('eubat:informationOnCollection', 'Collection points'),
          url('eubat:safetyInstructions', 'Safety instructions'),
          decimal('eubat:renewableContent', 'Renewable content', { help: 'A percentage.' }),
        ]),
        list(
          'eubat:hasDismantlingAndRemovalInformation',
          'Dismantling documents',
          'document',
          entry('eubat:DismantlingDocument', [code('eubat:hasDocumentType', 'Kind of document', 'eubat:DismantlingDocumentType'), url('eubat:documentUrl', 'Document'), text('eubat:mimeType', 'File type'), text('eubat:languageCode', 'Language code')])
        ),
        group('eubat:hasSupplyChainDueDiligence', 'Supply chain due diligence', 'eubat:SupplyChainDueDiligence', [
          url('eubat:dueDiligenceReportUrl', 'Report', { required: true }),
          url('eubat:dueDiligencePolicyUrl', 'Policy'),
          url('eubat:thirdPartyAssurancesUrl', 'Third-party assurance'),
          langText('eubat:riskAssessmentSummary', 'Summary of the risks'),
          yesNo('eubat:supplyChainMappingAvailable', 'Supply chain is mapped'),
          yesNo('eubat:conflictMineralFree', 'Free of conflict minerals'),
          code('eubat:hasResponsibleSourcingStandard', 'Sourcing standard', 'eubat:ResponsibleSourcingStandard'),
          date('schema:auditDate', 'Audited on'),
          text('eubat:auditBody', 'Audited by'),
          decimal('eubat:supplyChainIndex', 'Supply chain index'),
        ]),
        list(
          'eubat:hasSparePartSources',
          'Where spare parts come from',
          'source',
          entry('gs1:Organization', [text('gs1:organizationName', 'Name'), langText('eubat:spareParts', 'Parts'), address(), contact('eubat:hasSupplierContact', 'Contact')])
        ),
        referencedFiles(),
        langText('eubat:criticalRawMaterialsStatement', 'Statement on critical raw materials'),
        longText('eubat:dataProviderCertification', 'Certification of the data provider'),
        text('eubat:dataQualityAssessment', 'Data quality rating'),
      ],
    },
  ],
}
