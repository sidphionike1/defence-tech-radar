// App state, polling, render loop and the inspector panel.
(function () {
  'use strict';

  const POLL_MS = 1500;
  const SNR_SCALE_MAX = 40;
  const SNR_THRESHOLD = 10;
  const CLASSES = ['drone', 'bird', 'plane', 'vehicle', 'clutter'];

  const $ = (id) => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const state = {
    baselineDetections: [],
    fusedDetections: [],
    fusedById: new Map(),
    baselineById: new Map(),
    signature: '',
    selectedId: null,
    reports: new Map(), // id -> { text, fallback } | { error }
    inflightId: null,
  };

  const scopes = {
    baseline: new RadarScope($('scope-baseline'), 'baseline'),
    fused: new RadarScope($('scope-fused'), 'fused'),
  };
  const inspector = $('inspector');

  // ---------- formatting ----------
  const pad2 = (id) => String(id).padStart(2, '0');
  const tag = (id) => `T-${pad2(id)}`;
  const bearing = (deg) => `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
  const km = (m) => `${(m / 1000).toFixed(2)} km`;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const safeClass = (c) => (CLASSES.includes(c) ? c : 'clutter');

  function shapeSvg(cls) {
    const c = `var(--c-${safeClass(cls)})`;
    const shapes = {
      drone: `<path d="M8 2 14.5 13.5h-13z" fill="${c}"/>`,
      bird: `<path d="M8 1.5 13 8 8 14.5 3 8z" fill="${c}"/>`,
      plane: `<circle cx="8" cy="8" r="5.5" fill="${c}"/>`,
      vehicle: `<rect x="3" y="3" width="10" height="10" fill="${c}"/>`,
      clutter: `<path d="m3.5 3.5 9 9m0-9-9 9" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`,
    };
    return `<svg class="shape" viewBox="0 0 16 16" aria-hidden="true">${shapes[safeClass(cls)]}</svg>`;
  }

  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

  // ---------- data ----------
  async function poll() {
    try {
      const [baseline, fused] = await Promise.all([API.getBaseline(), API.getFused()]);
      applyData(baseline, fused);
      setLink(true);
    } catch (err) {
      console.warn('poll failed', err);
      setLink(false);
    } finally {
      setTimeout(poll, POLL_MS);
    }
  }

  function applyData(baseline, fused) {
    const signature = JSON.stringify([baseline, fused]);
    if (signature === state.signature) return;
    state.signature = signature;

    state.baselineDetections = baseline;
    state.fusedDetections = fused;
    state.baselineById = new Map(baseline.map((d) => [d.id, d]));
    state.fusedById = new Map(fused.map((d) => [d.id, d]));

    const now = totalDeg(performance.now());
    scopes.baseline.setData(baseline, now);
    scopes.fused.setData(fused, now);

    $('stat-baseline').textContent = baseline.filter((d) => d.detected).length;
    $('stat-fused').textContent = fused.filter((d) => d.fused_detected).length;
    $('stat-recovered').textContent =
      '+' + fused.filter((d) => d.fused_detected && !d.baseline_detected).length;

    if (state.selectedId != null && !recordFor(state.selectedId)) state.selectedId = null;
    syncSelection();
    renderInspector(false);
  }

  function setLink(ok) {
    const pill = $('source-pill');
    if (!ok) {
      pill.dataset.state = 'lost';
      pill.textContent = 'Link lost · retrying';
      return;
    }
    pill.dataset.state = API_SOURCE === 'mock' ? 'mock' : 'live';
    pill.textContent = API_SOURCE === 'mock' ? 'Mock data' : `Live · ${API_SOURCE.replace(/^https?:\/\//, '')}`;
    $('sync').textContent = 'SYNC ' + new Date().toLocaleTimeString([], { hour12: false });
  }

  // Fused record preferred (it has classification); baseline as fallback.
  const recordFor = (id) => state.fusedById.get(id) || state.baselineById.get(id) || null;

  // ---------- render loop ----------
  const t0 = performance.now();
  const totalDeg = (now) => ((now - t0) / RadarScope.SWEEP_PERIOD_MS) * 360;

  function frame(now) {
    const deg = totalDeg(now);
    scopes.baseline.draw(deg, now, reducedMotion.matches);
    scopes.fused.draw(deg, now, reducedMotion.matches);
    requestAnimationFrame(frame);
  }

  const onResize = () => { scopes.baseline.resize(); scopes.fused.resize(); };
  new ResizeObserver(onResize).observe(document.querySelector('.layout'));
  window.addEventListener('resize', onResize);

  // ---------- selection ----------
  function select(id, { focus = false } = {}) {
    state.selectedId = id;
    syncSelection();
    renderInspector(focus);
  }

  function syncSelection() {
    const rec = state.selectedId != null ? recordFor(state.selectedId) : null;
    scopes.baseline.setSelected(rec);
    scopes.fused.setSelected(rec);
  }

  for (const scope of Object.values(scopes)) {
    scope.canvas.addEventListener('click', (e) => {
      const id = scope.hitTest(e.clientX, e.clientY);
      if (id != null) select(id);
    });
    scope.canvas.addEventListener('mousemove', (e) => {
      const id = scope.hitTest(e.clientX, e.clientY);
      scope.hoverId = id;
      scope.canvas.classList.toggle('is-hovering', id != null);
    });
    scope.canvas.addEventListener('mouseleave', () => {
      scope.hoverId = null;
      scope.canvas.classList.remove('is-hovering');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedId != null) select(null, { focus: true });
  });

  inspector.addEventListener('click', (e) => {
    const contact = e.target.closest('[data-contact]');
    if (contact) return select(Number(contact.dataset.contact), { focus: true });
    if (e.target.closest('[data-back]')) return select(null, { focus: true });
    if (e.target.closest('[data-explain]')) explain();
  });

  // ---------- inspector ----------
  let renderedId; // which view is currently in the DOM

  function renderInspector(focus) {
    const id = state.selectedId;
    if (id == null) {
      if (renderedId !== null || focus || !inspector.firstChild) renderContacts(focus);
      else refreshContacts();
      renderedId = null;
      return;
    }
    renderDetail(recordFor(id), focus);
    renderedId = id;
  }

  function contactRows(list) {
    return list.map((d) => {
      const fused = state.fusedById.get(d.id);
      const cls = fused ? fused.predicted_class : null;
      let tagHtml = '<span class="tag tag--both">Both</span>';
      if (fused && fused.fused_detected && !fused.baseline_detected) {
        tagHtml = '<span class="tag tag--recovered">Recovered</span>';
      } else if (!fused || !fused.fused_detected) {
        tagHtml = '<span class="tag tag--conv">Conv. only</span>';
      }
      return `<li><button class="contact" type="button" data-contact="${Number(d.id)}">
        ${cls ? shapeSvg(cls) : '<span></span>'}
        <span class="contact-id">${tag(d.id)}</span>
        <span class="contact-meta"><b>${cls ? safeClass(cls) : 'unclassified'}</b> · ${bearing(d.azimuth_deg)} · ${(d.range_m / 1000).toFixed(1)} km</span>
        ${tagHtml}
      </button></li>`;
    }).join('');
  }

  function contactLists() {
    const fused = state.fusedDetections.filter((d) => d.fused_detected);
    const recovered = fused.filter((d) => !d.baseline_detected);
    const both = fused.filter((d) => d.baseline_detected);
    const convOnly = state.baselineDetections.filter(
      (d) => d.detected && !(state.fusedById.get(d.id) || {}).fused_detected
    );
    let html = '';
    if (recovered.length) html += `<p class="list-divider">Recovered by fusion (${recovered.length})</p><ul class="contacts">${contactRows(recovered)}</ul>`;
    if (both.length) html += `<p class="list-divider">Seen by both (${both.length})</p><ul class="contacts">${contactRows(both)}</ul>`;
    if (convOnly.length) html += `<p class="list-divider">Conventional only (${convOnly.length})</p><ul class="contacts">${contactRows(convOnly)}</ul>`;
    return html || '<p class="report-hint">Waiting for detections…</p>';
  }

  function renderContacts(focus) {
    inspector.innerHTML = `
      <div class="inspector-head">
        <h2 tabindex="-1" id="inspector-title">Contacts</h2>
        <p>Click a blip on either scope, or pick a contact.</p>
      </div>
      <div class="inspector-body" id="contacts-body">${contactLists()}</div>`;
    if (focus) $('inspector-title').focus({ preventScroll: true });
  }

  function refreshContacts() {
    const body = $('contacts-body');
    if (body) body.innerHTML = contactLists();
  }

  function snrRow(label, value) {
    const pct = clamp01(value / SNR_SCALE_MAX) * 100;
    const below = value <= SNR_THRESHOLD;
    return `<div class="bar-row">
      <span class="label">${label}</span>
      <span class="track"><span class="fill ${below ? 'fill--below' : ''}" style="width:${pct}%"></span>
        <span class="threshold" style="left:${(SNR_THRESHOLD / SNR_SCALE_MAX) * 100}%"></span></span>
      <span class="value">${value.toFixed(1)} dB</span>
    </div>`;
  }

  function scoreRow(label, value) {
    return `<div class="bar-row">
      <span class="label">${label}</span>
      <span class="track"><span class="fill fill--score" style="width:${clamp01(value) * 100}%"></span></span>
      <span class="value">${value.toFixed(2)}</span>
    </div>`;
  }

  function verdict(label, hit) {
    return `<div class="verdict verdict--${hit ? 'hit' : 'miss'}">
      <span>${label}</span>
      <strong>${icon(hit ? 'check' : 'x')}${hit ? 'Detected' : 'Missed'}</strong>
    </div>`;
  }

  function renderDetail(d, focus) {
    const fused = state.fusedById.get(d.id);
    const baseline = state.baselineById.get(d.id);
    const baseHit = baseline ? baseline.detected : fused.baseline_detected;
    const cls = fused ? safeClass(fused.predicted_class) : null;
    const dop = d.doppler_velocity;

    inspector.innerHTML = `
      <div class="inspector-body">
        <button class="back" type="button" data-back>${icon('back')}All contacts</button>
        <div class="detail-title">
          <h2 tabindex="-1" id="inspector-title">${tag(d.id)}</h2>
          ${cls ? `<span class="class-chip" style="color:var(--c-${cls})">${shapeSvg(cls)}${cls}</span>` : ''}
        </div>

        <div class="verdicts">
          ${verdict('Conventional', baseHit)}
          ${verdict('Fusion + ML', fused ? fused.fused_detected : false)}
        </div>

        <section class="block">
          <h3>Sensor returns (SNR)</h3>
          <div class="bars">
            ${snrRow('Primary', d.snr_db)}
            ${fused ? snrRow('Sensor 2', fused.sensor_2_snr_db) : ''}
            ${fused ? snrRow('Sensor 3', fused.sensor_3_snr_db) : ''}
          </div>
          <p class="threshold-note"><i></i>Conventional threshold · ${SNR_THRESHOLD} dB</p>
        </section>

        ${fused ? `<section class="block">
          <h3>ML scores</h3>
          <div class="bars">
            ${scoreRow('Fusion conf.', fused.fusion_confidence)}
            ${scoreRow('Anomaly', fused.anomaly_score)}
          </div>
        </section>` : ''}

        <section class="block">
          <h3>Kinematics</h3>
          <dl class="kv">
            <div><dt>Bearing</dt><dd>${bearing(d.azimuth_deg)}</dd></div>
            <div><dt>Range</dt><dd>${km(d.range_m)}</dd></div>
            <div><dt>Doppler</dt><dd>${dop > 0 ? '+' : ''}${dop.toFixed(1)} <small>m/s ${dop < 0 ? 'closing' : 'opening'}</small></dd></div>
            <div><dt>RCS</dt><dd>${d.rcs} <small>m²</small></dd></div>
          </dl>
        </section>

        <button class="explain" type="button" data-explain id="explain-btn"></button>
        <div class="report" id="report" aria-live="polite"></div>

        <p class="truth">Ground truth (sim): ${safeClass(d.true_label)}</p>
      </div>`;
    updateExplainUI();
    if (focus) $('inspector-title').focus({ preventScroll: true });
  }

  function updateExplainUI() {
    const btn = $('explain-btn');
    const box = $('report');
    if (!btn || !box) return;
    const id = state.selectedId;
    const fused = state.fusedById.get(id);
    const report = state.reports.get(id);
    const busy = state.inflightId != null;

    btn.disabled = busy || !fused;
    btn.classList.toggle('is-secondary', !!(report && report.text));
    btn.innerHTML = icon('report') + (
      !fused ? 'No classification'
        : state.inflightId === id ? 'Generating…'
        : busy ? `Busy · ${tag(state.inflightId)}`
        : report && report.text ? 'Regenerate report'
        : 'Explain'
    );

    box.classList.remove('is-ready');
    box.replaceChildren();
    if (state.inflightId === id) {
      box.innerHTML = '<span class="loading"><span class="spinner"></span>Generating situation report…</span>';
    } else if (report && report.text) {
      box.classList.add('is-ready');
      const label = document.createElement('span');
      label.className = 'report-label';
      label.textContent = `Sitrep · ${tag(id)}`;
      const text = document.createElement('span');
      text.textContent = report.text;
      box.append(label, text);
      if (report.fallback) {
        const note = document.createElement('span');
        note.className = 'report-note';
        note.textContent = 'Pre-written report (live explain unavailable)';
        box.append(note);
      }
    } else if (report && report.error) {
      const msg = document.createElement('span');
      msg.className = 'report-hint';
      msg.textContent = report.error;
      box.append(msg);
    } else {
      box.innerHTML = '<span class="report-hint">Generate a plain-English situation report for this contact.</span>';
    }
  }

  async function explain() {
    const d = state.fusedById.get(state.selectedId);
    if (!d || state.inflightId != null) return;
    state.inflightId = d.id;
    updateExplainUI();
    try {
      const res = await API.explain({
        id: d.id,
        class: d.predicted_class,
        anomaly_score: d.anomaly_score,
        rcs: d.rcs,
        snr_db: d.snr_db,
      });
      state.reports.set(d.id, { text: res.report, fallback: res.fallback === true });
    } catch (err) {
      state.reports.set(d.id, {
        error: err.status === 404
          ? 'This contact is no longer in the detection set.'
          : 'Report link unavailable. Try again.',
      });
    } finally {
      state.inflightId = null;
      updateExplainUI();
    }
  }

  // ---------- legend + boot ----------
  $('legend-classes').innerHTML = CLASSES
    .map((c) => `<li>${shapeSvg(c)}<span style="text-transform:capitalize">${c}</span></li>`)
    .join('');

  renderInspector(false);
  requestAnimationFrame(frame);
  poll();
})();
