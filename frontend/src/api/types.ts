// Shapes returned by the Diagnostix API (backend/app/api/routes.py).

export type Severity = 'critical' | 'advisory';
export type CheckResult = 'pass' | 'fail' | 'advisory' | 'n/a';

export interface Patient {
  name?: string;
  mrn?: string;
  age?: number | null;
  sex?: 'M' | 'F';
  weight?: number | null;
  height?: number | null;
  scr?: number | null;
}

/** A saved patient record (backend/app/services/patients.py). */
export interface PatientRecord {
  id: number;
  name: string;
  mrn: string | null;
  age: number | null;
  sex: 'M' | 'F' | null;
  weight: number | null;
  height: number | null;
  scr: number | null;
  created_at: number;
  updated_at: number;
}

export type PatientInput = Omit<PatientRecord, 'id' | 'created_at' | 'updated_at'>;

/** Maximum order lines per verification — mirrors MAX_ORDER_LINES in routes.py. */
export const MAX_ORDER_LINES = 15;

export interface OrderInput {
  line: number;
  name: string;
  dose: number | null;
  freqId: string;
}

export interface Frequency { id: string; label: string; perDay: number }

export interface Ceiling { value: number; raw: number; capped: boolean; rule: 'pediatric' | 'adult'; basis: string }

export interface OrderLineResult {
  line: number;
  input: string;
  drug: { id: string; name: string; curated: boolean };
  ingredient: string;
  freq: Frequency;
  dose: number | null;
  tdd: number | null;
  ceiling: Ceiling | null;
  pct: number | null;
  mgPerKg: number | null;
}

export interface DDInterHit { level: 'Major' | 'Moderate' | 'Minor' | 'Unknown'; drugA: string; drugB: string; url?: string; source: string }

export interface Monograph { severity: string; kind: string; mechanism: string; effect: string; management: string }

export interface Finding {
  id: string;
  rule: string;
  type: string;
  severity: Severity;
  lines: number[];
  hardStop: boolean;
  headline: string;
  summary: string;
  rationale: string;
  actions: string[];
  monitoring: string[];
  data: Record<string, any>;
}

export interface Measure { value: number; unit: string; formula?: string; category?: string; label?: string }

export interface Profile {
  band: { id: string; label: string; pediatric: boolean | null };
  bmi: Measure | null;
  bsa: Measure | null;
  ibw: Measure | null;
  renal: Measure | null;
}

export interface VerifyResult {
  id: string;
  at: string;
  kbVersion: string;
  status: 'critical' | 'advisory' | 'pass';
  counts: { critical: number; advisory: number };
  findings: Finding[];
  lines: OrderLineResult[];
  checks: { label: string; result: CheckResult; detail: string }[];
  profile: Profile;
  engineMs: number;
}

export interface Provenance { source: string; url: string; fetchedAt: number; cached: boolean; stale: boolean }

export interface LabelSection { key: string; title: string; text: string; truncated: boolean }
export interface Label {
  setId: string | null;
  effectiveTime: string | null;
  brandNames: string[];
  genericNames: string[];
  manufacturer: string | null;
  pharmClass: string[];
  sections: LabelSection[];
  dailyMedUrl: string | null;
}

export interface CuratedDrug {
  id: string; name: string; aka: string; cls: string; route: string;
  adultMaxDaily: number; pedsMaxMgPerKgDay: number; minAgeYears?: number; minAgeNote?: string;
  brands?: string[]; riskTags: string[]; contraindicatedWith: string[]; monitoring: string[]; toxicity: string;
  renal?: { threshold: number; note: string }; geriatric?: { age: number; maxDaily?: number; note: string };
}

export interface DrugProfile {
  resolution: Resolution;
  ingredient: string;
  curated: CuratedDrug | null;
  label: Label | null;
  labelProvenance: Provenance | null;
  labelError: string | null;
  ddinter: { available: boolean; total?: number; counts: Record<string, number>; items: { name: string; level: string }[] };
}

export interface TermCount { term: string; count: number }
export interface Faers {
  ingredient: string;
  reports?: number; serious?: number; deaths?: number; hospitalisations?: number;
  reactions?: TermCount[]; countries?: TermCount[]; years?: { year: number; count: number }[];
  provenance?: Provenance; error?: string;
}

export interface Ror { ror: number; lo: number; hi: number; n: number; signal: boolean }
export interface SignalRow {
  reaction: string;
  reports: { pair: number; a: number; b: number; all: number };
  pair: Ror | null; a: Ror | null; b: Ror | null;
  excess: number | null;
}
export interface Signal {
  a: string; b: string;
  totals?: { all: number; a: number; b: number; pair: number };
  reactions?: SignalRow[];
  provenance?: Provenance;
  method?: string;
  error?: string;
}

export interface LabelMention { section: string; text: string; match: string }
export interface PairEvidence {
  a: string; b: string;
  curated: { monograph: Monograph | null; drugs: [boolean, boolean]; version: string };
  ddinter: DDInterHit | null;
  ddinterAvailable: boolean;
  label: {
    aMentionsB: LabelMention[]; bMentionsA: LabelMention[];
    a: (Partial<Label> & { provenance: Provenance | null }) | null;
    b: (Partial<Label> & { provenance: Provenance | null }) | null;
    errors: string[];
  };
}

export interface Resolution {
  input: string; normalised: string; ingredients: string[]; curated?: string[];
  via: 'generic' | 'alias' | 'brand' | 'combination' | 'ddinter' | 'rxnorm' | null;
  rxcui?: string; concept?: string;
}

export type ScreenSeverity = 'contraindicated' | 'major' | 'moderate' | 'minor' | 'none';
export interface ScreenCell {
  a: string; b: string; severity: ScreenSeverity; source: string | null;
  monograph: Monograph | null; ddinter: DDInterHit | null; entries: string[];
}
export interface ScreenResult {
  resolved: Resolution[];
  ingredients: string[];
  cells: ScreenCell[];
  findings: (({ type: 'duplicate'; severity: 'major'; ingredient: string; entries: string[]; adultMax: number | null }) | ({ type: 'interaction' } & ScreenCell))[];
  unresolved: string[];
  ddinterAvailable: boolean;
}

export interface SearchHit { name: string; kind: 'curated' | 'brand' | 'combination' | 'ddinter' | 'rxnorm'; ingredient: string | null; detail: string }

export interface SourceHealth { ok: number; failed: number; lastError: string | null; lastOk: number | null; latencyMs: number | null; circuitOpen: boolean }
export interface Health {
  version: string;
  mode: 'live' | 'offline' | 'fixtures';
  openfdaKey: boolean;
  formulary: { version: string; drugs: number; integrity: { ok: boolean; issues: string[] } };
  ddinter: { available: boolean; pairs?: string; drugs?: string; imported_at?: string };
  rxnormNames: number;
  sources: Record<string, SourceHealth>;
  cache: Record<string, { entries: number; latest: number }>;
  ai: { state: string; model: string; device: string; error: string | null };
  audit: { entries: number };
}

export interface Formulary {
  version: string; note: string; drugs: CuratedDrug[]; monographs: Record<string, Monograph>;
  combinations: Record<string, string[]>; frequencies: Frequency[]; integrity: { ok: boolean; issues: string[] };
}

export interface AuditEntry { seq: number; at: number; event: string; ref: string; actor: string; payload: Record<string, any>; prev: string; hash: string }
export interface ChainCheck { ok: boolean; entries: number; brokenAt?: number; head?: string; detail: string }
