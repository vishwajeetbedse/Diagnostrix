/**
 * Diagnostix CDSS — application controller (UI layer)
 * Wires the patient parameters, order grid, verification engine,
 * rationale layer, order-check dialog, knowledge base and audit trail.
 */
(function () {
  'use strict';

  const { formulary: F, clinicalMath: M, engine: E, rationale: R, screen: S, ai: AI } = window.DX;
  const n = R.formatNumber;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? 0 : ms));

  const ICON = {
    alert: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 1 14h14L8 1.5Z" fill="currentColor"/><path d="M8 6v3.6" stroke="#b3121b" stroke-width="1.6"/><circle cx="8" cy="11.6" r=".9" fill="#b3121b"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m4.8 8.2 2.2 2.2 4.2-4.6" fill="none" stroke="#1b6f2e" stroke-width="1.7"/></svg>',
    info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4.2" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="4.9" r=".85" fill="currentColor"/></svg>',
    pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V8l2.3 1.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
  };

  const TYPE_LABEL = {
    'dose-peds': 'Dose range — pediatric',
    'dose-adult': 'Dose range — adult',
    interaction: 'Drug–drug interaction',
    age: 'Age restriction',
    duplicate: 'Duplicate therapy',
    data: 'Incomplete data',
    'near-ceiling': 'Dose range — near max',
    renal: 'Renal dosing',
    geriatric: 'Geriatric (Beers)'
  };

  const BAND_RANGE = {
    neonate: 'Neonate (< 28 days)', infant: 'Infant (< 1 year)', child: 'Child (1–11 years)',
    adolescent: 'Adolescent (12–17 years)', adult: 'Adult (18–64 years)', older: 'Older adult (≥ 65 years)', unknown: 'Age not recorded'
  };

  // ---------------------------------------------------------------- scenarios
  const SCENARIOS = [
    {
      id: 'peds-apap',
      label: 'Rao, Ishaan — 6 y · acetaminophen overdose',
      patient: { name: 'RAO, Ishaan', mrn: '004817', loc: 'Pediatrics 3B · Bed 12', age: 6, sex: 'M', weight: 20, height: 116, scr: 0.4 },
      lines: [
        { drugId: 'acetaminophen', dose: 500, freqId: 'q4h', enabled: true },
        { drugId: 'ibuprofen', dose: 200, freqId: 'q8h', enabled: true }
      ]
    },
    {
      id: 'warf-amio',
      label: 'D’Souza, Margaret — 68 y · warfarin + amiodarone',
      patient: { name: 'D’SOUZA, Margaret', mrn: '002391', loc: 'Cardiology 5A · Bed 04', age: 68, sex: 'F', weight: 62, height: 158, scr: 1.1 },
      lines: [
        { drugId: 'warfarin', dose: 5, freqId: 'daily', enabled: true },
        { drugId: 'amiodarone', dose: 400, freqId: 'q12h', enabled: true }
      ]
    },
    {
      id: 'serotonin',
      label: 'Kulkarni, Ananya — 11 y · tramadol + linezolid',
      patient: { name: 'KULKARNI, Ananya', mrn: '005102', loc: 'Pediatric Surgery 2C · Bed 07', age: 11, sex: 'F', weight: 36, height: 145, scr: 0.5 },
      lines: [
        { drugId: 'tramadol', dose: 50, freqId: 'q6h', enabled: true },
        { drugId: 'linezolid', dose: 400, freqId: 'q8h', enabled: true }
      ]
    },
    {
      id: 'lithium',
      label: 'Menon, Rahul — 34 y · lithium + ibuprofen',
      patient: { name: 'MENON, Rahul', mrn: '003356', loc: 'Psychiatry 1B · Bed 09', age: 34, sex: 'M', weight: 78, height: 176, scr: 0.9 },
      lines: [
        { drugId: 'lithium', dose: 600, freqId: 'q12h', enabled: true },
        { drugId: 'ibuprofen', dose: 400, freqId: 'q8h', enabled: true }
      ]
    },
    {
      id: 'digoxin',
      label: 'Fernandes, Joseph — 82 y · digoxin + clarithromycin',
      patient: { name: 'FERNANDES, Joseph', mrn: '001774', loc: 'Geriatric Medicine 4D · Bed 21', age: 82, sex: 'M', weight: 58, height: 168, scr: 1.9 },
      lines: [
        { drugId: 'digoxin', dose: 0.25, freqId: 'daily', enabled: true },
        { drugId: 'clarithromycin', dose: 500, freqId: 'q12h', enabled: true }
      ]
    },
    {
      id: 'clean',
      label: 'Nair, Priya — 45 y · no safety alerts',
      patient: { name: 'NAIR, Priya', mrn: '006230', loc: 'General Medicine 6A · Bed 15', age: 45, sex: 'F', weight: 70, height: 165, scr: 0.9 },
      lines: [
        { drugId: 'acetaminophen', dose: 650, freqId: 'q6h', enabled: true },
        { drugId: 'fluconazole', dose: 200, freqId: 'daily', enabled: true }
      ]
    }
  ];

  const OVERRIDE_REASONS = [
    'Prescriber confirmed — clinically appropriate',
    'Protocol-driven regimen (e.g. loading dose)',
    'Specialist recommendation documented',
    'Benefit outweighs risk — monitoring plan in place'
  ];
  const HARD_STOPS = new Set(['data', 'age', 'duplicate']);

  const state = {
    mrn: '—',
    loc: '—',
    result: null,
    rationales: [],
    selected: 0,
    overrides: {},
    acknowledged: {},
    overrideOpen: false,
    stale: false,
    signed: false,
    busy: false,
    audit: [],
    selectedPair: 'amiodarone|warfarin',
    ai: {},        // `${resultId}|${findingId}` → { status, text, model, ms, reason }
    aiView: {},    // same key → 'ai' | 'kb' (which rationale text is shown)
    screen: null   // last interaction-screen run
  };

  // ------------------------------------------------------------ patient data
  function readPatient() {
    const num = (id) => {
      const v = parseFloat($(id).value);
      return Number.isFinite(v) ? v : NaN;
    };
    return { name: $('pt-name').value.trim(), age: num('pt-age'), sex: $('pt-sex').value, weight: num('pt-weight'), height: num('pt-height'), scr: num('pt-scr') };
  }

  function readOrders() {
    const orders = [];
    [1, 2].forEach((i) => {
      if (i === 2 && !$('rx2-enabled').checked) return;
      const drugId = $(`rx${i}-drug`).value;
      if (!drugId) return;
      orders.push({ line: i, drugId, dose: parseFloat($(`rx${i}-dose`).value), freqId: $(`rx${i}-freq`).value });
    });
    return orders;
  }

  function fmtAge(age) {
    if (!Number.isFinite(age)) return '—';
    if (age < 2) return `${Math.round(age * 12)} mo`;
    return `${n(age)} y`;
  }

  function initials(name) {
    const parts = name.replace(/[^A-Za-z ,’']/g, '').split(/[ ,]+/).filter(Boolean);
    if (!parts.length) return '--';
    return ((parts[1] || '')[0] || '').toUpperCase() + (parts[0][0] || '').toUpperCase();
  }

  function renderBanner() {
    const p = readPatient();
    const prof = M.profile(p);
    $('b-name').textContent = p.name || 'Unidentified patient';
    $('b-initials').textContent = initials(p.name);
    $('b-age').textContent = fmtAge(p.age);
    $('b-sex').textContent = p.sex === 'M' ? 'Male' : 'Female';
    $('b-mrn').textContent = state.mrn;
    $('b-weight').textContent = Number.isFinite(p.weight) ? `${n(p.weight)} kg` : '—';
    $('b-height').textContent = Number.isFinite(p.height) ? `${n(p.height)} cm` : '—';
    $('b-bsa').textContent = prof.bsa ? `${prof.bsa.value.toFixed(2)} m²` : '—';
    $('b-renal').textContent = prof.renal ? `${prof.renal.label} ${prof.renal.value}` : '—';
    $('b-loc').textContent = state.loc;
    const flag = $('b-band');
    flag.textContent = prof.band.pediatric === null ? 'Age required' : prof.band.pediatric ? 'Pediatric · weight-based dosing' : prof.band.label;
    flag.dataset.peds = String(!!prof.band.pediatric);
  }

  function renderMetrics() {
    const p = readPatient();
    const prof = M.profile(p);
    const row = (label, val, sub) =>
      val == null
        ? `<tr><th scope="row">${label}</th><td class="na">${sub}</td></tr>`
        : `<tr><th scope="row">${label}</th><td>${val}${sub ? `<small>${sub}</small>` : ''}</td></tr>`;
    const band = prof.band;
    $('metrics').innerHTML =
      row('Population', BAND_RANGE[band.id], '') +
      row('Dosing rule', band.pediatric === null ? null : band.pediatric ? 'mg/kg/day × weight' : 'Adult absolute max', band.pediatric === null ? 'Enter age' : band.pediatric ? 'Capped at adult maximum' : '') +
      row('BMI', prof.bmi && `${prof.bmi.value} kg/m²`, prof.bmi ? prof.bmi.category : 'Weight and height required') +
      row('BSA', prof.bsa && `${prof.bsa.value.toFixed(2)} m²`, prof.bsa ? 'Mosteller' : 'Weight and height required') +
      row('Ideal body wt.', prof.ibw && `${prof.ibw.value} kg`, prof.ibw ? 'Devine' : 'Adults ≥ 152 cm only') +
      row(prof.renal ? (prof.renal.label === 'CrCl' ? 'CrCl' : 'eGFR') : 'Renal function', prof.renal && `${prof.renal.value} ${prof.renal.unit}`, prof.renal ? (prof.renal.label === 'CrCl' ? 'Cockcroft–Gault' : 'Bedside Schwartz') : 'Serum creatinine required');
  }

  // --------------------------------------------------------------- order grid
  function buildOrderRows() {
    const drugOptions = F.DRUGS.slice().sort((a, b) => a.name.localeCompare(b.name)).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    const freqOptions = F.FREQUENCIES.map((f) => `<option value="${f.id}">${f.label} (${f.perDay}×/day)</option>`).join('');
    $('orders-body').innerHTML = [1, 2]
      .map(
        (i) => `<tr id="rx-row-${i}">
        <td class="c-act">${i === 1 ? '<input type="checkbox" checked disabled aria-label="Line 1 active">' : '<input type="checkbox" id="rx2-enabled" checked aria-label="Line 2 active">'}</td>
        <td class="c-num num">${i}</td>
        <td><select id="rx${i}-drug" aria-label="Line ${i} medication"><option value="">— Select —</option>${drugOptions}</select></td>
        <td><input id="rx${i}-dose" type="number" min="0" step="any" inputmode="decimal" aria-label="Line ${i} dose in milligrams"></td>
        <td><select id="rx${i}-freq" aria-label="Line ${i} frequency">${freqOptions}</select></td>
        <td id="rx${i}-route" class="muted">—</td>
        <td class="r" id="rx${i}-tdd">—</td>
        <td class="r" id="rx${i}-max">—</td>
        <td id="rx${i}-pct">—</td>
        <td id="rx${i}-check"><span class="flag flag--none">Not verified</span></td>
      </tr>`
      )
      .join('');
  }

  /** Live, pre-verification dose math for one line. */
  function lineCalc(i) {
    const p = readPatient();
    const drug = F.getDrug($(`rx${i}-drug`).value);
    const freq = F.getFrequency($(`rx${i}-freq`).value);
    const dose = parseFloat($(`rx${i}-dose`).value);
    const active = i === 1 || $('rx2-enabled').checked;
    if (!drug) return { drug: null, active };
    const ageOk = Number.isFinite(p.age) && (p.age >= 18 || p.weight > 0);
    const ceiling = ageOk ? E.dailyCeiling(drug, p) : null;
    const tdd = Number.isFinite(dose) && dose > 0 ? Number((dose * freq.perDay).toFixed(4)) : null;
    const pct = ceiling && tdd != null ? Math.round((tdd / ceiling.value) * 100) : null;
    return { drug, freq, dose, tdd, ceiling, pct, active, p };
  }

  function renderLine(i) {
    const c = lineCalc(i);
    const row = $(`rx-row-${i}`);
    row.dataset.disabled = String(!c.active);
    $(`rx${i}-route`).textContent = c.drug ? c.drug.route : '—';
    $(`rx${i}-tdd`).textContent = c.tdd != null ? `${n(c.tdd)} mg` : '—';
    $(`rx${i}-max`).textContent = c.ceiling ? `${n(c.ceiling.value)} mg` : '—';
    if (c.pct != null) {
      const l = c.pct > 100 ? 'crit' : c.pct >= E.NEAR_CEILING_PCT ? 'warn' : 'ok';
      $(`rx${i}-pct`).innerHTML = `<span class="pct"><span class="pct__bar" title="Marker = 100% of maximum"><i data-l="${l}" style="width:${(Math.min(c.pct, 150) / 150) * 100}%"></i><b></b></span><span class="pct__num" data-l="${l}">${c.pct}%</span></span>`;
    } else {
      $(`rx${i}-pct`).textContent = '—';
    }
    renderBasis();
  }

  function renderBasis() {
    const rows = [1, 2]
      .map((i) => {
        const c = lineCalc(i);
        if (!c.drug || !c.active) return '';
        const calc = !c.ceiling
          ? '<span class="muted">Ceiling requires age' + (c.p.age < 18 ? ' and weight' : '') + '</span>'
          : c.ceiling.rule === 'pediatric'
            ? `<code>${c.drug.pedsMaxMgPerKgDay} mg/kg/day × ${n(c.p.weight)} kg = ${n(c.ceiling.raw)} mg/day</code>${c.ceiling.capped ? ` <code>→ capped at adult max ${n(c.drug.adultMaxDaily)} mg/day</code>` : ''}`
            : `<code>Adult absolute maximum ${n(c.ceiling.value)} mg/day</code>`;
        const risk = c.drug.riskTags.filter((t) => /high-alert|Narrow|Boxed/i.test(t));
        return `<div class="basis__row"><b>Line ${i} · ${esc(c.drug.name)}</b><span>${esc(c.drug.cls)}</span>${calc}${risk.length ? `<span class="risk">${esc(risk.join(' · '))}</span>` : ''}</div>`;
      })
      .join('');
    $('basis').innerHTML = rows || '<div class="basis__row muted">Select a medication to view the dose ceiling calculation.</div>';
  }

  function renderLineChecks() {
    [1, 2].forEach((i) => {
      const row = $(`rx-row-${i}`);
      const cell = $(`rx${i}-check`);
      const r = state.result;
      const inResult = r && r.lines.some((l) => l.line === i);
      if (!r || state.stale || !inResult) {
        delete row.dataset.state;
        cell.innerHTML = `<span class="flag flag--none">${state.stale && inResult ? 'Re-verify' : 'Not verified'}</span>`;
        return;
      }
      const fs = r.findings.filter((f) => f.lines.includes(i));
      const openCrit = fs.filter((f) => f.severity === 'critical' && !state.overrides[f.id]);
      if (openCrit.length) {
        row.dataset.state = 'crit';
        cell.innerHTML = `<span class="flag flag--crit">${openCrit.length} critical</span>`;
      } else if (fs.some((f) => f.severity === 'critical')) {
        row.dataset.state = 'warn';
        cell.innerHTML = `<span class="flag flag--warn">Overridden</span>`;
      } else if (fs.length) {
        row.dataset.state = 'warn';
        cell.innerHTML = `<span class="flag flag--warn">Advisory</span>`;
      } else {
        row.dataset.state = 'ok';
        cell.innerHTML = `<span class="flag flag--ok">Passed</span>`;
      }
    });
  }

  // ------------------------------------------------------------ verification
  function setStatus(msg, busy) {
    const el = $('sb-msg');
    el.dataset.busy = String(!!busy);
    el.querySelector('span').textContent = msg;
  }

  async function runVerification({ animate = true, interrupt = true } = {}) {
    if (state.busy) return;
    state.busy = true;
    const btn = $('btn-verify');
    btn.disabled = true;

    const patient = readPatient();
    const orders = readOrders();
    const stages = ['Intercepting order…', 'Resolving patient context…', 'Cross-referencing clinical knowledge base…', 'Synthesizing clinical rationale…'];
    for (const s of stages) {
      setStatus(s, true);
      if (animate) await sleep(200);
    }
    const result = E.verify(patient, orders);
    const rationales = await R.explainAll(result);

    Object.assign(state, { result, rationales, selected: 0, overrides: {}, acknowledged: {}, overrideOpen: false, stale: false, signed: false, busy: false });
    btn.disabled = false;
    setStatus(`Verification complete · ${result.id}`, false);

    logAudit({
      ev: result.status,
      detail: result.status === 'pass' ? 'All order checks passed' : `${result.counts.critical} critical · ${result.counts.advisory} advisory`
    });
    renderAll();
    if (interrupt && unresolvedCritical().length) openModal();
    pumpAI();
  }

  function markStale() {
    if (!state.result || state.stale) return;
    state.stale = true;
    state.overrideOpen = false;
    setStatus('Order modified — re-verification required', false);
    renderAll();
  }

  function unresolvedCritical() {
    return state.result ? state.result.findings.filter((f) => f.severity === 'critical' && !state.overrides[f.id]) : [];
  }
  function hardStopOpen() {
    return state.result ? state.result.findings.some((f) => f.severity === 'critical' && HARD_STOPS.has(f.type)) : false;
  }

  function renderAll() {
    renderResult();
    renderLineChecks();
    renderStatusAlert();
  }

  function renderStatusAlert() {
    const el = $('sb-alert');
    const open = unresolvedCritical().length;
    if (state.result && !state.stale && open) {
      el.hidden = false;
      el.textContent = `${open} CRITICAL ORDER CHECK${open > 1 ? 'S' : ''}`;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    } else {
      el.hidden = true;
    }
  }

  function resultBar() {
    const r = state.result;
    if (!r) return `<div class="resbar">${ICON.pending}<span>Orders not yet verified</span><span class="resbar__detail">Enter orders and select Verify Orders (F9).</span></div>`;
    if (state.stale) return `<div class="resbar">${ICON.pending}<span>Order modified since ${r.id}</span><span class="resbar__detail">Results below are out of date. Re-verify before signing.</span></div>`;
    const open = unresolvedCritical().length;
    if (open) return `<div class="resbar" data-s="critical">${ICON.alert}<span>ORDER HELD — ${open} critical order check${open > 1 ? 's' : ''}</span><span class="resbar__detail">Modify the order or document an override for each critical finding.</span></div>`;
    if (r.status === 'critical') return `<div class="resbar" data-s="overridden">${ICON.info}<span>All critical findings overridden</span><span class="resbar__detail">Override reasons recorded in the audit trail.</span></div>`;
    if (r.status === 'advisory') return `<div class="resbar" data-s="advisory">${ICON.info}<span>Within dose limits — ${r.counts.advisory} advisory</span><span class="resbar__detail">No blocking findings. Review advisories before signing.</span></div>`;
    return `<div class="resbar" data-s="pass">${ICON.check}<span>Order within established safety parameters</span><span class="resbar__detail">Dose range, interaction, age and duplication checks passed.</span></div>`;
  }

  function statusFlag(f) {
    if (state.overrides[f.id]) return '<span class="flag flag--resolved">Overridden</span>';
    if (state.acknowledged[f.id]) return '<span class="flag flag--resolved">Acknowledged</span>';
    return f.severity === 'critical' ? '<span class="flag flag--crit">Active</span>' : '<span class="flag flag--warn">Active</span>';
  }

  function detailPane(f, x) {
    const hard = f.severity === 'critical' && HARD_STOPS.has(f.type);
    const resolved = !!state.overrides[f.id] || !!state.acknowledged[f.id];
    const canApply = (f.type === 'dose-peds' || f.type === 'dose-adult') && f.data.suggested > 0;
    const ov = state.overrides[f.id];

    let actions = '';
    if (state.stale) {
      actions = `<span class="detail__note">Re-verify the modified order to act on this finding.</span>`;
    } else if (ov) {
      actions = `<span class="detail__note"><b>Overridden:</b> ${esc(ov.reason)} — “${esc(ov.note)}”</span>`;
    } else if (state.acknowledged[f.id]) {
      actions = `<span class="detail__note">Advisory acknowledged.</span>`;
    } else if (hard) {
      actions = `<span class="detail__note"><b>Hard stop.</b> This finding cannot be overridden — correct the order.</span>`;
    } else if (f.severity === 'critical') {
      actions =
        (canApply ? `<button class="tbtn tbtn--primary" type="button" data-act="apply">Change to ${n(f.data.suggested)} mg ${esc(f.data.freq.label.toLowerCase())}</button>` : '') +
        `<button class="tbtn tbtn--danger" type="button" data-act="override-open">Override…</button>`;
    } else {
      actions = `<button class="tbtn" type="button" data-act="ack">Acknowledge</button>`;
    }

    const form = state.overrideOpen && !resolved && !hard ? `
      <div class="override">
        <label for="ov-reason">Reason</label>
        <select id="ov-reason">${OVERRIDE_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
        <label for="ov-note">Justification</label>
        <input id="ov-note" type="text" placeholder="Required — e.g. Discussed with Dr Iyer; daily INR ordered" autocomplete="off">
        <div class="override__btns">
          <button class="tbtn tbtn--danger" type="button" data-act="override-confirm">Confirm Override</button>
          <button class="tbtn" type="button" data-act="override-cancel">Cancel</button>
        </div>
      </div>` : '';

    return `
      <div class="detail">
        <div class="detail__head">
          <div class="detail__title">${esc(x.headline)}</div>
          <div class="detail__rule">${f.rule} · ${f.lines.length ? 'Line ' + f.lines.join(' + ') : 'Patient'}</div>
        </div>
        <div class="detail__finding" data-sev="${resolved ? '' : f.severity}">${esc(x.finding)}</div>
        <div class="detail__section" id="rationale-slot">${rationaleSection(f, x)}</div>
        <div class="detail__cols">
          ${x.actions.length ? `<div><div class="detail__label">Recommended action</div><ul>${x.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : '<div></div>'}
          ${x.monitoring.length ? `<div><div class="detail__label">Monitoring</div><ul>${x.monitoring.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
        </div>
        <div class="detail__actions">${actions}</div>
        ${form}
      </div>`;
  }

  // ------------------------------------------------------ AI explanations
  const aiKey = (f) => `${state.result.id}|${f.id}`;
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

  function patientSummary() {
    const p = readPatient();
    const prof = M.profile(p);
    const parts = [];
    if (Number.isFinite(p.age)) parts.push(`${n(p.age)}-year-old ${p.sex === 'M' ? 'male' : 'female'}`);
    if (Number.isFinite(p.weight)) parts.push(`${n(p.weight)} kg`);
    if (prof.renal) parts.push(`${prof.renal.label} ${prof.renal.value} ${prof.renal.unit}`);
    return parts.join(', ');
  }

  function rationaleSection(f, x) {
    const k = aiKey(f);
    const a = state.ai[k];
    if (a && a.status === 'done' && state.aiView[k] !== 'kb') {
      return `<div class="detail__label">Clinical rationale <span class="src src--ai">AI</span><span>${esc(a.model)} · ${secs(a.ms)} · figures checked against the knowledge base</span><button class="linkbtn" type="button" data-act="ai-toggle">Show knowledge-base text</button></div><p>${esc(a.text)}</p>`;
    }
    const st = AI.status.state;
    let note;
    if (a && a.status === 'done') note = '<button class="linkbtn" type="button" data-act="ai-toggle">Show AI explanation</button>';
    else if (a && a.status === 'pending') note = `<span class="ai-busy">AI explanation generating with ${esc(AI.status.model || 'model')}…</span>`;
    else if (a && a.status === 'rejected') note = `<span class="ai-warn">AI explanation discarded — ${esc(a.reason)}</span>`;
    else if (a && a.status === 'error') note = `<span class="ai-warn">AI explanation failed — ${esc(a.reason)}</span>`;
    else if (st === 'ready' && !state.stale) note = '<span class="ai-busy">AI explanation queued…</span>';
    else if (st === 'loading') note = '<span>AI model loading — knowledge-base text shown</span>';
    else note = '<span>AI model not connected — knowledge-base text shown</span>';
    return `<div class="detail__label">Clinical rationale <span class="src">Knowledge base</span>${note}</div><p>${esc(x.rationale)}</p>`;
  }

  function refreshRationale() {
    const slot = $('rationale-slot');
    if (!slot || !state.result || !state.result.findings.length) return;
    const i = Math.min(state.selected, state.result.findings.length - 1);
    slot.innerHTML = rationaleSection(state.result.findings[i], state.rationales[i]);
  }

  let aiBusy = false;
  /** Explain findings one at a time, the one on screen first. */
  async function pumpAI() {
    const r = state.result;
    if (aiBusy || AI.status.state !== 'ready' || !r || state.stale || !r.findings.length) return;
    const order = [state.selected, ...r.findings.map((_, i) => i)];
    const idx = order.find((i) => r.findings[i] && !state.ai[`${r.id}|${r.findings[i].id}`]);
    if (idx == null) return;
    const f = r.findings[idx];
    const x = state.rationales[idx];
    const k = `${r.id}|${f.id}`;
    state.ai[k] = { status: 'pending' };
    aiBusy = true;
    refreshRationale();
    try {
      const res = await AI.explain({ headline: x.headline, severity: f.severity, finding: x.finding, patient: patientSummary(), rationale: x.rationale, actions: x.actions });
      state.ai[k] = res.accepted
        ? { status: 'done', text: res.text, model: res.model, ms: res.latency_ms }
        : { status: 'rejected', reason: res.reason, model: res.model };
      if (res.accepted) logAudit({ ev: 'ai', detail: `AI rationale generated for ${f.rule} (${res.model}, ${secs(res.latency_ms)})` });
    } catch (e) {
      if (e.status === 503) delete state.ai[k]; // model not ready yet — retry later
      else state.ai[k] = { status: 'error', reason: e.message };
    }
    aiBusy = false;
    if (state.result === r) refreshRationale();
    pumpAI();
  }

  function renderAIStatus() {
    const st = AI.status.state;
    const el = $('sb-ai');
    el.dataset.state = st;
    el.querySelector('span').textContent = AI.label();
    $('nav-ai').textContent = st === 'ready' ? `AI: ${AI.status.model}` : `AI: ${st}`;
    refreshRationale();
    renderScreenContext();
  }

  function renderResult() {
    const r = state.result;
    $('result-ref').textContent = r ? `${r.id} · ${new Date(r.at).toLocaleTimeString('en-GB')}` : '—';
    let html = resultBar();
    if (r) {
      if (r.findings.length) {
        html += `<div class="grid-wrap"><table class="grid grid--checks">
          <thead><tr><th class="c-sev">Severity</th><th class="c-type">Check</th><th>Finding</th><th>Line</th><th>Rule</th><th>Status</th></tr></thead>
          <tbody>${r.findings
            .map((f, i) => {
              const x = state.rationales[i];
              const hard = f.severity === 'critical' && HARD_STOPS.has(f.type);
              return `<tr data-idx="${i}" tabindex="0" aria-selected="${i === state.selected}" data-resolved="${!!(state.overrides[f.id] || state.acknowledged[f.id])}">
                <td><span class="flag ${f.severity === 'critical' ? 'flag--crit' : 'flag--warn'}">${f.severity === 'critical' ? 'Critical' : 'Advisory'}</span></td>
                <td>${TYPE_LABEL[f.type] || f.type}</td>
                <td class="desc">${esc(x.headline)}${hard ? '<span class="hs">HARD STOP</span>' : ''}</td>
                <td class="num">${f.lines.length ? f.lines.join(' + ') : '—'}</td>
                <td class="rule">${f.rule}</td>
                <td>${statusFlag(f)}</td>
              </tr>`;
            })
            .join('')}</tbody></table></div>`;
        const idx = Math.min(state.selected, r.findings.length - 1);
        html += detailPane(r.findings[idx], state.rationales[idx]);
      }
      const passed = r.checks.filter((c) => c.result === 'pass').length;
      const RES = { pass: ['flag--ok', 'Pass'], fail: ['flag--crit', 'Fail'], advisory: ['flag--warn', 'Advisory'], 'n/a': ['flag--none', 'N/A'] };
      html += `<div class="checks-sum">
        <div class="subhead">Checks performed — ${passed} of ${r.checks.length} passed</div>
        <div class="grid-wrap"><table class="grid grid--sum"><tbody>
          ${r.checks.map((c) => `<tr><td><span class="flag ${RES[c.result][0]}">${RES[c.result][1]}</span></td><td>${esc(c.label)}</td><td class="muted">${esc(c.detail)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    }

    const canSign = r && !state.stale && !state.signed && unresolvedCritical().length === 0 && !hardStopOpen();
    const note = !r ? 'Verify the order to enable signing.'
      : state.signed ? `Signed and transmitted to the pharmacy queue · ${r.id}`
      : state.stale ? 'Re-verify the modified order to enable signing.'
      : hardStopOpen() ? 'Hard-stop findings must be corrected in the order.'
      : unresolvedCritical().length ? 'Resolve or override every critical finding to enable signing.'
      : 'Signing records your verification in the audit trail.';
    html += `<div class="signbar">
      <button class="tbtn tbtn--sign" id="btn-sign" type="button" ${canSign ? '' : 'disabled'}>${state.signed ? 'Order Signed' : 'Sign Order'}</button>
      <span class="signbar__note">${note}</span>
      ${r ? `<span class="signbar__prov">${esc(r.kbVersion)}</span>` : ''}
    </div>`;
    $('result').innerHTML = html;
  }

  // ------------------------------------------------------ result interactions
  $('result').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-idx]');
    if (row && !e.target.closest('button')) {
      selectFinding(Number(row.dataset.idx));
      return;
    }
    const b = e.target.closest('button');
    if (!b || !state.result) return;
    const f = state.result.findings[state.selected];

    if (b.id === 'btn-sign') {
      state.signed = true;
      logAudit({ ev: 'signed', detail: 'Order signed and transmitted to pharmacy queue' });
      setStatus(`Order signed · ${state.result.id}`, false);
      renderResult();
      toast(`Order signed · ${state.result.id} transmitted to pharmacy queue`);
      return;
    }
    switch (b.dataset.act) {
      case 'ai-toggle': {
        const k = aiKey(f);
        state.aiView[k] = state.aiView[k] === 'kb' ? 'ai' : 'kb';
        refreshRationale();
        break;
      }
      case 'apply': {
        const line = f.lines[0];
        $(`rx${line}-dose`).value = f.data.suggested;
        renderLine(line);
        logAudit({ ev: 'action', detail: `Line ${line} dose changed to ${n(f.data.suggested)} mg (${f.rule})` });
        runVerification({ animate: true });
        break;
      }
      case 'override-open':
        state.overrideOpen = true;
        renderResult();
        $('ov-note').focus();
        break;
      case 'override-cancel':
        state.overrideOpen = false;
        renderResult();
        break;
      case 'override-confirm': {
        const note = $('ov-note');
        if (note.value.trim().length < 5) {
          note.setCustomValidity('Enter a clinical justification (at least 5 characters).');
          note.reportValidity();
          note.addEventListener('input', () => note.setCustomValidity(''), { once: true });
          return;
        }
        state.overrides[f.id] = { reason: $('ov-reason').value, note: note.value.trim() };
        state.overrideOpen = false;
        logAudit({ ev: 'action', detail: `${f.rule} overridden — ${state.overrides[f.id].reason}: “${state.overrides[f.id].note}”` });
        const next = state.result.findings.findIndex((x) => x.severity === 'critical' && !state.overrides[x.id]);
        if (next >= 0) state.selected = next;
        renderAll();
        break;
      }
      case 'ack':
        state.acknowledged[f.id] = true;
        logAudit({ ev: 'action', detail: `${f.rule} acknowledged` });
        renderResult();
        break;
    }
  });
  $('result').addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-idx]');
    if (!row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFinding(Number(row.dataset.idx)); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const max = state.result.findings.length - 1;
      selectFinding(Math.max(0, Math.min(max, state.selected + (e.key === 'ArrowDown' ? 1 : -1))));
    }
  });
  function selectFinding(i) {
    state.selected = i;
    state.overrideOpen = false;
    renderResult();
    const row = document.querySelector(`#result tr[data-idx="${i}"]`);
    if (row) row.focus();
    pumpAI();
  }

  // ------------------------------------------------------------------ modal
  let lastFocus = null;
  function openModal() {
    const r = state.result;
    const crit = unresolvedCritical();
    const p = readPatient();
    $('modal-title').textContent = `Critical Order Check — ${crit.length} finding${crit.length > 1 ? 's' : ''}`;
    $('modal-ref').textContent = r.id;
    $('modal-desc').innerHTML = `The order for <b>${esc(p.name || 'this patient')}</b> (MRN ${esc(state.mrn)}) has been held. It cannot be signed until each critical finding is corrected or overridden with documented justification.`;
    $('modal-rows').innerHTML = crit
      .map((f) => {
        const x = state.rationales[r.findings.indexOf(f)];
        return `<tr><td><span class="flag flag--crit">Critical</span></td><td><b>${esc(x.headline)}</b><span class="mf">${esc(x.finding)}</span></td><td class="num">${f.lines.length ? f.lines.join(' + ') : '—'}</td></tr>`;
      })
      .join('');
    lastFocus = document.activeElement;
    $('modal').hidden = false;
    $('modal-review').focus();
  }
  function closeModal(mode) {
    $('modal').hidden = true;
    const crit = unresolvedCritical();
    if (mode === 'modify' && crit.length) {
      const f = crit[0];
      const line = f.lines[f.type === 'interaction' ? 1 : 0] || 1;
      const target = f.type === 'dose-peds' || f.type === 'dose-adult' ? $(`rx${line}-dose`) : f.type === 'data' ? $('pt-weight') : $(`rx${line}-drug`);
      target.focus();
      if (target.select) target.select();
    } else {
      $('panel-checks').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      const row = document.querySelector('#result tr[data-idx]');
      if (row) row.focus({ preventScroll: true });
      else if (lastFocus) lastFocus.focus();
    }
  }
  $('modal-review').addEventListener('click', () => closeModal('review'));
  $('modal-modify').addEventListener('click', () => closeModal('modify'));
  $('modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal('review');
    if (e.key === 'Tab') {
      const a = $('modal-modify'), b = $('modal-review');
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    }
  });

  // ------------------------------------------------------------------ audit
  function orderSummary() {
    return readOrders().map((o) => `${F.getDrug(o.drugId).name} ${Number.isFinite(o.dose) ? n(o.dose) : '?'} mg ${F.getFrequency(o.freqId).label.toLowerCase()}`).join('; ') || '—';
  }
  function logAudit({ ev, detail }) {
    state.audit.unshift({ at: new Date(), ref: state.result ? state.result.id : '—', patient: `${readPatient().name || 'Unidentified'} (${state.mrn})`, orders: orderSummary(), ev, detail });
    renderAudit();
  }
  function renderAudit() {
    const EV = { critical: 'Held', advisory: 'Verified — advisory', pass: 'Verified', signed: 'Signed', action: 'Pharmacist action', ai: 'AI rationale', screen: 'List screen' };
    $('audit-count').textContent = state.audit.length;
    $('audit-body').innerHTML = state.audit.length
      ? state.audit.map((a) => `<tr>
          <td class="num">${a.at.toLocaleTimeString('en-GB')}</td>
          <td class="num">${a.ref}</td>
          <td>${esc(a.patient)}</td>
          <td class="wrap">${esc(a.orders)}</td>
          <td><span class="ev ev--${a.ev}">${EV[a.ev]}</span></td>
          <td class="wrap">${esc(a.detail)}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="empty">No events recorded in this session.</td></tr>';
  }

  // --------------------------------------------------------- knowledge base
  function renderFormulary() {
    const integrity = F.integrityReport();
    $('kb-version').textContent = F.VERSION;
    $('kb-integrity').textContent = integrity.ok ? `${F.DRUGS.length} agents · integrity check passed` : `${integrity.issues.length} integrity issue(s)`;
    if (!integrity.ok) console.warn('Knowledge base integrity', integrity.issues);
    const q = $('kb-search').value.trim().toLowerCase();
    const rows = F.DRUGS.filter((d) => !q || [d.name, d.aka, d.cls, ...d.riskTags].join(' ').toLowerCase().includes(q));
    $('kb-body').innerHTML = rows.length
      ? rows.map((d) => `<tr>
          <td><span class="drug-name">${esc(d.name)}<small>${esc(d.aka)}</small></span></td>
          <td>${esc(d.cls)}</td>
          <td>${d.route}</td>
          <td class="r">${n(d.adultMaxDaily)}</td>
          <td class="r">${n(d.pedsMaxMgPerKgDay)}</td>
          <td>${d.minAgeYears != null ? `≥ ${fmtAge(d.minAgeYears)}` : '<span class="muted">—</span>'}</td>
          <td><div class="tags">${d.contraindicatedWith.length ? d.contraindicatedWith.map((id) => `<span class="tag tag--ddi">${esc(F.getDrug(id).name)}</span>`).join('') : '<span class="muted">None recorded</span>'}</div></td>
          <td><div class="tags">${d.riskTags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></td>
        </tr>`).join('')
      : `<tr><td colspan="8" class="empty">No agents match “${esc(q)}”.</td></tr>`;
  }

  function renderMatrix() {
    const ds = F.DRUGS;
    const short = (d) => esc(d.name.split(' ')[0]);
    let html = '<thead><tr><th></th>' + ds.map((d) => `<th scope="col">${short(d)}</th>`).join('') + '</tr></thead><tbody>';
    ds.forEach((a) => {
      html += `<tr><th scope="row">${short(a)}</th>`;
      ds.forEach((b) => {
        if (a.id === b.id) { html += '<td class="self"></td>'; return; }
        const m = F.getMonograph(a.id, b.id);
        if (!m) { html += '<td></td>'; return; }
        const key = F.pairKey(a.id, b.id);
        html += `<td><button type="button" data-pair="${key}" data-sev="${m.severity}" aria-pressed="${key === state.selectedPair}" aria-label="${esc(a.name)} with ${esc(b.name)}: ${m.severity}">${m.severity === 'Contraindicated' ? 'C' : 'M'}</button></td>`;
      });
      html += '</tr>';
    });
    $('matrix').innerHTML = html + '</tbody>';
    renderMonograph();
  }
  function renderMonograph() {
    const [a, b] = state.selectedPair.split('|').map(F.getDrug);
    const m = F.getMonograph(a.id, b.id);
    $('monograph').innerHTML = `
      <div class="mono-h">${esc(a.name)} + ${esc(b.name)}</div>
      <dl class="mono-dl">
        <dt>Severity</dt><dd><span class="flag flag--crit">${m.severity}</span></dd>
        <dt>Type</dt><dd>${m.kind}</dd>
        <dt>Mechanism</dt><dd>${esc(m.mechanism)}</dd>
        <dt>Consequence</dt><dd>${esc(m.effect)}</dd>
        <dt>Management</dt><dd>${esc(m.management)}</dd>
      </dl>`;
  }
  $('matrix').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pair]');
    if (!b) return;
    state.selectedPair = b.dataset.pair;
    document.querySelectorAll('#matrix button[data-pair]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.pair === state.selectedPair)));
    renderMonograph();
  });
  $('kb-search').addEventListener('input', renderFormulary);

  // ----------------------------------------------------- interaction screen
  const VIA = { generic: 'Generic name', alias: 'Alternative name', brand: 'Brand', combination: 'Combination product' };

  function renderScreenContext() {
    const el = $('scr-context');
    if (!el) return;
    const ps = patientSummary();
    el.textContent = `Patient context: ${ps || 'not recorded'} · ${AI.label()}`;
  }

  async function runScreen({ withAI = true } = {}) {
    const entries = S.parseList($('scr-input').value).slice(0, 12);
    if (!entries.length) {
      $('scr-results').innerHTML = '<section class="panel"><div class="empty">Enter at least one medication to screen.</div></section>';
      return;
    }
    const det = S.screen(entries);
    const run = { entries, det, ai: null };
    state.screen = run;

    if (!det.unknown.length) run.ai = { status: 'skipped' };
    else if (!withAI) run.ai = { status: 'idle' };
    else if (AI.status.state !== 'ready') run.ai = { status: 'offline' };
    else run.ai = { status: 'pending' };
    renderScreen();

    if (withAI) logAudit({ ev: 'screen', detail: `${entries.length} entries · ${det.findings.length} knowledge-base finding(s) · ${det.unknown.length} not in knowledge base` });

    if (run.ai.status !== 'pending') return;
    const btn = $('scr-run');
    btn.disabled = true;
    try {
      const verified = det.known.map((r) => `${r.entry} → ${r.ids.map((id) => F.getDrug(id).name).join(' + ')}`);
      const res = await AI.check({ medications: entries, focus: det.unknown, verified, patient: patientSummary() });
      run.ai = { status: 'done', lines: res.lines, model: res.model, ms: res.latency_ms };
    } catch (e) {
      run.ai = { status: 'error', reason: e.message };
    }
    btn.disabled = false;
    if (state.screen === run) renderScreen();
  }

  function renderScreen() {
    const run = state.screen;
    if (!run) return;
    const { det, ai } = run;

    const resolution = `<section class="panel">
      <header class="panel__head"><h2>Knowledge Base Resolution</h2><span class="panel__meta">${det.known.length} of ${det.resolved.length} entries recognised</span></header>
      <div class="grid-wrap"><table class="grid"><thead><tr><th>Entry</th><th>Active ingredient(s)</th><th>Matched by</th></tr></thead><tbody>
        ${det.resolved.map((r) => `<tr><td><b>${esc(r.entry)}</b></td><td>${r.ids.length ? r.ids.map((id) => esc(F.getDrug(id).name)).join(' + ') : '<span class="muted">—</span>'}</td><td>${r.ids.length ? `<span class="flag flag--ok">${VIA[r.via]}</span>` : '<span class="flag flag--warn">Not in knowledge base</span>'}</td></tr>`).join('')}
      </tbody></table></div></section>`;

    const verified = `<section class="panel">
      <header class="panel__head"><h2>Verified Findings — Knowledge Base</h2><span class="panel__meta">Deterministic · ${esc(F.VERSION)}</span></header>
      ${det.findings.length
        ? `<div class="grid-wrap"><table class="grid"><thead><tr><th>Severity</th><th>Finding</th><th>Entries</th><th>Management</th></tr></thead><tbody>
          ${det.findings.map((f) => f.type === 'duplicate'
            ? `<tr><td><span class="flag flag--crit">Critical</span></td><td><b>Duplicate active ingredient: ${esc(f.drug.name)}</b></td><td>${f.entries.map(esc).join(', ')}</td><td>Count every source toward one daily maximum (adult ${n(f.drug.adultMaxDaily)} mg/day); consolidate to a single product.</td></tr>`
            : `<tr><td><span class="flag flag--crit">${esc(f.mono.severity)}</span></td><td><b>${esc(f.a.name)} + ${esc(f.b.name)}</b><span class="cell-sub">${esc(f.mono.kind)} — ${esc(f.mono.effect)}</span></td><td>${f.entries.map(esc).join(', ')}</td><td>${esc(f.mono.management)}</td></tr>`
          ).join('')}
        </tbody></table></div>`
        : `<div class="resbar" data-s="pass">${ICON.check}<span>No severe interactions or duplicate ingredients among knowledge-base agents</span></div>`}
    </section>`;

    let body;
    const unknownList = det.unknown.map(esc).join(', ');
    switch (ai.status) {
      case 'skipped': body = '<div class="empty">Every entry was resolved against the knowledge base — an AI screen is not required.</div>'; break;
      case 'idle': body = `<div class="empty">${det.unknown.length} entr${det.unknown.length > 1 ? 'ies are' : 'y is'} not in the knowledge base (${unknownList}). Select <b>Screen Interactions</b> to run the AI screen.</div>`; break;
      case 'offline': body = `<div class="empty">AI model not available — ${unknownList} could not be screened. Start the backend with <code>python server/app.py</code> and open the app from http://localhost:8000.</div>`; break;
      case 'pending': body = `<div class="empty"><span class="ai-busy">Screening ${unknownList} with ${esc(AI.status.model || 'the local model')}… this can take up to a minute on a laptop CPU.</span></div>`; break;
      case 'error': body = `<div class="empty">AI screen failed — ${esc(ai.reason)}</div>`; break;
      default:
        body = `<ul class="ai-lines">${ai.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><div class="ai-foot">${esc(ai.model)} · ${secs(ai.ms)} · screened: ${unknownList}</div>`;
    }
    const aiPanel = `<section class="panel panel--ai">
      <header class="panel__head"><h2>AI Screen — Not Verified</h2><span class="panel__meta">Agents outside the knowledge base</span></header>
      <div class="ai-banner">AI-generated. Not verified against the knowledge base — confirm with a pharmacist before acting.</div>
      ${body}
    </section>`;

    $('scr-results').innerHTML = `<div class="screen-grid">${resolution}${verified}</div>${aiPanel}`;
  }

  $('scr-run').addEventListener('click', () => runScreen({ withAI: true }));
  $('scr-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runScreen({ withAI: true });
  });

  // ------------------------------------------------------------- navigation
  function showView(view) {
    ['verify', 'screen', 'formulary', 'audit'].forEach((v) => {
      $(`view-${v}`).hidden = v !== view;
      const item = $(`nav-${v}`);
      if (v === view) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    try { history.replaceState(null, '', view === 'verify' ? location.pathname : `#${view}`); } catch (_) { /* sandboxed frame */ }
  }
  document.querySelectorAll('.sidenav__item').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  // --------------------------------------------------------------- scenarios
  function loadScenario(id) {
    const s = SCENARIOS.find((x) => x.id === id) || SCENARIOS[0];
    const p = s.patient;
    state.mrn = p.mrn;
    state.loc = p.loc;
    $('pt-name').value = p.name;
    $('pt-age').value = p.age;
    $('pt-sex').value = p.sex;
    $('pt-weight').value = p.weight;
    $('pt-height').value = p.height;
    $('pt-scr').value = p.scr ?? '';
    s.lines.forEach((l, i) => {
      const k = i + 1;
      $(`rx${k}-drug`).value = l.drugId;
      $(`rx${k}-dose`).value = l.dose;
      $(`rx${k}-freq`).value = l.freqId;
      if (k === 2) $('rx2-enabled').checked = l.enabled;
    });
    renderBanner();
    renderMetrics();
    renderLine(1);
    renderLine(2);
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function tickClock() {
    const d = new Date();
    $('clock').textContent = `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // -------------------------------------------------------------------- boot
  function boot() {
    buildOrderRows();
    $('scenario').innerHTML = SCENARIOS.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
    $('scenario').addEventListener('change', (e) => {
      loadScenario(e.target.value);
      runVerification({ animate: true });
    });

    ['pt-name', 'pt-age', 'pt-sex', 'pt-weight', 'pt-height', 'pt-scr'].forEach((id) =>
      $(id).addEventListener('input', () => {
        renderBanner();
        renderMetrics();
        renderLine(1);
        renderLine(2);
        renderScreenContext();
        if (id !== 'pt-name') markStale();
      })
    );
    [1, 2].forEach((i) => [`rx${i}-drug`, `rx${i}-dose`, `rx${i}-freq`].forEach((id) => $(id).addEventListener('input', () => { renderLine(i); markStale(); })));
    $('rx2-enabled').addEventListener('change', () => { renderLine(2); markStale(); });

    $('btn-verify').addEventListener('click', () => runVerification({ animate: true }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F9' && $('modal').hidden) { e.preventDefault(); runVerification({ animate: true }); }
    });
    $('btn-clear').addEventListener('click', () => {
      [1, 2].forEach((i) => {
        $(`rx${i}-drug`).value = '';
        $(`rx${i}-dose`).value = '';
        $(`rx${i}-freq`).value = 'daily';
      });
      $('rx2-enabled').checked = true;
      renderLine(1);
      renderLine(2);
      Object.assign(state, { result: null, rationales: [], stale: false, signed: false, overrideOpen: false });
      setStatus('Orders cleared', false);
      renderAll();
    });

    const kb = `Knowledge base ${F.VERSION}`;
    $('sb-kb').textContent = kb;
    $('nav-kb').textContent = F.VERSION;
    renderFormulary();
    renderMatrix();
    renderAudit();
    tickClock();
    setInterval(tickClock, 15000);

    const hash = (location.hash || '').slice(1);
    showView(['screen', 'formulary', 'audit'].includes(hash) ? hash : 'verify');

    loadScenario(SCENARIOS[0].id);
    runVerification({ animate: false, interrupt: false });

    $('scr-input').value = 'Dolo 650, Combiflam, Warf 5, Brufen 400, Pan 40';
    runScreen({ withAI: false });

    AI.onChange(() => { renderAIStatus(); pumpAI(); });
    renderAIStatus();
    AI.start();
  }

  boot();
})();
