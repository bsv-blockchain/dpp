import { expect, it } from 'vitest';
import { mapEpcisEvent, extractEpcisEvent, EPCIS_TYPES } from '../src/epcis.js';
import { unsignedSeal, NOW, ISSUER } from './fixtures.js';
for (const type of EPCIS_TYPES) it(`preserves all ${type} source fields through its mapping`, () => {
  const ids = ['urn:epc:id:sgtin:0614141.112345.400'];
  const fields = type === 'TransformationEvent' ? { inputEPCList: ids, outputEPCList: ['urn:epc:id:sgtin:0614141.112345.401'] } : type === 'AssociationEvent' || type === 'AggregationEvent' ? { parentID: 'urn:epc:id:sscc:0614141.1234567890', childEPCs: ids } : { epcList: ids };
  const event = { type, ...fields, eventTime: NOW, eventTimeZoneOffset: '+00:00', recordTime: NOW, action: 'OBSERVE', bizStep: 'urn:epcglobal:cbv:bizstep:shipping', disposition: 'urn:epcglobal:cbv:disp:in_transit', sensorElementList: [{ sensorReport: [{ type: 'Temperature', value: 4.75 }] }], 'urn:example:custom': { nested: ['preserved', 5] } };
  const base = unsignedSeal();
  const seal = mapEpcisEvent(event, { issuer: ISSUER, assertionMethod: `${ISSUER}#ed`, actorRole: 'logistics_provider', jurisdiction: 'AU', issuedAt: NOW, credentialStatus: base.credentialStatus, chainOfCustody: base.chainOfCustody, transformationAction: 'OBSERVE' });
  expect(extractEpcisEvent(seal)).toEqual(event);
});
it('rejects insufficient mappings without inventing an event or location', () => {
  const base = unsignedSeal();
  expect(() => mapEpcisEvent({ type: 'ObjectEvent', epcList: [] }, { issuer: ISSUER, assertionMethod: `${ISSUER}#ed`, actorRole: 'manufacturer', jurisdiction: 'AU', issuedAt: NOW, credentialStatus: base.credentialStatus, chainOfCustody: base.chainOfCustody })).toThrow('Insufficient product');
});
