/* Mala renderer: draws one frame of the counter as a pure function of time. */
(function (root) {
  'use strict';

  const THEMES = {
    rudraksha: {
      name: 'Rudraksha', plate: ['#33100f', '#170506'], rim: '#d9a441', thread: '#b3242b',
      off: ['#8a4a2c', '#552816', '#220c05'], on: ['#fff3c4', '#ffb83f', '#b4560c'],
      glow: '255,170,60', ridges: true, text: '#ffe2a3', num: ['#fff8e1', '#ffcf6b', '#d98a1c']
    },
    chandan: {
      name: 'Chandan', plate: ['#3d1607', '#190703'], rim: '#f0b45c', thread: '#e0582a',
      off: ['#d4a074', '#93603a', '#4d2b14'], on: ['#fff2cf', '#ffaa4f', '#c2410c'],
      glow: '255,150,60', ridges: false, text: '#ffe7c2', num: ['#fff6e5', '#ffbe73', '#e26a1b']
    },
    tulsi: {
      name: 'Tulsi', plate: ['#2c1709', '#130903'], rim: '#e5bd6a', thread: '#c2402a',
      off: ['#efe0bd', '#bea575', '#6d5530'], on: ['#fffdf0', '#ffd986', '#d6922f'],
      glow: '255,205,120', ridges: false, grain: true, text: '#fbecc8', num: ['#fffbea', '#ffe08a', '#d79a2b']
    },
    sphatik: {
      name: 'Sphatik', plate: ['#18204a', '#070a1e'], rim: '#cdd8ff', thread: '#e7e9ff',
      off: ['rgba(235,240,255,0.55)', 'rgba(170,185,230,0.30)', 'rgba(90,105,170,0.45)'], on: ['#ffffff', '#e4ecff', '#93a8ff'],
      glow: '185,205,255', crystal: true, text: '#eef2ff', num: ['#ffffff', '#e0e8ff', '#9db0ff']
    },
    kumkum: {
      name: 'Kumkum', plate: ['#4a0812', '#1c0206'], rim: '#ffcf70', thread: '#ffcf70',
      off: ['#b8323f', '#7a121f', '#33040a'], on: ['#fff4cc', '#ffd257', '#e0821a'],
      glow: '255,200,80', ridges: false, text: '#ffe6b0', num: ['#fffbe8', '#ffd66b', '#f09a21']
    }
  };

  const DEVA = '०१२३४५६७८९';
  const toNum = (n, deva) => deva ? String(n).replace(/\d/g, d => DEVA[d]) : String(n);
  const FONT_NUM_LAT = '"Cinzel", "Trajan Pro", "Optima", Georgia, serif';
  const FONT_DEVA = '"Tiro Devanagari Hindi", "Kohinoor Devanagari", "Devanagari Sangam MN", "Noto Serif Devanagari", "Cinzel", serif';

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const easeOut = v => 1 - Math.pow(1 - clamp01(v), 3);
  const easeInOut = v => { v = clamp01(v); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function mk(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function upperBound(a, t) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; } return lo; }

  function beadSprite(th, on, r, big) {
    const pad = 2, s = Math.ceil(r * 2 + pad * 2), c = mk(s, s), g = c.getContext('2d');
    const cx = s / 2, cy = s / 2;
    const cols = on ? th.on : th.off;
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.08, cx, cy, r);
    grad.addColorStop(0, cols[0]); grad.addColorStop(0.5, cols[1]); grad.addColorStop(1, cols[2]);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = grad; g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    if (th.ridges) {
      g.strokeStyle = on ? 'rgba(120,50,0,0.35)' : 'rgba(0,0,0,0.45)'; g.lineWidth = Math.max(0.6, r * 0.09);
      for (const k of [0.25, 0.6, 0.9]) {
        g.beginPath(); g.ellipse(cx, cy, r * k, r * 1.05, 0, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = on ? 'rgba(140,60,0,0.25)' : 'rgba(0,0,0,0.3)';
      for (let i = 0; i < 9; i++) { const a = i * 0.7, rr = r * (0.3 + 0.12 * (i % 4)); g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, r * 0.07, 0, 7); g.fill(); }
    }
    if (th.grain) {
      g.strokeStyle = on ? 'rgba(170,110,20,0.25)' : 'rgba(90,60,20,0.3)'; g.lineWidth = Math.max(0.5, r * 0.06);
      for (const k of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(cx - r, cy + k * r); g.quadraticCurveTo(cx, cy + k * r - r * 0.25, cx + r, cy + k * r); g.stroke(); }
    }
    g.restore();
    if (th.crystal) { g.beginPath(); g.arc(cx, cy, r - 0.5, 0, Math.PI * 2); g.strokeStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(0.7, r * 0.07); g.stroke(); }
    // specular highlight
    const hl = g.createRadialGradient(cx - r * 0.38, cy - r * 0.42, 0, cx - r * 0.38, cy - r * 0.42, r * 0.45);
    hl.addColorStop(0, `rgba(255,255,255,${on ? 0.85 : th.crystal ? 0.9 : 0.35})`); hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    if (big) { g.beginPath(); g.arc(cx, cy, r * 0.98, 0, Math.PI * 2); g.strokeStyle = th.rim; g.globalAlpha = 0.5; g.lineWidth = Math.max(1, r * 0.08); g.stroke(); }
    return c;
  }
  function glowSprite(th, r) {
    const R = r * 3.2, s = Math.ceil(R * 2), c = mk(s, s), g = c.getContext('2d');
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, R);
    gr.addColorStop(0, `rgba(${th.glow},0.75)`); gr.addColorStop(0.35, `rgba(${th.glow},0.28)`); gr.addColorStop(1, `rgba(${th.glow},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
  }

  function staticLayer(th, W, st) {
    const c = mk(W, W), g = c.getContext('2d'), C = W / 2;
    if (!st.backplate) return c;
    const R = W * 0.488;
    const gr = g.createRadialGradient(C, C * 0.92, W * 0.05, C, C, R);
    gr.addColorStop(0, th.plate[0]); gr.addColorStop(1, th.plate[1]);
    g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
    // lotus mandala, faint
    g.save(); g.translate(C, C); g.strokeStyle = th.rim; g.fillStyle = th.rim;
    const petals = (n, r0, r1, wdt, alpha, rot) => {
      g.globalAlpha = alpha; g.lineWidth = W * 0.0018;
      for (let i = 0; i < n; i++) {
        g.save(); g.rotate(rot + i * Math.PI * 2 / n);
        g.beginPath(); g.moveTo(0, -r0);
        g.quadraticCurveTo(wdt, -(r0 + r1) / 2, 0, -r1);
        g.quadraticCurveTo(-wdt, -(r0 + r1) / 2, 0, -r0);
        g.stroke(); g.globalAlpha = alpha * 0.25; g.fill(); g.globalAlpha = alpha; g.restore();
      }
    };
    petals(32, W * 0.3, W * 0.375, W * 0.03, 0.22, 0);
    petals(32, W * 0.29, W * 0.355, W * 0.022, 0.14, Math.PI / 32);
    g.globalAlpha = 0.35;
    for (let i = 0; i < 64; i++) { const a = i * Math.PI * 2 / 64; g.beginPath(); g.arc(Math.cos(a) * W * 0.285, Math.sin(a) * W * 0.285, W * 0.0028, 0, 7); g.fill(); }
    g.globalAlpha = 0.6; g.lineWidth = W * 0.004;
    g.beginPath(); g.arc(0, 0, W * 0.483, 0, 7); g.stroke();
    g.globalAlpha = 0.35; g.lineWidth = W * 0.002;
    g.beginPath(); g.arc(0, 0, W * 0.468, 0, 7); g.stroke();
    g.globalAlpha = 0.5;
    for (let i = 0; i < 96; i++) { const a = i * Math.PI * 2 / 96; g.beginPath(); g.arc(Math.cos(a) * W * 0.4755, Math.sin(a) * W * 0.4755, W * 0.0022, 0, 7); g.fill(); }
    // soft halo behind the number
    const h = g.createRadialGradient(0, W * 0.04, 0, 0, W * 0.04, W * 0.25);
    h.addColorStop(0, `rgba(${th.glow},0.10)`); h.addColorStop(1, `rgba(${th.glow},0)`);
    g.globalAlpha = 1; g.fillStyle = h; g.beginPath(); g.arc(0, 0, W * 0.3, 0, 7); g.fill();
    g.restore();
    return c;
  }

  function fitFont(g, text, family, weight, maxSize, maxWidth) {
    let size = maxSize;
    for (let i = 0; i < 25; i++) {
      g.font = `${weight} ${size}px ${family}`;
      if (g.measureText(text).width <= maxWidth) break;
      size *= 0.92;
    }
    return size;
  }

  /** model: {events: sorted seconds when count increments, target}; st: style */
  function createRenderer(W) {
    let cacheKey = '', cache = null;
    function ensure(st) {
      const th = THEMES[st.theme] || THEMES.rudraksha;
      const nBeads = Math.min(108, Math.max(1, st._beads || 108));
      const key = [st.theme, st.backplate, nBeads, W].join('|');
      if (key === cacheKey) return cache;
      const R = W * 0.405;
      const gap = 3 * (Math.PI * 2 / 111);
      const step = (Math.PI * 2 - gap) / nBeads;
      const r = Math.min(W * 0.021, R * step * 0.49);
      cache = {
        th, R, gap, step, r, nBeads,
        off: beadSprite(th, false, r), on: beadSprite(th, true, r),
        meruOff: beadSprite(th, false, r * 1.9, true), meruOn: beadSprite(th, true, r * 1.9, true),
        glow: glowSprite(th, r), glowBig: glowSprite(th, r * 1.9),
        layer: staticLayer(th, W, st)
      };
      cacheKey = key;
      return cache;
    }

    function draw(g, t, model, st) {
      st._beads = Math.min(108, model.target);
      const K = ensure(st), th = K.th, C = W / 2;
      const ev = model.events, N = model.target;
      const total = upperBound(ev, t);
      const c = Math.min(total, N);
      const dt = c > 0 ? t - ev[c - 1] : 1e9;
      const rounds = N > K.nBeads;
      const cInMala = rounds ? (c === 0 ? 0 : ((c - 1) % K.nBeads) + 1) : c;
      const done = c >= N && N > 0;
      const useAdd = st.backplate;

      g.save();
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.fillStyle = st.bg; g.fillRect(0, 0, W, W);
      g.drawImage(K.layer, 0, 0);

      // rotation (turning mala keeps the active bead at the "hand")
      const moveK = easeInOut(dt / 0.45);
      const pIdx = cInMala === 0 ? -1 : (cInMala - 1) - (1 - moveK) * (cInMala > 1 ? 1 : 0);
      const rot = st.rotate && cInMala > 0 ? -Math.max(0, pIdx) * K.step : 0;
      const ang = i => Math.PI / 2 + K.gap / 2 + (i + 0.5) * K.step + rot;

      // thread
      g.strokeStyle = th.thread; g.globalAlpha = 0.85; g.lineWidth = Math.max(1, W * 0.0028);
      g.beginPath(); g.arc(C, C, K.R, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;

      // tassel + sumeru (guru bead)
      const ma = Math.PI / 2 + rot, mx = C + Math.cos(ma) * K.R, my = C + Math.sin(ma) * K.R;
      g.save(); g.translate(mx, my); g.rotate(ma - Math.PI / 2);
      g.strokeStyle = th.thread; g.lineWidth = Math.max(1, W * 0.0022);
      const tl = Math.min(W * 0.06, W * 0.068 - K.r * 1.6);
      for (let k = -4; k <= 4; k++) { g.beginPath(); g.moveTo(0, K.r * 1.6); g.quadraticCurveTo(k * W * 0.003, tl * 0.6, k * W * 0.0065, tl); g.stroke(); }
      g.fillStyle = th.rim; g.beginPath(); g.ellipse(0, K.r * 2.2, K.r * 0.55, K.r * 0.4, 0, 0, 7); g.fill();
      g.restore();

      const litFrac = i => {
        if (done && !rounds) return 1;
        if (i < cInMala - 1) return 1;
        if (i === cInMala - 1) return easeOut(dt / 0.25);
        return 0;
      };
      const wavePos = done ? (dt / 2.2) * (K.nBeads + 10) - 5 : -100;
      const boost = i => done ? Math.exp(-Math.pow((i - wavePos) / 5, 2)) + (dt > 2.2 ? 0.25 + 0.15 * Math.sin(dt * 2.4 - i * 0.12) : 0) : 0;

      // glows
      if (st.glow) {
        if (useAdd) g.globalCompositeOperation = 'lighter';
        const gs = K.glow.width;
        for (let i = 0; i < K.nBeads; i++) {
          const a = litFrac(i); if (a <= 0) continue;
          const cur = i === cInMala - 1 && !done;
          const amp = (useAdd ? 0.55 : 0.35) * a + boost(i) * 0.7 + (cur ? 0.6 * Math.exp(-dt * 2) + 0.35 : 0);
          const sc = cur ? 1.5 : 1;
          const x = C + Math.cos(ang(i)) * K.R, y = C + Math.sin(ang(i)) * K.R;
          g.globalAlpha = Math.min(1, amp);
          g.drawImage(K.glow, x - gs * sc / 2, y - gs * sc / 2, gs * sc, gs * sc);
        }
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      }
      // beads
      const bs = K.off.width;
      for (let i = 0; i < K.nBeads; i++) {
        const a = litFrac(i), b = boost(i);
        const cur = i === cInMala - 1 && !done;
        const sc = (cur ? 1.18 + 0.4 * Math.exp(-dt * 6) : 1) + 0.22 * b;
        const x = C + Math.cos(ang(i)) * K.R, y = C + Math.sin(ang(i)) * K.R, w = bs * sc;
        if (a < 1) { g.globalAlpha = 1; g.drawImage(K.off, x - w / 2, y - w / 2, w, w); }
        if (a > 0) { g.globalAlpha = a; g.drawImage(K.on, x - w / 2, y - w / 2, w, w); }
      }
      g.globalAlpha = 1;
      // sumeru bead
      const mw = K.meruOff.width;
      if (done && st.glow) { if (useAdd) g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5 + 0.4 * Math.sin(dt * 3); const gw = K.glowBig.width; g.drawImage(K.glowBig, mx - gw / 2, my - gw / 2); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
      g.drawImage(done ? K.meruOn : K.meruOff, mx - mw / 2, my - mw / 2);

      // ripple + sparks from the newest bead
      if (cInMala > 0 && !done && dt < 0.9) {
        const ci = cInMala - 1, x = C + Math.cos(ang(ci)) * K.R, y = C + Math.sin(ang(ci)) * K.R;
        g.strokeStyle = `rgba(${th.glow},${(1 - dt / 0.9) * 0.9})`; g.lineWidth = Math.max(1, W * 0.003 * (1 - dt / 0.9));
        g.beginPath(); g.arc(x, y, K.r * (1.4 + dt * 6), 0, 7); g.stroke();
        if (st.sparks !== false) {
          const rnd = rng(c * 7919 + 13);
          if (useAdd) g.globalCompositeOperation = 'lighter';
          for (let p = 0; p < 14; p++) {
            const a0 = rnd() * Math.PI * 2, v = W * (0.05 + rnd() * 0.08), life = 0.5 + rnd() * 0.4;
            if (dt > life) continue;
            const d = v * (1 - Math.exp(-4 * dt)) / 4 * 4;
            const px = x + Math.cos(a0) * d, py = y + Math.sin(a0) * d + W * 0.02 * dt * dt;
            g.globalAlpha = 1 - dt / life; g.fillStyle = `rgb(${th.glow})`;
            g.beginPath(); g.arc(px, py, Math.max(0.8, K.r * 0.22 * (1 - dt / life)), 0, 7); g.fill();
          }
          g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        }
      }

      // pointer (the "hand" moving bead to bead)
      if (st.pointer !== false && !done) {
        const pi = st.rotate ? 0 : Math.max(-0.5, pIdx);
        const pa = st.rotate ? ang(0) - rot + 0 : ang(pi);
        const pr = K.R + K.r * 2.6;
        const px = C + Math.cos(pa) * pr, py = C + Math.sin(pa) * pr;
        g.save(); g.translate(px, py); g.rotate(pa + Math.PI / 2);
        const s = K.r * 1.1;
        g.fillStyle = th.rim; g.globalAlpha = cInMala > 0 ? 1 : 0.5;
        g.beginPath(); g.moveTo(0, s * 1.1); g.quadraticCurveTo(s * 0.9, -s * 0.2, 0, -s * 1.2); g.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, s * 1.1); g.fill();
        g.restore(); g.globalAlpha = 1;
      }

      // ---- centre text ----
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const deva = st.numerals === 'deva';
      const numFamily = deva ? FONT_DEVA : FONT_NUM_LAT;
      if (st.backplate) { g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = W * 0.012; g.shadowOffsetY = W * 0.004; }
      if (st.mantra) {
        const fs = fitFont(g, st.mantra, FONT_DEVA, 600, W * 0.072, W * 0.5);
        g.fillStyle = th.text; g.globalAlpha = 0.95;
        g.fillText(st.mantra, C, W * 0.345);
        g.globalAlpha = 1;
      }
      const numY = W * 0.585;
      const drawNum = (n, yOff, alpha, scale) => {
        const txt = toNum(n, deva);
        const base = txt.length >= 4 ? W * 0.17 : W * 0.215;
        g.save(); g.translate(C, numY + yOff); g.scale(scale, scale);
        g.font = `700 ${base}px ${numFamily}`;
        const gr = g.createLinearGradient(0, -base * 0.75, 0, base * 0.05);
        gr.addColorStop(0, th.num[0]); gr.addColorStop(0.55, th.num[1]); gr.addColorStop(1, th.num[2]);
        g.globalAlpha = alpha; g.fillStyle = gr; g.fillText(txt, 0, 0); g.restore();
      };
      const k = easeOut(dt / 0.38);
      const pop = 1 + 0.06 * Math.exp(-dt * 7);
      const travel = W * 0.12;
      g.save(); g.beginPath(); g.rect(0, numY - W * 0.215, W, W * 0.26); g.clip();
      if (c > 0 && k < 1) drawNum(c - 1, -k * travel, clamp01(1 - k * 1.8), 1);
      drawNum(c, (1 - k) * travel, c > 0 ? clamp01((k - 0.15) / 0.55) : 1, done ? 1 + 0.03 * Math.sin(dt * 2.4) : pop);
      g.restore();
      g.globalAlpha = 1;
      // line under the number
      const subY = W * 0.67;
      let sub = st.subMode === 'none' ? '' : st.subMode === 'custom' ? (st.subText || '') : '/ ' + toNum(N, deva);
      if (rounds && st.subMode !== 'none') sub = (deva ? 'माला ' : 'Mala ') + toNum(Math.floor(Math.max(0, c - 1) / K.nBeads) + 1, deva) + '  ·  ' + toNum(N, deva);
      const doneA = done && st.doneText ? easeOut((dt - 0.8) / 0.8) : 0;
      if (sub && doneA < 1) {
        fitFont(g, sub, st.subMode === 'total' ? numFamily : FONT_DEVA, 600, W * 0.048, W * 0.42);
        g.fillStyle = th.text; g.globalAlpha = 0.72 * (1 - doneA); g.fillText(sub, C, subY);
      }
      if (doneA > 0) {
        fitFont(g, st.doneText, FONT_DEVA, 600, W * 0.06, W * 0.46);
        g.fillStyle = th.num[1]; g.globalAlpha = doneA; g.fillText(st.doneText, C, subY + W * 0.008);
      }
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; g.globalAlpha = 1;

      // flower petals on completion
      if (done && st.petals !== false && dt < 7) {
        g.save(); g.beginPath(); g.arc(C, C, st.backplate ? W * 0.466 : K.R - K.r * 2, 0, 7); g.clip();
        const rnd = rng(108);
        const cols = ['#ff4f79', '#ff8a3d', '#ffc94a', '#ff6fa1', '#f2552c'];
        for (let p = 0; p < 46; p++) {
          const x0 = C + (rnd() - 0.5) * W * 0.9, delay = rnd() * 2.2, sp = W * (0.12 + rnd() * 0.1), sw = rnd() * 6, size = W * (0.009 + rnd() * 0.008);
          const col = cols[(rnd() * cols.length) | 0];
          const tt = dt - delay; if (tt < 0) continue;
          const y = -W * 0.05 + tt * sp, x = x0 + Math.sin(tt * 1.6 + sw) * W * 0.03;
          if (y > W * 1.05) continue;
          g.save(); g.translate(x, y); g.rotate(tt * 1.3 + sw);
          g.globalAlpha = dt > 6 ? 7 - dt : 0.95; g.fillStyle = col;
          g.beginPath(); g.ellipse(0, 0, size, size * 0.55, 0, 0, 7); g.fill(); g.restore();
        }
        g.restore();
      }
      g.restore();
    }
    return { draw, size: W };
  }

  root.Mala = { createRenderer, THEMES, toNum };
})(typeof window !== 'undefined' ? window : globalThis);
