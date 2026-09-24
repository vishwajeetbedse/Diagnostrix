export const fmt = (v: number | null | undefined, dp = 4): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: dp });
};

export const compact = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
};

export const pct = (part?: number, whole?: number): string =>
  part != null && whole ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '—';

export const ageText = (age?: number | null): string => {
  if (age == null || !Number.isFinite(age)) return '—';
  if (age < 2) return `${Math.round(age * 12)} mo`;
  return `${fmt(age, 1)} y`;
};

export const titleCase = (s: string): string =>
  s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());

/** MedDRA terms arrive in upper case from FAERS. */
export const reactionText = (s: string): string => {
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const ago = (epochSeconds?: number | null): string => {
  if (!epochSeconds) return '—';
  const s = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

const COUNTRY = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string): string => {
  try { return COUNTRY.of(code.toUpperCase()) ?? code; } catch { return code; }
};

/**
 * ISMP / FDA Tall Man lettering for look-alike, sound-alike names.
 * Capitalises the letters that distinguish confusable pairs.
 */
const TALL_MAN: Record<string, string> = {
  hydroxyzine: 'hydrOXYzine', hydralazine: 'hydrALAZINE', hydrocodone: 'HYDROcodone', oxycodone: 'oxyCODONE',
  clonazepam: 'clonazePAM', clonidine: 'cloNIDine', lorazepam: 'LORazepam', alprazolam: 'ALPRAZolam',
  prednisone: 'predniSONE', prednisolone: 'prednisoLONE', glipizide: 'glipiZIDE', glyburide: 'glyBURIDE',
  lamotrigine: 'lamoTRIgine', lamivudine: 'lamiVUDine', metformin: 'metFORMIN', tramadol: 'traMADol',
  trazodone: 'traZODone', sertraline: 'sertraline', risperidone: 'risperiDONE', ropinirole: 'rOPINIRole',
  bupropion: 'buPROPion', buspirone: 'busPIRone', hydromorphone: 'HYDROmorphone', morphine: 'morphine',
  carbamazepine: 'carBAMazepine', oxcarbazepine: 'OXcarbazepine', dopamine: 'DOPamine', dobutamine: 'DOBUTamine',
  vinblastine: 'vinBLAStine', vincristine: 'vinCRIStine', cyclosporine: 'cycloSPORINE', cycloserine: 'cycloSERINE',
  chlorpromazine: 'chlorproMAZINE', chlorpropamide: 'chlorproPAMIDE', nicardipine: 'niCARdipine', nifedipine: 'NIFEdipine',
  quetiapine: 'QUEtiapine', olanzapine: 'OLANZapine', zolmitriptan: 'ZOLMitriptan', sumatriptan: 'SUMAtriptan',
};

export const tallMan = (name: string): string => {
  const key = name.trim().toLowerCase();
  const hit = TALL_MAN[key];
  if (hit) return hit;
  return titleCase(name);
};

export const hasTallMan = (name: string) => name.trim().toLowerCase() in TALL_MAN;
