// Radar scope renderer: one instance per canvas. Draws in a fixed 600x600
// logical space (the contract's coordinate space) scaled to the element size.
(function () {
  'use strict';

  const SIZE = 600;
  const C = SIZE / 2;
  const FACE_R = 290;
  const PX_PER_M = 280 / 8000; // ring labels only; blip positions come from x/y
  const SWEEP_PERIOD_MS = 4000;
  const TRAIL_DEG = 55;
  const HIT_RADIUS = 18;

  const GREEN = '67, 255, 154';
  const BASELINE_COLOR = '#43ff9a';
  const CLASS_STYLE = {
    drone:   { color: '#ff5577', shape: 'triangle' },
    bird:    { color: '#ffd23f', shape: 'diamond' },
    plane:   { color: '#4dabf7', shape: 'circle' },
    vehicle: { color: '#c19bff', shape: 'square' },
    clutter: { color: '#8d9b95', shape: 'cross' },
  };
  const FALLBACK_STYLE = { color: '#e6f2ec', shape: 'circle' };

  // Contract: x/y are absolute 600x600 canvas pixels (top-left origin,
  // centre at 300,300, y down) — the backend owns the trig conversion.
  const toCanvas = (d) => ({ x: d.x, y: d.y });
  // Compass bearing of the drawn position, so the sweep always passes over
  // the blip exactly where it is drawn.
  const bearingOf = (p) => ((Math.atan2(p.x - C, C - p.y) * 180) / Math.PI + 360) % 360;
  const rad = (deg) => (deg * Math.PI) / 180;

  function traceShape(ctx, shape, x, y, s) {
    ctx.beginPath();
    switch (shape) {
      case 'triangle':
        ctx.moveTo(x, y - s * 1.2);
        ctx.lineTo(x + s * 1.1, y + s * 0.8);
        ctx.lineTo(x - s * 1.1, y + s * 0.8);
        ctx.closePath();
        break;
      case 'diamond':
        ctx.moveTo(x, y - s * 1.15);
        ctx.lineTo(x + s * 0.9, y);
        ctx.lineTo(x, y + s * 1.15);
        ctx.lineTo(x - s * 0.9, y);
        ctx.closePath();
        break;
      case 'square':
        ctx.rect(x - s * 0.85, y - s * 0.85, s * 1.7, s * 1.7);
        break;
      case 'cross':
        ctx.moveTo(x - s * 0.9, y - s * 0.9); ctx.lineTo(x + s * 0.9, y + s * 0.9);
        ctx.moveTo(x + s * 0.9, y - s * 0.9); ctx.lineTo(x - s * 0.9, y + s * 0.9);
        break;
      default:
        ctx.arc(x, y, s, 0, Math.PI * 2);
    }
  }

  class RadarScope {
    constructor(canvas, mode) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mode = mode; // 'baseline' | 'fused'
      this.blips = new Map();
      this.selected = null;
      this.hoverId = null;
      this.total = 0;
      this.bg = document.createElement('canvas');
      this.resize();
    }

    styleFor(d) {
      if (this.mode === 'baseline') return { color: BASELINE_COLOR, shape: 'circle' };
      return CLASS_STYLE[d.predicted_class] || FALLBACK_STYLE;
    }

    isShown(d) {
      return this.mode === 'baseline' ? d.detected === true : d.fused_detected === true;
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = Math.max(1, Math.round(Math.min(rect.width, rect.height) * dpr));
      if (px === this.canvas.width) return;
      this.canvas.width = this.canvas.height = px;
      this.bg.width = this.bg.height = px;
      this.scale = px / SIZE;
      this.drawBackground();
    }

    // A blip first appears when the sweep next passes its bearing after the
    // data arrived, then fades until the following pass.
    setData(list, totalDeg) {
      const seen = new Set();
      for (const d of list) {
        if (!this.isShown(d)) continue;
        seen.add(d.id);
        const pos = toCanvas(d);
        const existing = this.blips.get(d.id);
        if (existing) {
          existing.record = d;
          existing.pos = pos;
          continue;
        }
        const bearing = bearingOf(pos);
        const firstPass = totalDeg + ((((bearing - totalDeg) % 360) + 360) % 360);
        this.blips.set(d.id, { id: d.id, record: d, pos, firstPass });
      }
      for (const id of this.blips.keys()) if (!seen.has(id)) this.blips.delete(id);
    }

    setSelected(record) {
      this.selected = record;
    }

    visible(blip) {
      return this.total >= blip.firstPass;
    }

    hitTest(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const lx = ((clientX - rect.left) / rect.width) * SIZE;
      const ly = ((clientY - rect.top) / rect.height) * SIZE;
      let best = null;
      let bestDist = HIT_RADIUS;
      for (const b of this.blips.values()) {
        if (!this.visible(b)) continue;
        const dist = Math.hypot(b.pos.x - lx, b.pos.y - ly);
        if (dist <= bestDist) { best = b.id; bestDist = dist; }
      }
      return best;
    }

    drawBackground() {
      const ctx = this.bg.getContext('2d');
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);

      const face = ctx.createRadialGradient(C, C, 0, C, C, FACE_R);
      face.addColorStop(0, '#07190f');
      face.addColorStop(1, '#030a06');
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.arc(C, C, FACE_R, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(${GREEN}, 0.16)`;
      ctx.lineWidth = 1;
      for (let deg = 0; deg < 180; deg += 30) {
        const a = rad(deg - 90);
        ctx.beginPath();
        ctx.moveTo(C - FACE_R * Math.cos(a), C - FACE_R * Math.sin(a));
        ctx.lineTo(C + FACE_R * Math.cos(a), C + FACE_R * Math.sin(a));
        ctx.stroke();
      }

      ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      for (let km = 2; km <= 8; km += 2) {
        const r = km * 1000 * PX_PER_M;
        ctx.strokeStyle = `rgba(${GREEN}, ${km === 8 ? 0.3 : 0.2})`;
        ctx.beginPath();
        ctx.arc(C, C, r, 0, Math.PI * 2);
        ctx.stroke();
        if (km < 8) {
          ctx.fillStyle = `rgba(${GREEN}, 0.6)`;
          ctx.textAlign = 'right';
          ctx.fillText(`${km} km`, C + r - 4, C + 10);
        }
      }

      for (let deg = 0; deg < 360; deg += 5) {
        const a = rad(deg - 90);
        const major = deg % 30 === 0;
        const inner = FACE_R - (major ? 12 : 5);
        ctx.strokeStyle = `rgba(${GREEN}, ${major ? 0.7 : 0.3})`;
        ctx.beginPath();
        ctx.moveTo(C + inner * Math.cos(a), C + inner * Math.sin(a));
        ctx.lineTo(C + FACE_R * Math.cos(a), C + FACE_R * Math.sin(a));
        ctx.stroke();
        if (major) {
          ctx.fillStyle = `rgba(${GREEN}, 0.75)`;
          ctx.textAlign = 'center';
          const lr = FACE_R - 24;
          ctx.fillText(String(deg).padStart(3, '0'), C + lr * Math.cos(a), C + lr * Math.sin(a));
        }
      }

      ctx.strokeStyle = `rgba(${GREEN}, 0.55)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(C, C, FACE_R, 0, Math.PI * 2);
      ctx.stroke();
    }

    draw(totalDeg, now, reducedMotion) {
      this.total = totalDeg;
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

      this.drawSweep(totalDeg % 360);
      for (const b of this.blips.values()) {
        if (this.visible(b)) this.drawBlip(b, totalDeg, now, reducedMotion);
      }
      if (this.selected) this.drawSelection(this.selected);
    }

    drawSweep(sweepDeg) {
      const ctx = this.ctx;
      const a = rad(sweepDeg - 90);
      const trail = rad(TRAIL_DEG);
      if (ctx.createConicGradient) {
        const g = ctx.createConicGradient(a - trail, C, C);
        const f = TRAIL_DEG / 360;
        g.addColorStop(0, `rgba(${GREEN}, 0)`);
        g.addColorStop(f, `rgba(${GREEN}, 0.26)`);
        g.addColorStop(Math.min(1, f + 0.001), `rgba(${GREEN}, 0)`);
        g.addColorStop(1, `rgba(${GREEN}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(C, C);
        ctx.arc(C, C, FACE_R, a - trail, a);
        ctx.closePath();
        ctx.fill();
      } else {
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          ctx.fillStyle = `rgba(${GREEN}, ${(0.22 * (i + 1)) / steps})`;
          ctx.beginPath();
          ctx.moveTo(C, C);
          ctx.arc(C, C, FACE_R, a - trail + (trail * i) / steps, a - trail + (trail * (i + 1)) / steps);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.strokeStyle = `rgba(${GREEN}, 0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.lineTo(C + FACE_R * Math.cos(a), C + FACE_R * Math.sin(a));
      ctx.stroke();
    }

    drawBlip(b, totalDeg, now, reducedMotion) {
      const ctx = this.ctx;
      const d = b.record;
      const { color, shape } = this.styleFor(d);
      const since = ((totalDeg - b.firstPass) % 360) / 360;
      const alpha = 0.32 + 0.68 * Math.exp(-3.2 * since);
      const flash = since < 0.05 ? 1 + ((0.05 - since) / 0.05) * 0.5 : 1;
      const s = 7.5 * flash;
      const { x, y } = b.pos;

      ctx.globalAlpha = alpha * 0.22;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, s * 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = alpha;
      traceShape(ctx, shape, x, y, s);
      if (shape === 'cross') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        ctx.fill();
      }

      if (this.hoverId === b.id) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Contacts only fusion recovered: the demo's key moment.
      if (this.mode === 'fused' && d.baseline_detected === false) {
        ctx.globalAlpha = Math.max(alpha, 0.75);
        ctx.strokeStyle = '#eafff4';
        ctx.lineWidth = 1.75;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = reducedMotion ? 0 : -now / 80;
        ctx.beginPath();
        ctx.arc(x, y, 17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '700 14px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#eafff4';
        ctx.fillText(`T-${String(d.id).padStart(2, '0')}`, x + 21, y - 14);
      }
      ctx.globalAlpha = 1;
    }

    drawSelection(record) {
      const ctx = this.ctx;
      const { x, y } = toCanvas(record);
      const shownHere = this.blips.has(record.id);
      const h = 20;
      const l = 8;
      ctx.strokeStyle = shownHere ? '#ffffff' : 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash(shownHere ? [] : [3, 3]);
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * h, y + sy * (h - l));
        ctx.lineTo(x + sx * h, y + sy * h);
        ctx.lineTo(x + sx * (h - l), y + sy * h);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      if (!shownHere) {
        ctx.font = '700 13px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = 'NO RETURN';
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(40, 8, 14, 0.85)';
        ctx.fillRect(x - w / 2, y + h + 5, w, 20);
        ctx.fillStyle = '#ff8fa3';
        ctx.fillText(label, x, y + h + 9);
      }
    }
  }

  RadarScope.SWEEP_PERIOD_MS = SWEEP_PERIOD_MS;
  RadarScope.CLASS_STYLE = CLASS_STYLE;
  window.RadarScope = RadarScope;
})();
