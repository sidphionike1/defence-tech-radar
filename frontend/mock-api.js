// Mock backend — mirrors the LOCKED contract in frontend/CLAUDE.md exactly
// (same endpoints, field names, types, error shapes). Seeded, so every
// rehearsal sees the same targets. Swap to the real backend in api.js.
(function () {
  'use strict';

  // --- seeded RNG (mulberry32, seed 42) -------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(42);
  const uni = (lo, hi) => lo + (hi - lo) * rand();
  const gauss = (mean, sd) =>
    mean + sd * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const round = (v, dp) => Number(v.toFixed(dp));

  // Same geometry the backend uses: absolute 600x600 canvas pixels,
  // top-left origin, centre at (300, 300), y down.
  const CENTER = 300;
  const PX_PER_M = 280 / 8000;
  const BASELINE_SNR_THRESHOLD = 10;
  const FUSION_THRESHOLD = 0.7;

  // Class profiles from backend/CLAUDE.md "Data generation rules".
  const PROFILES = {
    plane:   { n: 9, rcs: [20, 50],     snr: [25, 40], doppler: () => (rand() < 0.5 ? -1 : 1) * uni(150, 290) },
    vehicle: { n: 7, rcs: [5, 15],      snr: [18, 30], doppler: () => uni(-15, 15) },
    bird:    { n: 9, rcs: [0.01, 0.05], snr: [10, 20], doppler: () => uni(-25, 25) },
    drone:   { n: 7, rcs: [0.05, 0.5],  snr: [12, 22], doppler: () => uni(-40, 40) },
    clutter: { n: 8, rcs: [0.5, 5],     snr: [5, 15],  doppler: () => uni(-5, 5) },
  };

  const clipSnr = (v) => Math.max(1, v);

  function makeTarget(label, p) {
    const snr = uni(p.snr[0], p.snr[1]);
    return {
      true_label: label,
      range_m: uni(800, 7800),
      azimuth_deg: uni(0, 360),
      doppler_velocity: p.doppler(),
      rcs: uni(p.rcs[0], p.rcs[1]),
      snr_db: snr,
      sensor_2_snr_db: clipSnr(snr + gauss(0, 2)),
      sensor_3_snr_db: clipSnr(snr + gauss(0, 2)),
      stealth: false,
    };
  }

  // Low-observable injection: primary SNR at the noise floor, secondary
  // receivers see it (angle-dependent RCS).
  // Fixed slots keep recovered contacts spread around the scope.
  const STEALTH_SLOTS = [[118, 5200], [164, 2600], [212, 6100], [258, 4300], [305, 3500], [342, 5600]];

  function makeStealth([azimuth, range]) {
    const label = rand() < 0.7 ? 'drone' : 'plane';
    return {
      true_label: label,
      range_m: range + uni(-300, 300),
      azimuth_deg: azimuth + uni(-6, 6),
      doppler_velocity: label === 'plane' ? (rand() < 0.5 ? -1 : 1) * uni(150, 260) : uni(-40, 40),
      rcs: uni(0.01, 0.3),
      snr_db: uni(2, 8),
      sensor_2_snr_db: uni(10, 18),
      sensor_3_snr_db: uni(10, 18),
      stealth: true,
    };
  }

  // Hero target — the contract's example record, so the key demo moment
  // (bearing 046, revealed ~0.5s into the first sweep) always exists.
  const HERO = {
    true_label: 'drone', range_m: 3100.2, azimuth_deg: 45.9, doppler_velocity: 12.4,
    rcs: 0.12, snr_db: 4.5, sensor_2_snr_db: 13.2, sensor_3_snr_db: 11.8,
    stealth: true, hero: true,
  };

  const targets = [];
  for (const [label, p] of Object.entries(PROFILES)) {
    for (let i = 0; i < p.n; i++) targets.push(makeTarget(label, p));
  }
  for (const slot of STEALTH_SLOTS) targets.push(makeStealth(slot));
  targets.push(HERO);

  // Seeded shuffle, then pin the hero to id 7 like the contract example.
  for (let i = targets.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [targets[i], targets[j]] = [targets[j], targets[i]];
  }
  const heroIdx = targets.indexOf(HERO);
  [targets[6], targets[heroIdx]] = [targets[heroIdx], targets[6]];

  // --- scoring (stand-in for RF / IsolationForest / fusion) ----------------
  const sensorP = (snr) => 1 / (1 + Math.exp(-(snr - 11) / 1.5));
  const fusion = (t) =>
    1 - (1 - sensorP(t.snr_db)) * (1 - sensorP(t.sensor_2_snr_db)) * (1 - sensorP(t.sensor_3_snr_db));

  const rawAnomaly = targets.map((t) =>
    Math.abs(t.snr_db - (t.sensor_2_snr_db + t.sensor_3_snr_db) / 2) / 6 +
    Math.abs(Math.log10(t.rcs) + 0.5) / 3 +
    uni(0, 0.15)
  );
  const aMin = Math.min(...rawAnomaly);
  const aMax = Math.max(...rawAnomaly);

  function predictClass(t) {
    // Bird/drone overlap is intentional in the data; mimic RF confusion.
    if (t.hero) return 'drone';
    if ((t.true_label === 'bird' || t.true_label === 'drone') && rand() < 0.15) {
      return t.true_label === 'bird' ? 'drone' : 'bird';
    }
    return t.true_label;
  }

  const FUSED = targets.map((t, i) => {
    const r = t.range_m * PX_PER_M;
    const az = (t.azimuth_deg * Math.PI) / 180;
    const fusionConfidence = t.hero ? 0.74 : fusion(t);
    const anomaly = t.hero ? 0.81 : (rawAnomaly[i] - aMin) / (aMax - aMin);
    return {
      id: i + 1,
      range_m: round(t.range_m, 1),
      azimuth_deg: round(t.azimuth_deg, 1),
      doppler_velocity: round(t.doppler_velocity, 1),
      rcs: round(t.rcs, 3),
      snr_db: round(t.snr_db, 1),
      sensor_2_snr_db: round(t.sensor_2_snr_db, 1),
      sensor_3_snr_db: round(t.sensor_3_snr_db, 1),
      x: round(CENTER + r * Math.sin(az), 1),
      y: round(CENTER - r * Math.cos(az), 1),
      true_label: t.true_label,
      predicted_class: predictClass(t),
      anomaly_score: round(anomaly, 2),
      fusion_confidence: round(fusionConfidence, 2),
      fused_detected: fusionConfidence > FUSION_THRESHOLD,
      baseline_detected: t.snr_db > BASELINE_SNR_THRESHOLD,
    };
  });

  const BASELINE = FUSED.map((d) => ({
    id: d.id, range_m: d.range_m, azimuth_deg: d.azimuth_deg,
    doppler_velocity: d.doppler_velocity, rcs: d.rcs, snr_db: d.snr_db,
    x: d.x, y: d.y, true_label: d.true_label, detected: d.baseline_detected,
  }));

  // Same guarantee as the backend's mandatory startup assertion.
  if (!FUSED.some((d) => d.snr_db < 10 && d.fused_detected && !d.baseline_detected)) {
    throw new Error('mock: no stealth target caught by fusion but missed by baseline');
  }

  // --- explain report -------------------------------------------------------
  function buildReport(d, body) {
    const bearing = String(Math.round(d.azimuth_deg) % 360).padStart(3, '0');
    const km = (d.range_m / 1000).toFixed(1);
    const speed = Math.abs(d.doppler_velocity).toFixed(0);
    const motion = d.doppler_velocity < 0 ? `closing at ${speed} m/s` : `opening at ${speed} m/s`;
    const cls = String(body.class).toUpperCase();
    if (body.snr_db <= BASELINE_SNR_THRESHOLD) {
      return `Low-observable contact classified as ${cls} at bearing ${bearing}, range ${km} km, ${motion}. ` +
        `Primary return (${body.snr_db} dB, RCS ${body.rcs} m²) sits below the conventional threshold; ` +
        `track held via fused secondary receivers with anomaly score ${body.anomaly_score}. Recommend operator visual confirmation.`;
    }
    const flag = body.anomaly_score >= 0.6
      ? `Signature flagged as statistically unusual (anomaly ${body.anomaly_score}); monitor for profile change.`
      : 'Signature consistent with class profile; no anomaly indicated. Continue routine tracking.';
    return `${cls} contact at bearing ${bearing}, range ${km} km, ${motion}. ` +
      `Solid return at ${body.snr_db} dB, RCS ${body.rcs} m². ${flag}`;
  }

  // --- network simulation ---------------------------------------------------
  const delay = (lo, hi) => new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  window.MockAPI = {
    async getBaseline() {
      await delay(40, 140);
      return clone(BASELINE);
    },
    async getFused() {
      await delay(40, 140);
      return clone(FUSED);
    },
    async explain(body) {
      await delay(900, 1600);
      const d = FUSED.find((t) => t.id === body.id);
      if (!d) {
        const err = new Error('detection not found');
        err.status = 404;
        throw err;
      }
      return { report: buildReport(d, body) };
    },
  };
})();
