(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ANALYSIS_SR = 22050;

  const DEFAULT_STYLE = {
    mantra: 'ॐ नमः शिवाय', subMode: 'total', subText: '', doneText: '॥ हरि ॐ ॥',
    theme: 'rudraksha', numerals: 'latin', countAt: 'start', offsetMs: 0, rotate: false,
    backplate: true, glow: true, sparks: true, pointer: true, petals: true, bg: '#00ff00'
  };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

  const S = {
    file: null, name: '', duration: 0, mono: null, sr: ANALYSIS_SR, feat: null, peaks: null,
    markers: [], conf: [], selected: -1, undo: [],
    style: Object.assign({}, DEFAULT_STYLE, lsGet('njc:style', {})),
    target: 108, range: [0, 0], view: [0, 10], tapping: false, exporting: false, pendingProject: null,
    dirtyPreview: true, dirtyTl: true
  };
  const audio = new Audio(); audio.preload = 'auto';

  // ---------- helpers ----------
  const fmt = (t, d = 2) => { if (!isFinite(t)) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(d).padStart(d ? 3 + d : 2, '0')}`; };
  const parseT = s => { s = String(s).trim(); if (!s) return NaN; const p = s.split(':').map(Number); return p.length === 1 ? p[0] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; };
  const lb = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < t) lo = m + 1; else hi = m; } return lo; };
  const curTime = () => S.file ? audio.currentTime : demoTime();
  const fileKey = () => 'njc:m:' + S.name + ':' + S.duration.toFixed(1);
  const loaded = () => !!S.file;

  // ---------- model for the renderer ----------
  let demo = null;
  function demoTime() { return (performance.now() / 1000) % (demo.len); }
  function buildDemo() {
    const ev = []; for (let i = 0; i < 108; i++) ev.push(1 + i * 0.55);
    demo = { events: ev, len: 1 + 108 * 0.55 + 7 };
  }
  buildDemo();
  function model() {
    if (!loaded()) return { events: demo.events, target: 108 };
    const off = S.style.offsetMs / 1000;
    const m = S.markers;
    let ev;
    if (S.style.countAt === 'end' && m.length) {
      const gaps = []; for (let i = 1; i < m.length; i++) gaps.push(m[i] - m[i - 1]);
      gaps.sort((a, b) => a - b);
      const g = gaps.length ? gaps[gaps.length >> 1] : 2;
      ev = m.slice(1).concat([Math.min(S.duration, m[m.length - 1] + g * 0.85)]);
    } else ev = m.slice();
    return { events: ev.map(t => t + off), target: S.target };
  }

  // ---------- preview ----------
  const pv = $('preview'), pctx = pv.getContext('2d', { alpha: false });
  let pr = Mala.createRenderer(pv.width);
  function setPreviewSize(px) { pv.width = pv.height = px; pr = Mala.createRenderer(px); S.dirtyPreview = true; }

  // ---------- timeline ----------
  const tl = $('tl'), tctx = tl.getContext('2d');
  let tlW = 0, tlH = 0, dpr = 1;
  function resizeTl() {
    dpr = window.devicePixelRatio || 1;
    const r = tl.getBoundingClientRect(); tlW = r.width; tlH = r.height;
    tl.width = Math.round(tlW * dpr); tl.height = Math.round(tlH * dpr); S.dirtyTl = true;
  }
  window.addEventListener('resize', resizeTl);
  const RULER = 24;
  const x2t = x => S.view[0] + x / tlW * (S.view[1] - S.view[0]);
  const t2x = t => (t - S.view[0]) / (S.view[1] - S.view[0]) * tlW;

  function buildPeaks() {
    const B = 128, n = Math.ceil(S.mono.length / B), mn = new Float32Array(n), mx = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = 1, b = -1; const e = Math.min(S.mono.length, (i + 1) * B);
      for (let j = i * B; j < e; j++) { const v = S.mono[j]; if (v < a) a = v; if (v > b) b = v; }
      mn[i] = a; mx[i] = b;
    }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, mx[i], -mn[i]);
    S.peaks = { B, mn, mx, gain: peak > 0 ? 0.95 / peak : 1 };
  }

  function drawTl() {
    const g = tctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#140c0c'; g.fillRect(0, 0, tlW, tlH);
    if (!loaded()) { g.fillStyle = '#7d6a62'; g.font = '13px -apple-system,system-ui'; g.textAlign = 'center'; g.fillText('Your chant waveform and markers will appear here', tlW / 2, tlH / 2); return; }
    const [v0, v1] = S.view, span = v1 - v0;
    // range shading
    const xa = t2x(S.range[0]), xb = t2x(S.range[1]);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    if (xa > 0) g.fillRect(0, RULER, xa, tlH - RULER);
    if (xb < tlW) g.fillRect(xb, RULER, tlW - xb, tlH - RULER);
    // ruler
    g.fillStyle = '#1d1213'; g.fillRect(0, 0, tlW, RULER);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const st = steps.find(s => s / span * tlW > 70) || 600;
    g.fillStyle = '#8c766c'; g.strokeStyle = '#3a2426'; g.font = '11px -apple-system,system-ui'; g.textAlign = 'left';
    for (let t = Math.ceil(v0 / st) * st; t <= v1; t += st) {
      const x = t2x(t); g.beginPath(); g.moveTo(x + .5, RULER - 7); g.lineTo(x + .5, tlH); g.stroke();
      g.fillText(fmt(t, st < 1 ? 2 : st < 10 ? 1 : 0), x + 4, 15);
    }
    // range edges
    g.fillStyle = '#ff9a2e';
    for (const x of [xa, xb]) if (x >= -2 && x <= tlW + 2) { g.fillRect(x - 1, 0, 2, tlH); g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 6, 0); g.lineTo(x, 8); g.fill(); }
    // waveform
    const mid = RULER + (tlH - RULER) / 2, amp = (tlH - RULER) / 2 - 6;
    const P = S.peaks, spp = span * S.sr / tlW;
    g.fillStyle = '#7a4a3c';
    for (let x = 0; x < tlW; x++) {
      const s0 = Math.floor((v0 + x / tlW * span) * S.sr), s1 = Math.floor((v0 + (x + 1) / tlW * span) * S.sr);
      let a = 0, b = 0;
      if (spp >= P.B) {
        const b0 = Math.max(0, Math.floor(s0 / P.B)), b1 = Math.min(P.mn.length, Math.ceil(s1 / P.B));
        for (let i = b0; i < b1; i++) { if (P.mn[i] < a) a = P.mn[i]; if (P.mx[i] > b) b = P.mx[i]; }
      } else {
        for (let i = Math.max(0, s0); i <= Math.min(S.mono.length - 1, s1); i++) { const v = S.mono[i]; if (v < a) a = v; if (v > b) b = v; }
      }
      const y0 = mid - b * P.gain * amp, y1 = mid - a * P.gain * amp;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    // markers
    const m = S.markers, i0 = Math.max(0, lb(m, v0) - 1), i1 = Math.min(m.length, lb(m, v1) + 1);
    const dense = (i1 - i0) > tlW / 22;
    g.font = '600 11px -apple-system,system-ui'; g.textAlign = 'center';
    for (let i = i0; i < i1; i++) {
      const x = Math.round(t2x(m[i])) + .5, sel = i === S.selected, low = (S.conf[i] ?? 1) < 0.6;
      const col = sel ? '#ffffff' : low ? '#ff8a3d' : '#f2c063';
      g.strokeStyle = col; g.lineWidth = sel ? 2 : 1; g.globalAlpha = dense && !sel && !low ? 0.45 : 1;
      g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, tlH); g.stroke(); g.globalAlpha = 1;
      g.fillStyle = col;
      if (!dense || sel || (i + 1) % 9 === 0 || i === 0) {
        const label = String(i + 1), w = g.measureText(label).width + 8;
        g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, RULER + 3, w, 15, 4) : g.rect(x - w / 2, RULER + 3, w, 15); g.fill();
        g.fillStyle = '#1a0e08'; g.fillText(label, x, RULER + 14);
      } else { g.beginPath(); g.arc(x, RULER + 6, 2.5, 0, 7); g.fill(); }
    }
    // playhead
    const px = t2x(audio.currentTime);
    if (px >= 0 && px <= tlW) { g.fillStyle = '#ff4d4d'; g.fillRect(px - 1, 0, 2, tlH); }
  }

  // ---------- UI state ----------
  function setMarkers(arr, conf, keepUndo) {
    if (!keepUndo) pushUndo();
    const idx = arr.map((t, i) => i).sort((a, b) => arr[a] - arr[b]);
    S.markers = idx.map(i => arr[i]); S.conf = idx.map(i => conf ? conf[i] : 1);
    S.selected = -1; changed();
  }
  function pushUndo() { S.undo.push({ m: S.markers.slice(), c: S.conf.slice() }); if (S.undo.length > 150) S.undo.shift(); $('bUndo').disabled = false; }
  function undo() { const u = S.undo.pop(); if (!u) return; S.markers = u.m; S.conf = u.c; S.selected = -1; $('bUndo').disabled = !S.undo.length; changed(); }
  let saveT = 0;
  function changed() {
    S.dirtyPreview = S.dirtyTl = true; updateChip();
    $('bDelM').disabled = S.selected < 0;
    clearTimeout(saveT);
    saveT = setTimeout(() => { if (loaded()) lsSet(fileKey(), { markers: S.markers, conf: S.conf, range: S.range, target: S.target }); }, 400);
  }
  function updateChip() {
    const c = $('chip'), n = S.markers.length;
    if (!loaded()) { c.textContent = 'demo'; c.className = 'count-chip'; return; }
    c.textContent = n === S.target ? `✓ ${n} / ${S.target} markers` : `${n} / ${S.target} markers`;
    c.className = 'count-chip ' + (n === S.target ? 'good' : n ? 'warn' : '');
    const low = S.conf.filter(v => v < 0.6).length;
    if (n && !S.tapping) $('detNote').innerHTML = n === S.target
      ? `${n} markers placed${low ? ` · <span style="color:#ff8a3d">${low} orange</span> worth a listen` : ' · all confident'}. Press <kbd>.</kbd> to step through.`
      : `<span style="color:#ff6b5b">${n} markers, but you set ${S.target}.</span> Add or delete markers, or run detection again.`;
  }
  function enable() {
    for (const id of ['bPlay', 'bDetect', 'bTap', 'bSnap', 'bAddM', 'bExport', 'bSaveProj']) $(id).disabled = false;
    $('dropHint').style.display = 'none';
  }

  // ---------- loading ----------
  async function loadFile(file) {
    if (S.exporting) return;
    $('fileName').textContent = file.name; $('fileNote').className = 'note'; $('fileNote').textContent = 'Reading audio…';
    const bar = $('anBar'); bar.style.display = 'block'; bar.firstChild.style.width = '3%';
    let buf;
    try {
      const ab = await file.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, ANALYSIS_SR);
      buf = await ctx.decodeAudioData(ab);
    } catch (e) {
      bar.style.display = 'none';
      $('fileNote').className = 'note bad';
      $('fileNote').textContent = 'Could not read the audio in this file. Export the audio as .m4a, .mp3 or .wav and try again.';
      return;
    }
    audio.pause();
    const n = buf.length, mono = new Float32Array(n), ch = buf.numberOfChannels;
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    if (audio.src) URL.revokeObjectURL(audio.src);
    Object.assign(S, { file, name: file.name, duration: buf.duration, mono, sr: buf.sampleRate, feat: null, markers: [], conf: [], selected: -1, undo: [] });
    audio.src = URL.createObjectURL(file);
    buildPeaks();
    S.range = [0, S.duration]; S.view = [0, S.duration];
    const saved = S.pendingProject && Math.abs(S.pendingProject.duration - S.duration) < 1 ? S.pendingProject : lsGet(fileKey(), null);
    let restored = false;
    if (saved && saved.markers && saved.markers.length) {
      S.markers = saved.markers.slice(); S.conf = (saved.conf || saved.markers.map(() => 1)).slice();
      if (saved.range) S.range = saved.range.slice();
      if (saved.target) S.target = saved.target;
      if (saved.style) { S.style = Object.assign({}, DEFAULT_STYLE, saved.style); syncStyleUI(); }
      restored = true;
    }
    S.pendingProject = null;
    $('nTarget').value = S.target; syncRange();
    enable(); changed();
    $('fileNote').textContent = `${fmt(S.duration, 1)} long · analysing chants…`;
    S.feat = await JaapDetect.computeFeatures(mono, S.sr, p => { bar.firstChild.style.width = (3 + p * 97).toFixed(0) + '%'; });
    bar.style.display = 'none';
    $('fileNote').className = 'note hi';
    $('fileNote').textContent = `${fmt(S.duration, 1)} long · ready.` + (restored ? ' Your earlier markers for this file were restored.' : '');
    if (!restored) runDetect();
  }

  function runDetect() {
    if (!S.feat) return;
    readRange();
    try {
      const r = JaapDetect.detect(S.feat, { count: S.target, start: S.range[0], end: S.range[1], steadiness: +$('steady').value });
      setMarkers(r.times, r.conf);
      fitView();
      const low = r.conf.filter(c => c < 0.6).length;
      if (r.fallback) $('detNote').innerHTML = '<span style="color:#ff6b5b">Could not hear enough separate chants, so markers were spaced evenly.</span> Try <b>Tap along</b> instead.';
      else $('detNote').innerHTML = `Found ${r.times.length} chants, about one every <b>${r.period.toFixed(2)} s</b>${low ? ` · <span style="color:#ff8a3d">${low} orange</span> worth a listen` : ' · all confident'}. Press <kbd>.</kbd> to step through.`;
    } catch (e) { $('detNote').textContent = e.message; }
  }

  // ---------- range ----------
  function syncRange() { $('rStart').value = fmt(S.range[0]); $('rEnd').value = fmt(S.range[1]); S.dirtyTl = true; }
  function readRange() {
    let a = parseT($('rStart').value), b = parseT($('rEnd').value);
    if (!isFinite(a)) a = 0; if (!isFinite(b)) b = S.duration;
    a = Math.max(0, Math.min(S.duration, a)); b = Math.max(a + 0.5, Math.min(S.duration, b));
    S.range = [a, b]; syncRange();
  }
  $('rStart').addEventListener('change', () => { readRange(); changed(); });
  $('rEnd').addEventListener('change', () => { readRange(); changed(); });
  $('bStartPH').onclick = () => { $('rStart').value = fmt(audio.currentTime); readRange(); changed(); };
  $('bEndPH').onclick = () => { $('rEnd').value = fmt(audio.currentTime); readRange(); changed(); };
  $('nTarget').addEventListener('change', () => { S.target = Math.max(1, Math.min(10008, parseInt($('nTarget').value) || 108)); $('nTarget').value = S.target; $('tapTarget').textContent = S.target; changed(); });

  // ---------- transport ----------
  function togglePlay() { if (!loaded()) return; if (audio.paused) audio.play(); else audio.pause(); }
  audio.addEventListener('play', () => $('bPlay').textContent = '❚❚ Pause');
  audio.addEventListener('pause', () => $('bPlay').textContent = '▶ Play');
  audio.addEventListener('ended', () => { if (S.tapping) stopTap(); });
  $('bPlay').onclick = togglePlay;
  function seek(t) { audio.currentTime = Math.max(0, Math.min(S.duration, t)); S.dirtyTl = S.dirtyPreview = true; }

  // ---------- tap along ----------
  function startTap() {
    if (!loaded()) return;
    if (S.markers.length && !confirm('Tap along replaces the current markers (you can Undo). Start?')) return;
    readRange(); setMarkers([], []);
    S.tapping = true; $('tapBanner').style.display = 'block'; $('tapCount').textContent = '0';
    seek(Math.max(0, S.range[0] - 1)); audio.play();
  }
  function tap() {
    const t = Math.max(0, audio.currentTime - 0.12);
    const i = lb(S.markers, t); S.markers.splice(i, 0, t); S.conf.splice(i, 0, 1);
    $('tapCount').textContent = S.markers.length; changed();
    if (S.markers.length >= S.target) setTimeout(stopTap, 600);
  }
  function stopTap() {
    if (!S.tapping) return;
    S.tapping = false; audio.pause(); $('tapBanner').style.display = 'none';
    if (S.feat && S.markers.length) { S.markers = JaapDetect.snap(S.feat, S.markers, 0.3); S.markers.sort((a, b) => a - b); }
    $('detNote').innerHTML = `Tapped ${S.markers.length} chants and snapped them onto the chant starts.`;
    changed();
  }
  $('bTap').onclick = startTap;
  $('bSnap').onclick = () => { if (!S.feat || !S.markers.length) return; pushUndo(); S.markers = JaapDetect.snap(S.feat, S.markers, 0.3).sort((a, b) => a - b); changed(); };
  $('bDetect').onclick = () => { if (S.markers.length && S.undo.length === 0) pushUndo(); runDetect(); };

  // ---------- timeline interaction ----------
  let drag = null;
  function hitMarker(x) {
    const t = x2t(x), i = lb(S.markers, t);
    let best = -1, bd = 7;
    for (const j of [i - 1, i]) if (j >= 0 && j < S.markers.length) { const d = Math.abs(t2x(S.markers[j]) - x); if (d < bd) { bd = d; best = j; } }
    return best;
  }
  tl.addEventListener('mousedown', e => {
    if (!loaded()) return;
    const x = e.offsetX, y = e.offsetY;
    if (y < RULER) {
      const da = Math.abs(t2x(S.range[0]) - x), db = Math.abs(t2x(S.range[1]) - x);
      if (Math.min(da, db) < 10) { drag = { kind: 'range', which: da < db ? 0 : 1 }; return; }
      drag = { kind: 'scrub' }; seek(x2t(x)); return;
    }
    const h = hitMarker(x);
    if (h >= 0) { S.selected = h; drag = { kind: 'marker', i: h, x0: x, moved: false }; changed(); return; }
    drag = { kind: 'pan', x0: x, v: S.view.slice(), moved: false };
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const r = tl.getBoundingClientRect(), x = e.clientX - r.left;
    if (drag.kind === 'marker') {
      if (!drag.moved && Math.abs(x - drag.x0) < 3) return;
      if (!drag.moved) { pushUndo(); drag.moved = true; }
      const i = drag.i, lo = i > 0 ? S.markers[i - 1] + 0.05 : 0, hi = i < S.markers.length - 1 ? S.markers[i + 1] - 0.05 : S.duration;
      S.markers[i] = Math.max(lo, Math.min(hi, x2t(x))); S.conf[i] = 1; changed();
    } else if (drag.kind === 'pan') {
      if (!drag.moved && Math.abs(x - drag.x0) < 3) return;
      drag.moved = true; const dt = (x - drag.x0) / tlW * (drag.v[1] - drag.v[0]);
      setView(drag.v[0] - dt, drag.v[1] - dt);
    } else if (drag.kind === 'range') {
      const t = Math.max(0, Math.min(S.duration, x2t(x)));
      if (drag.which === 0) S.range[0] = Math.min(t, S.range[1] - 0.5); else S.range[1] = Math.max(t, S.range[0] + 0.5);
      syncRange();
    } else if (drag.kind === 'scrub') seek(x2t(x));
  });
  window.addEventListener('mouseup', e => {
    if (!drag) return;
    if (drag.kind === 'pan' && !drag.moved) { S.selected = -1; seek(x2t(drag.x0)); changed(); }
    if (drag.kind === 'marker' && !drag.moved) seek(S.markers[drag.i] - 0.05);
    if (drag.kind === 'range') changed();
    drag = null;
  });
  tl.addEventListener('dblclick', e => {
    if (!loaded() || e.offsetY < RULER) return;
    if (hitMarker(e.offsetX) >= 0) return;
    addMarker(x2t(e.offsetX));
  });
  tl.addEventListener('wheel', e => {
    if (!loaded()) return; e.preventDefault();
    const [v0, v1] = S.view, span = v1 - v0;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = e.deltaX / tlW * span; setView(v0 + d, v1 + d); return; }
    const t = x2t(e.offsetX), f = Math.exp(e.deltaY * 0.0025);
    setView(t - (t - v0) * f, t + (v1 - t) * f);
  }, { passive: false });
  function setView(a, b) {
    let span = Math.max(0.5, Math.min(Math.max(1, S.duration), b - a));
    a = Math.max(0, Math.min(Math.max(0, S.duration - span), a));
    S.view = [a, a + span]; S.dirtyTl = true;
  }
  function fitView() { setView(0, S.duration); }
  function zoom(f) { const c = (S.view[0] + S.view[1]) / 2, h = (S.view[1] - S.view[0]) / 2 * f; setView(c - h, c + h); }
  function addMarker(t) {
    pushUndo(); const i = lb(S.markers, t);
    S.markers.splice(i, 0, t); S.conf.splice(i, 0, 1); S.selected = i; changed();
  }
  function delSelected() {
    if (S.selected < 0) return; pushUndo();
    S.markers.splice(S.selected, 1); S.conf.splice(S.selected, 1);
    S.selected = Math.min(S.selected, S.markers.length - 1); changed();
  }
  function selectRel(d) {
    if (!S.markers.length) return;
    let i = S.selected;
    if (i < 0) { i = lb(S.markers, audio.currentTime + 0.001) - (d < 0 ? 1 : 0); } else i += d;
    i = Math.max(0, Math.min(S.markers.length - 1, i));
    S.selected = i; seek(S.markers[i] - 0.4);
    const span = S.view[1] - S.view[0];
    if (S.markers[i] < S.view[0] || S.markers[i] > S.view[1]) setView(S.markers[i] - span / 2, S.markers[i] + span / 2);
    if (span > 40) setView(S.markers[i] - 8, S.markers[i] + 8);
    changed();
  }
  $('zFit').onclick = fitView; $('zIn').onclick = () => zoom(0.5); $('zOut').onclick = () => zoom(2);
  $('bAddM').onclick = () => addMarker(audio.currentTime);
  $('bDelM').onclick = delSelected; $('bUndo').onclick = undo;

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox' || tag === 'textarea' || tag === 'select') return;
    if (S.exporting) return;
    if (S.tapping) {
      if (e.code === 'Space' || e.key === 'Enter' || e.key === 't') { e.preventDefault(); if (!e.repeat) tap(); }
      else if (e.key === 'Escape') stopTap();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delSelected(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
      if (S.selected >= 0) {
        pushUndo(); const i = S.selected, lo = i > 0 ? S.markers[i - 1] + 0.05 : 0, hi = i < S.markers.length - 1 ? S.markers[i + 1] - 0.05 : S.duration;
        S.markers[i] = Math.max(lo, Math.min(hi, S.markers[i] + d)); S.conf[i] = 1; changed();
      } else seek(audio.currentTime + d * 100);
    }
    else if (e.key === ',') selectRel(-1);
    else if (e.key === '.') selectRel(1);
    else if (e.key === 'm') addMarker(audio.currentTime);
    else if (e.key === 'f') fitView();
    else if (e.key === 'Escape') { S.selected = -1; changed(); }
  });

  // ---------- style UI ----------
  const SWATCHES = ['#00ff00', '#00b140', '#0047bb', '#000000', '#ff00ff'];
  function syncStyleUI() {
    const s = S.style;
    $('sMantra').value = s.mantra; $('sSub').value = s.subMode; $('sSubText').value = s.subText; $('sDone').value = s.doneText;
    $('subCustomRow').style.display = s.subMode === 'custom' ? 'flex' : 'none';
    $('sNum').value = s.numerals; $('sCountAt').value = s.countAt; $('sOffset').value = s.offsetMs; $('offLbl').textContent = (s.offsetMs > 0 ? '+' : '') + s.offsetMs + ' ms';
    $('sRotate').value = s.rotate ? '1' : '0'; $('sPlate').checked = s.backplate; $('sGlow').checked = s.glow; $('sSparks').checked = s.sparks;
    $('sBg').value = s.bg;
    document.querySelectorAll('.th').forEach(el => el.classList.toggle('on', el.dataset.k === s.theme));
    document.querySelectorAll('.sw').forEach(el => el.classList.toggle('on', el.dataset.c.toLowerCase() === s.bg.toLowerCase()));
    $('pwrap').style.setProperty('--fsbg', s.bg);
    $('keyNote').textContent = s.backplate ? 'Medallion on = clean keying: glows sit on the disc, so only a crisp circle edge touches the screen colour.' : 'Without the medallion, keep Glow off for the cleanest key (soft glows blend into the screen colour).';
  }
  function styleChanged() { lsSet('njc:style', S.style); syncStyleUI(); S.dirtyPreview = true; changed(); }
  const th = $('themes');
  for (const [k, t] of Object.entries(Mala.THEMES)) {
    const d = document.createElement('div'); d.className = 'th'; d.dataset.k = k;
    d.innerHTML = `<i style="background:radial-gradient(circle at 35% 30%, ${t.on[0]}, ${t.off[1]} 60%, ${t.off[2]})"></i>${t.name}`;
    d.onclick = () => { S.style.theme = k; styleChanged(); }; th.appendChild(d);
  }
  const sws = $('swatches');
  for (const c of SWATCHES) { const d = document.createElement('div'); d.className = 'sw'; d.dataset.c = c; d.style.background = c; d.title = c; d.onclick = () => { S.style.bg = c; styleChanged(); }; sws.appendChild(d); }
  const bind = (id, key, fn) => $(id).addEventListener('input', () => { S.style[key] = fn($(id)); styleChanged(); });
  bind('sMantra', 'mantra', el => el.value); bind('sSubText', 'subText', el => el.value); bind('sDone', 'doneText', el => el.value);
  bind('sSub', 'subMode', el => el.value); bind('sNum', 'numerals', el => el.value); bind('sCountAt', 'countAt', el => el.value);
  bind('sOffset', 'offsetMs', el => +el.value); bind('sRotate', 'rotate', el => el.value === '1');
  bind('sPlate', 'backplate', el => el.checked); bind('sGlow', 'glow', el => el.checked); bind('sSparks', 'sparks', el => el.checked);
  bind('sBg', 'bg', el => el.value);
  syncStyleUI();

  // ---------- files ----------
  $('fileLine').onclick = () => $('fAudio').click();
  $('fAudio').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
  window.addEventListener('dragover', e => { e.preventDefault(); });
  window.addEventListener('drop', e => {
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
    if (/\.json$/i.test(f.name)) openProject(f); else loadFile(f);
  });
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  const baseName = () => (S.name || 'naam-jaap').replace(/\.[^.]+$/, '');
  $('bSaveProj').onclick = () => {
    const p = { app: 'naam-jaap-counter', version: 1, audioName: S.name, duration: S.duration, target: S.target, range: S.range, markers: S.markers, conf: S.conf, style: S.style };
    download(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }), baseName() + ' - jaap project.json');
  };
  $('bOpenProj').onclick = () => $('fProj').click();
  $('fProj').onchange = e => { const f = e.target.files[0]; if (f) openProject(f); e.target.value = ''; };
  async function openProject(f) {
    let p; try { p = JSON.parse(await f.text()); } catch (e) { alert('That file is not a Naam Jaap project.'); return; }
    if (!p || p.app !== 'naam-jaap-counter') { alert('That file is not a Naam Jaap project.'); return; }
    if (p.style) { S.style = Object.assign({}, DEFAULT_STYLE, p.style); styleChanged(); }
    if (loaded() && Math.abs(p.duration - S.duration) < 1) {
      S.target = p.target || 108; $('nTarget').value = S.target; S.range = p.range || [0, S.duration]; syncRange();
      setMarkers(p.markers || [], p.conf); fitView();
    } else {
      S.pendingProject = p;
      $('fileNote').className = 'note hi';
      $('fileNote').textContent = `Project loaded. Now open its audio: “${p.audioName}”.`;
      $('fAudio').click();
    }
  }
  $('bPng').onclick = async () => {
    const W = +$('eSize').value, c = document.createElement('canvas'); c.width = c.height = W;
    await document.fonts.ready;
    Mala.createRenderer(W).draw(c.getContext('2d'), curTime(), model(), S.style);
    c.toBlob(b => download(b, baseName() + ' - counter frame.png'), 'image/png');
  };
  $('bHelp').onclick = () => $('help').style.display = 'flex';
  $('bHelpClose').onclick = () => $('help').style.display = 'none';
  $('help').onclick = e => { if (e.target.id === 'help') $('help').style.display = 'none'; };

  // full-screen stage (for live capture)
  $('bFull').onclick = () => { const w = $('pwrap'); if (w.requestFullscreen) w.requestFullscreen(); };
  document.addEventListener('fullscreenchange', () => {
    const fs = !!document.fullscreenElement; $('pwrap').classList.toggle('fs', fs);
    setPreviewSize(fs ? Math.round(Math.min(screen.width, screen.height) * (window.devicePixelRatio || 1)) : 720);
  });

  // ---------- export ----------
  let cancelExport = false;
  $('bCancel').onclick = () => { cancelExport = true; };
  $('bExport').onclick = async () => {
    if (!loaded() || S.exporting) return;
    if (!('VideoEncoder' in window)) { alert('This browser cannot encode video. Please open the app in Google Chrome.'); return; }
    if (S.markers.length !== S.target && !confirm(`There are ${S.markers.length} markers but the count is set to ${S.target}. Export anyway?`)) return;
    const W = +$('eSize').value, fps = +$('eFps').value, withAudio = $('eAudio').checked;
    const fileName = baseName() + ' - jaap counter.mp4';
    let handle = null, stream = null;
    if (window.showSaveFilePicker) {
      try { handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] }); }
      catch (e) { if (e.name === 'AbortError') return; handle = null; }
    }
    S.exporting = true; cancelExport = false; audio.pause();
    const bar = $('exBar'), note = $('exNote'); bar.style.display = 'block'; bar.firstChild.style.width = '0%';
    $('bExport').disabled = true; $('bCancel').style.display = '';
    note.className = 'note'; note.textContent = 'Preparing…';
    let encoder = null, aenc = null;
    try {
      await document.fonts.ready;
      // video codec
      const bitrate = { 720: 5e6, 1080: 9e6, 1440: 14e6, 2160: 26e6 }[W] || 9e6;
      let vcfg = null;
      for (const codec of ['avc1.640033', 'avc1.4d0033', 'avc1.640028', 'avc1.42e033', 'avc1.42001f']) {
        const cfg = { codec, width: W, height: W, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
        try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) { vcfg = cfg; break; } } catch (e) { }
      }
      if (!vcfg) throw new Error('H.264 encoding is not available at this size in this browser. Try a smaller size, or use Google Chrome.');
      // audio
      let abuf = null, acfg = null;
      if (withAudio && 'AudioEncoder' in window) {
        note.textContent = 'Preparing audio…';
        try {
          abuf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await S.file.arrayBuffer());
          const ch = Math.min(2, abuf.numberOfChannels);
          acfg = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: ch, bitrate: 192000 };
          const r = await AudioEncoder.isConfigSupported(acfg);
          if (!r.supported) { acfg = null; abuf = null; }
        } catch (e) { acfg = null; abuf = null; }
      }
      const target = handle ? new Mp4Muxer.FileSystemWritableFileStreamTarget(stream = await handle.createWritable()) : new Mp4Muxer.ArrayBufferTarget();
      const muxer = new Mp4Muxer.Muxer({
        target, fastStart: handle ? false : 'in-memory', firstTimestampBehavior: 'offset',
        video: { codec: 'avc', width: W, height: W, frameRate: fps },
        audio: acfg ? { codec: 'aac', sampleRate: 48000, numberOfChannels: acfg.numberOfChannels } : undefined
      });
      let encErr = null;
      encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
      encoder.configure(vcfg);
      let aPos = 0;
      const aLen = abuf ? abuf.length : 0;
      if (acfg) { aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { encErr = e; } }); aenc.configure(acfg); }
      const feedAudio = until => {
        if (!aenc) return;
        const end = Math.min(aLen, Math.floor(until * 48000));
        while (aPos < end) {
          const n = Math.min(4800, end - aPos), ch = acfg.numberOfChannels, data = new Float32Array(n * ch);
          for (let c = 0; c < ch; c++) data.set(abuf.getChannelData(c).subarray(aPos, aPos + n), c * n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(aPos / 48000 * 1e6), data });
          aenc.encode(ad); ad.close(); aPos += n;
        }
      };
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = W;
      const ctx = canvas.getContext('2d', { alpha: false });
      const R = Mala.createRenderer(W), M = model(), st = Object.assign({}, S.style);
      const frames = Math.ceil(S.duration * fps), t0 = performance.now();
      for (let f = 0; f < frames; f++) {
        if (cancelExport) throw new Error('cancelled');
        if (encErr) throw encErr;
        const t = f / fps;
        R.draw(ctx, t, M, st);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
        encoder.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
        feedAudio(t + 1);
        if (encoder.encodeQueueSize > 6 || f % 20 === 0) {
          while (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1));
          await new Promise(r => setTimeout(r, 0));
          const p = (f + 1) / frames, el = (performance.now() - t0) / 1000, left = el / p - el;
          bar.firstChild.style.width = (p * 100).toFixed(1) + '%';
          note.textContent = `Rendering ${Math.round(p * 100)}% · frame ${f + 1} of ${frames} · about ${fmt(left, 0)} left`;
        }
      }
      feedAudio(S.duration + 1);
      note.textContent = 'Finishing…';
      await encoder.flush(); if (aenc) await aenc.flush();
      if (encErr) throw encErr;
      muxer.finalize();
      if (handle) { await stream.close(); note.className = 'note hi'; note.textContent = `Saved “${handle.name}”` + (withAudio && !acfg ? ' (audio could not be added in this browser, video only).' : '.'); }
      else { download(new Blob([target.buffer], { type: 'video/mp4' }), fileName); note.className = 'note hi'; note.textContent = 'Done. Check your Downloads folder.' + (withAudio && !acfg ? ' (Audio could not be added in this browser, video only.)' : ''); }
      bar.firstChild.style.width = '100%';
    } catch (e) {
      try { if (stream) await stream.abort(); } catch (_) { }
      note.className = 'note bad';
      note.textContent = e && e.message === 'cancelled' ? 'Export cancelled.' : 'Export failed: ' + (e && e.message || e);
      console.error(e);
    } finally {
      try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (_) { }
      try { if (aenc && aenc.state !== 'closed') aenc.close(); } catch (_) { }
      S.exporting = false; $('bExport').disabled = false; $('bCancel').style.display = 'none';
      setTimeout(() => { bar.style.display = 'none'; }, 1500);
    }
  };

  // ---------- main loop ----------
  let lastT = -1;
  function loop() {
    const t = curTime();
    if (!S.exporting) {
      if (t !== lastT || S.dirtyPreview || !loaded()) { pr.draw(pctx, t, model(), S.style); S.dirtyPreview = false; }
      if (loaded() && !audio.paused) {
        const span = S.view[1] - S.view[0];
        if (t > S.view[1] - span * 0.02 || t < S.view[0]) setView(t - span * 0.1, t + span * 0.9);
        S.dirtyTl = true;
      }
      if (S.dirtyTl || t !== lastT) { drawTl(); S.dirtyTl = false; }
      $('time').textContent = loaded() ? `${fmt(t, 1)} / ${fmt(S.duration, 1)}` : 'demo';
    }
    lastT = t;
    requestAnimationFrame(loop);
  }
  resizeTl(); updateChip();
  if (document.fonts && document.fonts.load) { document.fonts.load('700 40px Cinzel'); document.fonts.load('40px "Tiro Devanagari Hindi"'); document.fonts.ready.then(() => S.dirtyPreview = true); }
  requestAnimationFrame(loop);
  window.__njc = { S, loadFile, runDetect, model };
})();
