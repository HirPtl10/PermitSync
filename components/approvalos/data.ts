import type { AppRecord, Inspection, Step } from './types';

export const DEFAULT_FORM = { name: 'Konkan Precision Components', sector: 'Manufacturing', state: 'Maharashtra', district: 'Pune', investment: '₹75 crore', stage: 'Pre-establishment' };
export const MH_DISTRICTS = ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Chhatrapati Sambhajinagar'];
export const GJ_DISTRICTS = ['Anand', 'Vadodara', 'Ahmedabad'];
export const initialInspections: Inspection[] = [{
  id: 'INSP-001',
  applicationId: 'APP-GJ-0201',
  applicant: 'Dhruv Chemical Works',
  location: 'Vadodara, Gujarat',
  date: 'Tuesday',
  time: '10:00 AM',
  departments: ['Fire Department', 'Factory Inspectorate', 'MPCB'],
  inspectionType: 'Site inspection',
  status: 'proposed',
  responses: { 'Fire Department': 'pending', 'Factory Inspectorate': 'pending', MPCB: 'pending', MIDC: 'pending' },
  notes: 'Same premises with overlapping inspection availability.'
}];
const MAITRI = "MAITRI — Maharashtra's state single window (syncs status to NSWS)";
const GUJARAT_PORTAL = 'State portal (Gujarat)';

export function rulesFor(state: string, sector: string, investment: string): Step[] {
  const maharashtra = state === 'Maharashtra'; const large = investment === '₹75 crore' || investment === '₹150 crore';
  const pollution = maharashtra ? 'MPCB consent to establish' : 'Pollution consent';
  const fire = maharashtra ? 'Fire NOC (Maharashtra Fire Prevention Act)' : 'Fire NOC';
  const land = maharashtra ? 'MIDC plot / land allotment' : 'Building plan';
  const factoryApplicant = sector === 'Manufacturing';
  const labour = factoryApplicant ? 'Factory licence (Directorate of Industrial Safety & Health)' : 'Labour licence';
  const portal = maharashtra ? MAITRI : GUJARAT_PORTAL;
  if (sector === 'IT-Services') return [{ name: land, department: maharashtra ? 'MIDC' : 'Urban Development', status: 'Eligible', days: '0 of 10 days used', filingPortal: portal }, { name: fire, department: maharashtra ? 'Maharashtra Fire Services' : 'Fire & Emergency', status: 'Eligible', days: '0 of 15 days used', filingPortal: portal }];
  return [
    { name: pollution, department: maharashtra ? 'Maharashtra Pollution Control Board (MPCB)' : 'GPCB', status: 'Eligible', days: maharashtra && large ? 'Maha Parwana: 0 of 30 days used' : '0 of 21 days used', filingPortal: portal },
    { name: fire, department: maharashtra ? 'Maharashtra Fire Services' : 'Fire & Emergency', status: 'Eligible', days: maharashtra && large ? 'Maha Parwana: 0 of 30 days used' : '0 of 15 days used', filingPortal: portal },
    { name: land, department: maharashtra ? 'Maharashtra Industrial Development Corporation (MIDC)' : 'Urban Development', status: 'Eligible', days: '0 of 10 days used', filingPortal: portal },
    { name: labour, department: factoryApplicant ? 'Directorate of Industrial Safety & Health' : (maharashtra ? 'Maharashtra Labour Department' : 'Labour'), status: 'Blocked', days: '—', filingPortal: portal, depends: land }
  ];
}

export const seedApps: AppRecord[] = [
  { id: 'APP-MH-0142', name: 'Konkan Components Pvt Ltd', sector: 'Manufacturing', state: 'Maharashtra', district: 'Pune', investment: '₹75 crore', stage: 'Construction', status: 'On track', createdAt: 'Seeded', mahaParwana: true, steps: [{ name: 'MPCB consent to establish', department: 'MPCB', status: 'Under review', days: 'Maha Parwana: 8 of 30 days used', filingPortal: MAITRI }, { name: 'Fire NOC (Maharashtra Fire Prevention Act)', department: 'Maharashtra Fire Services', status: 'Eligible', days: 'Maha Parwana: 0 of 30 days used', filingPortal: MAITRI }, { name: 'MIDC plot / land allotment', department: 'MIDC', status: 'Submitted', days: '5 of 10 days used', filingPortal: MAITRI }, { name: 'Factory licence (Directorate of Industrial Safety & Health)', department: 'Directorate of Industrial Safety & Health', status: 'Blocked', days: '—', filingPortal: MAITRI, depends: 'MIDC plot / land allotment' }] },
  { id: 'APP-MH-0143', name: 'Deccan Food Systems', sector: 'Food processing', state: 'Maharashtra', district: 'Nashik', investment: '₹75 crore', stage: 'Pre-establishment', status: 'At risk', createdAt: 'Seeded', mahaParwana: true, steps: rulesFor('Maharashtra', 'Food processing', '₹75 crore').map((s, i) => i === 0 ? { ...s, status: 'Under review', days: 'Maha Parwana: 27 of 30 days used' } : s) },
  { id: 'APP-MH-0144', name: 'Vidarbha Engineering', sector: 'Manufacturing', state: 'Maharashtra', district: 'Nagpur', investment: '₹30 crore', stage: 'Construction', status: 'On track', createdAt: 'Seeded', steps: rulesFor('Maharashtra', 'Manufacturing', '₹30 crore').map((s, i) => i === 2 ? { ...s, status: 'Under review', days: '6 of 10 days used' } : s) },
  { id: 'APP-GJ-0201', name: 'Dhruv Chemical Works', sector: 'Chemicals', state: 'Gujarat', district: 'Vadodara', investment: '₹50 crore', stage: 'Construction', status: 'Breached', createdAt: 'Seeded', steps: rulesFor('Gujarat', 'Chemicals', '₹50 crore').map((s, i) => i === 1 ? { ...s, status: 'Under review', days: '19 of 15 days used' } : s) },
  { id: 'APP-GJ-0202', name: 'Nexus Infoware', sector: 'IT-Services', state: 'Gujarat', district: 'Ahmedabad', investment: '₹2 crore', stage: 'Pre-establishment', status: 'On track', createdAt: 'Seeded', steps: rulesFor('Gujarat', 'IT-Services', '₹2 crore') },
  { id: 'APP-GJ-0203', name: 'Saffron Foods LLP', sector: 'Food processing', state: 'Gujarat', district: 'Anand', investment: '₹12 crore', stage: 'Construction', status: 'At risk', createdAt: 'Seeded', steps: rulesFor('Gujarat', 'Food processing', '₹12 crore') }
];
