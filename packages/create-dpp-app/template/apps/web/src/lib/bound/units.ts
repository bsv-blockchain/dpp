// The UN/CEFACT unit codes the sector forms offer, with a name for each. A
// measurement is written with the code; the name is for the page. A form
// lists the codes that suit each measurement and never chooses one itself.

export const UNITS: Record<string, string> = {
  KGM: 'kilogram',
  GRM: 'gram',
  MGM: 'milligram',
  TNE: 'tonne',
  LTR: 'litre',
  MTQ: 'cubic metre',
  MTR: 'metre',
  CMT: 'centimetre',
  MMT: 'millimetre',
  AMH: 'ampere hour',
  AMP: 'ampere',
  VLT: 'volt',
  OHM: 'ohm',
  WTT: 'watt',
  KWT: 'kilowatt',
  WHR: 'watt hour',
  KWH: 'kilowatt hour',
  CEL: 'degree Celsius',
  NEW: 'newton',
  P1: 'per cent',
  C62: 'one (a count or a grade)',
  ANN: 'year',
  MON: 'month',
  DAY: 'day',
  HUR: 'hour',
  MIN: 'minute',
}

/** Every unit, for a measurement whose unit depends on what was measured. */
export const ANY_UNIT: string[] = Object.keys(UNITS)

export const unitName = (code: string): string => UNITS[code] ?? code
