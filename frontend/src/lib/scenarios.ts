import type { OrderInput, Patient } from '../api/types';

export interface Scenario {
  id: string;
  label: string;
  story: string;
  patient: Patient & { location: string };
  orders: OrderInput[];
}

// Sample patients for demonstration. Every field stays editable.
export const SCENARIOS: Scenario[] = [
  {
    id: 'peds-apap', label: 'Pediatric paracetamol overdose', story: '6 y · 20 kg · adult-strength dosing',
    patient: { name: 'Rao, Ishaan', mrn: '004817', location: 'Pediatrics 3B · Bed 12', age: 6, sex: 'M', weight: 20, height: 116, scr: 0.4 },
    orders: [
      { line: 1, name: 'Acetaminophen', dose: 500, freqId: 'q4h' },
      { line: 2, name: 'Ibuprofen', dose: 200, freqId: 'q8h' },
    ],
  },
  {
    id: 'warf-amio', label: 'Anticoagulant + antiarrhythmic', story: '68 y · warfarin + amiodarone',
    patient: { name: 'D’Souza, Margaret', mrn: '002391', location: 'Cardiology 5A · Bed 04', age: 68, sex: 'F', weight: 62, height: 158, scr: 1.1 },
    orders: [
      { line: 1, name: 'Warfarin', dose: 5, freqId: 'daily' },
      { line: 2, name: 'Amiodarone', dose: 400, freqId: 'q12h' },
    ],
  },
  {
    id: 'serotonin', label: 'Three failures in one order', story: '11 y · tramadol + linezolid',
    patient: { name: 'Kulkarni, Ananya', mrn: '005102', location: 'Pediatric Surgery 2C · Bed 07', age: 11, sex: 'F', weight: 36, height: 145, scr: 0.5 },
    orders: [
      { line: 1, name: 'Tramadol', dose: 50, freqId: 'q6h' },
      { line: 2, name: 'Linezolid', dose: 400, freqId: 'q8h' },
    ],
  },
  {
    id: 'poly', label: 'Polypharmacy, four agents', story: '74 y · interactions on lines 2–4',
    patient: { name: 'Menon, Lakshmi', mrn: '003358', location: 'Cardiology 5A · Bed 09', age: 74, sex: 'F', weight: 64, height: 156, scr: 1.2 },
    orders: [
      { line: 1, name: 'Acetaminophen', dose: 650, freqId: 'q6h' },
      { line: 2, name: 'Warfarin', dose: 5, freqId: 'daily' },
      { line: 3, name: 'Omeprazole', dose: 20, freqId: 'daily' },
      { line: 4, name: 'Amiodarone', dose: 200, freqId: 'daily' },
    ],
  },
  {
    id: 'global', label: 'Drugs outside the curated list', story: '58 y · simvastatin + clarithromycin',
    patient: { name: 'Iyer, Suresh', mrn: '007741', location: 'General Medicine 6A · Bed 02', age: 58, sex: 'M', weight: 81, height: 172, scr: 1.0 },
    orders: [
      { line: 1, name: 'Simvastatin', dose: 40, freqId: 'daily' },
      { line: 2, name: 'Clarithromycin', dose: 500, freqId: 'q12h' },
    ],
  },
  {
    id: 'digoxin', label: 'Older adult, poor kidney function', story: '82 y · digoxin + clarithromycin',
    patient: { name: 'Fernandes, Joseph', mrn: '001774', location: 'Geriatric Medicine 4D · Bed 21', age: 82, sex: 'M', weight: 58, height: 168, scr: 1.9 },
    orders: [
      { line: 1, name: 'Digoxin', dose: 0.25, freqId: 'daily' },
      { line: 2, name: 'Clarithromycin', dose: 500, freqId: 'q12h' },
    ],
  },
  {
    id: 'clean', label: 'Order within safety parameters', story: '45 y · paracetamol + fluconazole',
    patient: { name: 'Nair, Priya', mrn: '006230', location: 'General Medicine 6A · Bed 15', age: 45, sex: 'F', weight: 70, height: 165, scr: 0.9 },
    orders: [
      { line: 1, name: 'Acetaminophen', dose: 650, freqId: 'q6h' },
      { line: 2, name: 'Fluconazole', dose: 200, freqId: 'daily' },
    ],
  },
];
