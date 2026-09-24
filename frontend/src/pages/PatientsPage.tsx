import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { api } from '../api/client';
import type { PatientRecord } from '../api/types';
import { ageText, fmt } from '../lib/format';
import PatientForm from '../components/PatientForm';
import { ErrorNote, Loading, useDebounced } from '../components/ui';

/**
 * Patient registry: searchable table with inline create / edit / delete.
 * "Verify order" opens /verify?patient=<id>, which prefills Order verification from the record.
 */
export default function PatientsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const list = useQuery({ queryKey: ['patients', dq], queryFn: () => api.patients(dq), placeholderData: keepPreviousData });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['patients'] });
  const rows = list.data?.patients ?? [];

  const remove = async (p: PatientRecord) => {
    if (!window.confirm(`Delete patient record ${p.name}${p.mrn ? ` (MRN ${p.mrn})` : ''}? Audit entries that reference it are kept.`)) return;
    try { await api.patientDelete(p.id); setDeleteError(null); refresh(); } catch (e) { setDeleteError(e); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Patients</h1>
        <div className="row">
          <div className="search-field">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Name or MRN" aria-label="Search patients" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn btn--primary btn--sm" type="button" onClick={() => { setCreating(true); setEditing(null); }} disabled={creating}>
            <Plus aria-hidden="true" />New patient
          </button>
        </div>
      </div>

      {creating && (
        <section className="panel">
          <header className="panel__head"><h2 className="panel__title">New patient</h2></header>
          <div className="panel__body">
            <PatientForm submitLabel="Create" onCancel={() => setCreating(false)}
              onSubmit={async (p) => { await api.patientCreate(p); setCreating(false); refresh(); }} />
          </div>
        </section>
      )}
      {deleteError != null && <ErrorNote error={deleteError} />}

      <section className="panel panel--flush">
        <header className="panel__head">
          <h2 className="panel__title">Patient list</h2>
          <span className="panel__meta">{list.data ? `${rows.length} record${rows.length === 1 ? '' : 's'}${dq ? ` matching "${dq}"` : ''}` : ''}</span>
        </header>
        {list.isLoading ? <div className="panel__body"><Loading label="Loading" /></div>
          : list.error ? <div className="panel__body"><ErrorNote error={list.error} /></div>
          : !rows.length ? <div className="empty">{dq ? 'No matching patients.' : 'No patient records.'}</div>
          : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>MRN</th><th className="r">Age</th><th>Sex</th><th className="r">Wt (kg)</th><th className="r">Ht (cm)</th><th className="r">SCr</th><th>Updated</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <Fragment key={p.id}>
                      <tr>
                        <td><strong>{p.name}</strong></td>
                        <td className="mono">{p.mrn ?? '—'}</td>
                        <td className="r mono">{ageText(p.age)}</td>
                        <td>{p.sex ?? '—'}</td>
                        <td className="r mono">{fmt(p.weight, 1)}</td>
                        <td className="r mono">{fmt(p.height, 1)}</td>
                        <td className="r mono">{fmt(p.scr, 2)}</td>
                        <td className="mono nowrap muted">{new Date(p.updated_at * 1000).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="table__actions">
                          <Link className="btn btn--sm" to={`/verify?patient=${p.id}`}>Verify order</Link>
                          <button className="btn btn--sm" type="button" onClick={() => { setEditing(editing === p.id ? null : p.id); setCreating(false); }}>Edit</button>
                          <button className="btn btn--sm btn--danger" type="button" onClick={() => remove(p)}>Delete</button>
                        </td>
                      </tr>
                      {editing === p.id && (
                        <tr className="table__editrow">
                          <td colSpan={9}>
                            <PatientForm initial={p} submitLabel="Save" onCancel={() => setEditing(null)}
                              onSubmit={async (patch) => { await api.patientUpdate(p.id, patch); setEditing(null); refresh(); }} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
