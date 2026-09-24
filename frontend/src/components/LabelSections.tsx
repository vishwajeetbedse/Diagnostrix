import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Label, Provenance } from '../api/types';
import { ProvenanceTag, Tabs } from './ui';

export default function LabelSections({ label, provenance, only }: { label: Label; provenance: Provenance | null; only?: string[] }) {
  const sections = only ? label.sections.filter((s) => only.includes(s.key)) : label.sections;
  const [key, setKey] = useState(sections[0]?.key ?? '');
  const cur = sections.find((s) => s.key === key) ?? sections[0];
  if (!sections.length) return <div className="panel__body muted">The label has none of these sections.</div>;
  return (
    <div>
      <Tabs label="Label sections" value={cur.key} onChange={setKey} tabs={sections.map((s) => ({ id: s.key, label: s.title }))} />
      <div className="label-text">
        <Expandable text={cur.text} limit={1400} />
        <div className="label-foot">
          {label.manufacturer && <span>{label.manufacturer}</span>}
          {label.effectiveTime && <span>Effective {label.effectiveTime.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}</span>}
          {provenance && <ProvenanceTag p={provenance} label="openFDA" />}
          {label.dailyMedUrl && <a className="ext" href={label.dailyMedUrl} target="_blank" rel="noreferrer">Full label <ExternalLink /></a>}
        </div>
      </div>
    </div>
  );
}

export function Expandable({ text, limit }: { text: string; limit: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  const shown = open || !long ? text : text.slice(0, limit).replace(/\s+\S*$/, '') + '…';
  return (
    <div className="expandable">
      {shown.split(/(?<=\.)\s+(?=[A-Z0-9(])/).reduce<string[][]>((acc, s, i) => { if (i % 4 === 0) acc.push([]); acc[acc.length - 1].push(s); return acc; }, []).map((para, i) => <p key={i}>{para.join(' ')}</p>)}
      {long && <button className="linklike" type="button" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Read full section'}</button>}
    </div>
  );
}

