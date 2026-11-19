// @ts-check
// Service area (CUX-08). MYO serves homes within 15 miles of its Springfield, MA base (myoConfig.business), and
// considers homes farther out by special arrangement. Eligibility is judged from the ZIP code's centre, which is not
// the client's door, so ZIPs near the edge are flagged for Myomi to confirm rather than accepted or refused outright.
//
// Data: straight-line distance from the centre of ZIP 01108 (42.0853, -72.5584) to every Massachusetts and Connecticut
// ZIP centre within 20 miles, generated on 2026-11-19 from the `zipcodes` npm package v8.0.0 (BSD licence; US data
// from federalgovernmentzipcodes.us) with the haversine formula. Regenerate the table if the base or radius changes.
import { myoConfig } from '../assets/myo-config.js';
import { requireThat } from './validate.mjs';

/** [zip, miles from the base, place, state] */
const zips = /** @type {[string, number, string, string][]} */ ([
  ['01001',3.5,'Agawam','MA'],
  ['01007',15.1,'Belchertown','MA'],
  ['01009',13.9,'Bondsville','MA'],
  ['01010',19.1,'Brimfield','MA'],
  ['01013',5.1,'Chicopee','MA'],
  ['01014',6.4,'Chicopee','MA'],
  ['01020',6.4,'Chicopee','MA'],
  ['01021',6.4,'Chicopee','MA'],
  ['01022',7.5,'Chicopee','MA'],
  ['01027',13.8,'Easthampton','MA'],
  ['01028',3.0,'East Longmeadow','MA'],
  ['01030',6.1,'Feeding Hills','MA'],
  ['01033',11.9,'Granby','MA'],
  ['01035',19.0,'Hadley','MA'],
  ['01036',6.6,'Hampden','MA'],
  ['01040',8.8,'Holyoke','MA'],
  ['01041',8.7,'Holyoke','MA'],
  ['01056',7.5,'Ludlow','MA'],
  ['01057',12.3,'Monson','MA'],
  ['01060',16.8,'Northampton','MA'],
  ['01062',17.7,'Florence','MA'],
  ['01063',16.6,'Northampton','MA'],
  ['01069',13.3,'Palmer','MA'],
  ['01071',15.1,'Russell','MA'],
  ['01073',12.7,'Southampton','MA'],
  ['01075',10.6,'South Hadley','MA'],
  ['01077',11.1,'Southwick','MA'],
  ['01079',13.9,'Thorndike','MA'],
  ['01080',12.1,'Three Rivers','MA'],
  ['01081',18.2,'Wales','MA'],
  ['01082',19.6,'Ware','MA'],
  ['01085',10.2,'Westfield','MA'],
  ['01086',16.0,'Westfield','MA'],
  ['01089',4.7,'West Springfield','MA'],
  ['01090',6.4,'West Springfield','MA'],
  ['01092',18.7,'West Warren','MA'],
  ['01095',6.3,'Wilbraham','MA'],
  ['01097',14.9,'Woronoco','MA'],
  ['01101',2.0,'Springfield','MA'],
  ['01102',6.4,'Springfield','MA'],
  ['01103',2.0,'Springfield','MA'],
  ['01104',3.2,'Springfield','MA'],
  ['01105',1.4,'Springfield','MA'],
  ['01106',2.4,'Longmeadow','MA'],
  ['01107',3.3,'Springfield','MA'],
  ['01108',0.0,'Springfield','MA'],
  ['01109',2.0,'Springfield','MA'],
  ['01111',6.4,'Springfield','MA'],
  ['01115',2.1,'Springfield','MA'],
  ['01116',6.4,'Longmeadow','MA'],
  ['01118',1.7,'Springfield','MA'],
  ['01119',3.6,'Springfield','MA'],
  ['01128',3.6,'Springfield','MA'],
  ['01129',4.4,'Springfield','MA'],
  ['01133',1.9,'Springfield','MA'],
  ['01138',6.4,'Springfield','MA'],
  ['01139',6.4,'Springfield','MA'],
  ['01144',2.0,'Springfield','MA'],
  ['01151',5.4,'Indian Orchard','MA'],
  ['01152',6.4,'Springfield','MA'],
  ['01195',1.5,'Springfield Bmc','MA'],
  ['01199',3.4,'Springfield','MA'],
  ['06002',19.5,'Bloomfield','CT'],
  ['06006',16.7,'Windsor','CT'],
  ['06016',12.5,'Broad Brook','CT'],
  ['06026',14.3,'East Granby','CT'],
  ['06027',19.6,'East Hartland','CT'],
  ['06028',15.8,'East Windsor Hill','CT'],
  ['06029',13.0,'Ellington','CT'],
  ['06035',15.1,'Granby','CT'],
  ['06060',15.1,'North Granby','CT'],
  ['06064',13.9,'Poquonock','CT'],
  ['06066',16.9,'Vernon Rockville','CT'],
  ['06070',19.1,'Simsbury','CT'],
  ['06071',7.9,'Somers','CT'],
  ['06072',8.3,'Somersville','CT'],
  ['06074',17.4,'South Windsor','CT'],
  ['06075',15.5,'Stafford','CT'],
  ['06076',16.1,'Stafford Springs','CT'],
  ['06077',16.7,'Staffordville','CT'],
  ['06078',7.9,'Suffield','CT'],
  ['06080',8.6,'Suffield','CT'],
  ['06081',16.3,'Tariffville','CT'],
  ['06082',6.7,'Enfield','CT'],
  ['06083',7.7,'Enfield','CT'],
  ['06084',17.7,'Tolland','CT'],
  ['06088',12.3,'East Windsor','CT'],
  ['06090',18.0,'West Granby','CT'],
  ['06093',10.5,'West Suffield','CT'],
  ['06095',16.7,'Windsor','CT'],
  ['06096',11.9,'Windsor Locks','CT'],
  ['06199',12.6,'Hartford','CT'],
]);
const byZip = new Map(zips.map(row => [row[0], row]));
// How far past the radius a ZIP centre may be and still be worth a human check (homes in it can be inside 15 miles).
export const boundaryMiles = 3;

/**
 * @param {string} value a five-digit ZIP, optionally ZIP+4
 * @returns {{ zip:string, outcome:'in_area'|'boundary'|'outside', confidence:'high'|'low', distance_miles:number|null,
 *   place:string|null, state:string|null, radius_miles:number, by_arrangement:boolean, listed:boolean }}
 * `listed: false` means the ZIP isn't within 20 miles of the base (or isn't a real ZIP): outside the area either way.
 */
export function eligibility(value) {
  const match = /^(\d{5})(?:-\d{4})?$/.exec(String(value ?? '').trim());
  requireThat(match, 'Enter a five-digit ZIP code.', 400, 'invalid_zip');
  const zip = /** @type {RegExpExecArray} */ (match)[1];
  const radius = myoConfig.business.radiusMiles;
  const row = byZip.get(zip);
  const base = { zip, listed:Boolean(row), radius_miles:radius, place:row?.[2] ?? null, state:row?.[3] ?? null, distance_miles:row?.[1] ?? null };
  if (!row) return { ...base, outcome:'outside', confidence:'low', by_arrangement:true };
  if (row[1] <= radius - 1) return { ...base, outcome:'in_area', confidence:'high', by_arrangement:false };
  if (row[1] <= radius + boundaryMiles) return { ...base, outcome:'boundary', confidence:'low', by_arrangement:row[1] > radius };
  return { ...base, outcome:'outside', confidence:'high', by_arrangement:true };
}
