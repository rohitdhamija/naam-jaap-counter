/* Jaap detection engine: finds exactly N chant starts in an audio track.
 * 1. Spectral flux (SuperFlux style) + loudness rise after a pause -> onset strength curve
 * 2. Peak picking -> candidate onsets
 * 3. A first, evenly-paced pass learns what one chant start sounds like (spectral fingerprint)
 * 4. Every onset is re-scored by that fingerprint and dynamic programming picks exactly N of them,
 *    allowing pauses / music interludes between chants (chants need not be evenly spaced),
 *    then a final pass follows gradual speed-ups / slow-downs.
 */
(function (root) {
  'use strict';

  function makeFFT(n) {
    const levels = Math.log2(n) | 0;
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = Math.sin(2 * Math.PI * i / n); }
    return function (re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const a = j + half;
            const tre = re[a] * cs[k] + im[a] * sn[k];
            const tim = im[a] * cs[k] - re[a] * sn[k];
            re[a] = re[j] - tre; im[a] = im[j] - tim;
            re[j] += tre; im[j] += tim;
          }
        }
      }
    };
  }

  function percentile(arr, p) {
    const a = Float32Array.from(arr).sort();
    if (!a.length) return 0;
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  }

  const tick = () => new Promise(r => setTimeout(r, 0));

  /** x: mono Float32Array, sr: sample rate (~22050 recommended) */
  async function computeFeatures(x, sr, onProgress) {
    const hop = Math.round(sr / 100);
    const fps = sr / hop;
    const n = sr > 32000 ? 2048 : 1024;
    const fft = makeFFT(n);
    const nFrames = Math.max(1, Math.floor(x.length / hop));
    const kLo = Math.max(1, Math.round(60 * n / sr));
    const kHi = Math.min(n / 2 - 1, Math.round(5000 * n / sr));
    const nb = kHi - kLo + 1;
    const win = new Float32Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    const re = new Float64Array(n), im = new Float64Array(n);
    const ring = [new Float32Array(nb), new Float32Array(nb), new Float32Array(nb)];
    const flux = new Float32Array(nFrames), edb = new Float32Array(nFrames);
    const NB = 24, bands = new Float32Array(nFrames * NB), bEdge = [];
    for (let b = 0; b <= NB; b++) bEdge.push(Math.max(kLo, Math.min(kHi + 1, Math.round(80 * Math.pow(5000 / 80, b / NB) * n / sr))));
    for (let b = 0; b < NB; b++) if (bEdge[b + 1] <= bEdge[b]) bEdge[b + 1] = bEdge[b] + 1;
    const norm = 4 / n;
    for (let f = 0; f < nFrames; f++) {
      const start = f * hop - (n >> 1);
      let e = 0;
      for (let i = 0; i < n; i++) {
        const idx = start + i;
        const v = (idx >= 0 && idx < x.length) ? x[idx] * win[i] : 0;
        re[i] = v; im[i] = 0; e += v * v;
      }
      edb[f] = 10 * Math.log10(e / n + 1e-10);
      fft(re, im);
      const S = ring[f % 3];
      for (let k = 0; k < nb; k++) {
        const kk = k + kLo;
        const amp = Math.sqrt(re[kk] * re[kk] + im[kk] * im[kk]) * norm;
        S[k] = Math.log1p(1000 * amp);
      }
      for (let b = 0; b < NB; b++) {
        let pw = 0;
        for (let kk = bEdge[b]; kk < bEdge[b + 1] && kk < n / 2; kk++) pw += (re[kk] * re[kk] + im[kk] * im[kk]);
        bands[f * NB + b] = Math.log(1e-6 + pw * norm * norm);
      }
      if (f >= 2) {
        const P = ring[(f - 2) % 3];
        let s = 0;
        for (let k = 0; k < nb; k++) {
          let m = P[k];
          if (k > 0 && P[k - 1] > m) m = P[k - 1];
          if (k < nb - 1 && P[k + 1] > m) m = P[k + 1];
          const d = S[k] - m;
          if (d > 0) s += d;
        }
        flux[f] = s / nb;
      }
      if ((f & 2047) === 2047) { if (onProgress) onProgress(f / nFrames); await tick(); }
    }
    if (onProgress) onProgress(1);
    const feat = { fps, hop, sr, nFrames, flux, edb, bands, NB };
    feat.onset = buildOnset(feat);
    return feat;
  }

  function buildOnset(feat) {
    const { flux, edb, nFrames } = feat;
    const cs = new Float64Array(nFrames + 1);
    for (let i = 0; i < nFrames; i++) cs[i + 1] = cs[i] + edb[i];
    const mean = (a, b) => { a = Math.max(0, a); b = Math.min(nFrames, b); return b > a ? (cs[b] - cs[a]) / (b - a) : -100; };
    const floor = percentile(edb, 0.1);
    const rise = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      const after = mean(i, i + 12), before = mean(i - 25, i - 2);
      let r = after - before;
      if (r < 0) r = 0;
      const gate = Math.min(1, Math.max(0, (after - floor - 3) / 12));
      rise[i] = r * gate;
    }
    const fN = percentile(flux, 0.99) || 1, rN = percentile(rise, 0.99) || 1;
    const raw = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      const after = mean(i, i + 12);
      const gate = Math.min(1, Math.max(0, (after - floor - 3) / 12));
      raw[i] = 0.5 * Math.min(2, flux[i] / fN) * gate + 0.5 * Math.min(2, rise[i] / rN);
    }
    // light gaussian smoothing
    const ker = [0.06, 0.24, 0.4, 0.24, 0.06];
    const o = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < nFrames) s += ker[k + 2] * raw[j]; }
      o[i] = s;
    }
    return o;
  }

  function findCandidates(onset, fps, t0, t1) {
    const f0 = Math.max(0, Math.floor(t0 * fps)), f1 = Math.min(onset.length - 1, Math.ceil(t1 * fps));
    let mx = 0;
    for (let i = f0; i <= f1; i++) if (onset[i] > mx) mx = onset[i];
    const thr = mx * 0.03, W = 6, out = [];
    for (let i = f0; i <= f1; i++) {
      const v = onset[i];
      if (v < thr) continue;
      let ok = true;
      for (let k = -W; k <= W && ok; k++) {
        const j = i + k;
        if (k === 0 || j < 0 || j >= onset.length) continue;
        if (onset[j] > v || (onset[j] === v && j < i)) ok = false;
      }
      if (ok) out.push({ t: i / fps, s: v });
    }
    return out;
  }

  function estimatePeriod(onset, fps, t0, t1, P0) {
    const f0 = Math.floor(t0 * fps), f1 = Math.min(onset.length, Math.floor(t1 * fps));
    const seg = onset.subarray(f0, f1);
    let m = 0; for (let i = 0; i < seg.length; i++) m += seg[i]; m /= (seg.length || 1);
    const lo = Math.max(2, Math.floor(0.4 * P0 * fps)), hi = Math.min(seg.length - 1, Math.ceil(1.2 * P0 * fps));
    let best = P0, bestV = -Infinity;
    for (let L = lo; L <= hi; L++) {
      let s = 0;
      for (let i = 0; i + L < seg.length; i++) s += (seg[i] - m) * (seg[i + L] - m);
      s /= (seg.length - L);
      const prior = Math.exp(-0.5 * Math.pow(Math.log(L / fps / P0) / 0.25, 2));
      const v = s * (0.6 + 0.4 * prior);
      if (v > bestV) { bestV = v; best = L / fps; }
    }
    return best;
  }

  function lowerBound(arr, t) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return lo; }

  /** Expected-gap cost. x = gap / expected period. Close to 1 = cheap; much shorter = expensive;
   *  much longer = a "rest" (music interlude, breath, pause): a flat fee plus a gentle slope,
   *  so the singer is allowed to pause without the detector inventing chants inside the pause. */
  function gapCostFn(lam, rest) {
    const R = 1.4, base = Math.log(R) * Math.log(R);
    return x => {
      if (x <= R) { const l = Math.log(x); return lam * l * l * (x < 1 ? 1.6 : 1); }
      // the pause fee does not grow with "steady": a steady singer can still stop for music
      return Math.min(lam, 1) * base + rest + 0.12 * Math.log(x / R);
    };
  }

  function dpSelect(c, N, Pfn, cost, gapLo, gapHi, ends) {
    const M = c.length;
    if (M < N) return null;
    const ts = c.map(x => x.t);
    const NEG = -1e18;
    let prev = new Float64Array(M), cur = new Float64Array(M);
    const back = new Int32Array(N * M).fill(-1);
    for (let i = 0; i < M; i++) prev[i] = c[i].s - (ends ? ends.startPen(ts[i]) : 0);
    for (let k = 1; k < N; k++) {
      cur.fill(NEG);
      for (let i = k; i < M; i++) {
        const P = Pfn(ts[i]);
        const jLo = lowerBound(ts, ts[i] - gapHi * P);
        const jHiT = ts[i] - gapLo * P;
        let best = NEG, bj = -1;
        for (let j = jLo; j < i && ts[j] <= jHiT; j++) {
          if (prev[j] <= NEG) continue;
          const v = prev[j] - cost((ts[i] - ts[j]) / P);
          if (v > best) { best = v; bj = j; }
        }
        if (bj >= 0) { cur[i] = best + c[i].s; back[k * M + i] = bj; }
      }
      const t = prev; prev = cur; cur = t;
    }
    let bi = -1, bv = NEG;
    for (let i = 0; i < M; i++) { const v = prev[i] - (ends ? ends.endPen(ts[i]) : 0); if (prev[i] > NEG / 2 && v > bv) { bv = v; bi = i; } }
    if (bi < 0 || bv <= NEG / 2) return null;
    const idx = new Array(N);
    for (let k = N - 1; k >= 0; k--) { idx[k] = bi; bi = back[k * M + bi]; }
    return idx;
  }

  function runningMedian(a, w) {
    const out = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
      const s = a.slice(Math.max(0, i - w), Math.min(a.length, i + w + 1)).sort((x, y) => x - y);
      out[i] = s[s.length >> 1];
    }
    return out;
  }

  function fingerprint(feat, t, P) {
    const { bands, NB, fps, nFrames } = feat;
    const post = Math.min(0.55 * P, 1.4), pre = Math.min(0.2, 0.15 * P);
    const wins = [[-pre, 0]];
    const K = 6;
    for (let k = 0; k < K; k++) wins.push([post * k / K, post * (k + 1) / K]);
    const v = new Float32Array(wins.length * NB);
    wins.forEach(([a, b], w) => {
      const f0 = Math.max(0, Math.round((t + a) * fps)), f1 = Math.min(nFrames, Math.max(f0 + 1, Math.round((t + b) * fps)));
      for (let f = f0; f < f1; f++) for (let q = 0; q < NB; q++) v[w * NB + q] += bands[f * NB + q] / (f1 - f0);
    });
    let m = 0; for (let i = 0; i < v.length; i++) m += v[i]; m /= v.length;
    let nn = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; nn += v[i] * v[i]; }
    nn = Math.sqrt(nn) || 1; for (let i = 0; i < v.length; i++) v[i] /= nn;
    return v;
  }

  function rescoreByTemplate(feat, cands, chosenIdx, P, fpCache) {
    const fps = fpCache || cands.map(c => fingerprint(feat, c.t, P));
    const L = fps[0].length;
    const build = list => {
      const tpl = new Float32Array(L);
      list.forEach(i => { for (let q = 0; q < L; q++) tpl[q] += fps[i][q]; });
      let nn = 0; for (let q = 0; q < L; q++) nn += tpl[q] * tpl[q]; nn = Math.sqrt(nn) || 1;
      for (let q = 0; q < L; q++) tpl[q] /= nn;
      return tpl;
    };
    const dot = (a, b) => { let d = 0; for (let q = 0; q < L; q++) d += a[q] * b[q]; return d; };
    // robust template: average the chosen set, then keep only the 65% that look most alike and average again,
    // so a few wrongly chosen spots (music, drums) do not blur what a chant sounds like
    let tpl = build(chosenIdx);
    const ranked = chosenIdx.slice().sort((a, b) => dot(fps[b], tpl) - dot(fps[a], tpl));
    tpl = build(ranked.slice(0, Math.max(2, Math.round(ranked.length * 0.65))));
    const smax = cands.reduce((a, c) => Math.max(a, c.raw ?? c.s), 0) || 1;
    const out = cands.map((c, i) => {
      const sim = dot(fps[i], tpl), raw = c.raw ?? c.s;
      return { t: c.t, s: 0.35 * raw / smax + 1.2 * Math.max(-0.2, sim), raw, sim };
    });
    out.fps = fps;
    return out;
  }

  /** opts: {count, start, end, steadiness (0.2..3)} -> {times, conf, period} */
  function detect(feat, opts) {
    const N = Math.max(1, opts.count | 0);
    const A = Math.max(0, opts.start || 0);
    const B = Math.min(feat.nFrames / feat.fps, opts.end || feat.nFrames / feat.fps);
    const lam = opts.steadiness == null ? 1 : opts.steadiness;
    const span = B - A;
    if (span <= 0) throw new Error('Selected range is empty');
    const P0 = span / N;
    let cands = findCandidates(feat.onset, feat.fps, A, B);
    if (N === 1) {
      const best = cands.reduce((a, b) => (b.s > a.s ? b : a), cands[0] || { t: A, s: 0 });
      return { times: [best.t], conf: [1], period: span };
    }
    const P = estimatePeriod(feat.onset, feat.fps, A, B, P0);
    // where does sound start/end inside the range? (soft, capped anchors)
    const fA = Math.floor(A * feat.fps), fB = Math.min(feat.nFrames, Math.floor(B * feat.fps));
    const seg = feat.edb.subarray(fA, fB);
    const lo10 = percentile(seg, 0.1), hi90 = percentile(seg, 0.9), thr = lo10 + 0.5 * (hi90 - lo10);
    let vs = 0, ve = seg.length - 1;
    while (vs < seg.length - 1 && seg[vs] < thr) vs++;
    while (ve > 0 && seg[ve] < thr) ve--;
    const vStart = A + vs / feat.fps, vEnd = A + ve / feat.fps;
    const ends = {
      startPen: t => Math.min(0.8, 2 * Math.pow((t - vStart) / P, 2)),
      endPen: t => { const r = (vEnd - t) / (0.8 * P); return r <= 0.05 ? 0.8 : Math.min(0.8, 3 * Math.pow(Math.log(r), 2)); }
    };
    // pass 1: assume steady pacing, only to learn what one chant sounds like
    const steadyCost = x => { const l = Math.log(x); return lam * l * l; };
    let idx = null;
    for (const [lo, hi] of [[0.35, 2.8], [0.25, 4], [0.15, 6]]) {
      idx = dpSelect(cands, N, () => P, steadyCost, lo, hi, ends);
      if (idx) break;
    }
    if (!idx) {
      // not enough onsets in the audio: fall back to even spacing
      const times = []; for (let k = 0; k < N; k++) times.push(A + k * P0);
      return { times, conf: times.map(() => 0), period: P0, fallback: true };
    }
    // pass 2+: score every onset by how much it sounds like a chant start, then choose N of them while
    // allowing pauses and music interludes between chants (chants need not come at a regular interval)
    const cost = gapCostFn(lam, 0.3);
    const gapHi = Math.max(6, Math.min(span, 60) / P);
    let res = null, fpc = null;
    for (let it = 0; it < 4; it++) {
      res = rescoreByTemplate(feat, cands, idx, P, fpc); fpc = res.fps;
      const idx2 = dpSelect(res, N, () => P, cost, 0.5, gapHi, ends) || dpSelect(res, N, () => P, cost, 0.3, gapHi, ends);
      if (!idx2) break;
      const same = idx2.every((v, k) => v === idx[k]);
      idx = idx2;
      if (same) break;
    }
    if (res) cands = res;
    let times = idx.map(i => cands[i].t);
    const isRest = g => g > 1.5 * P;
    // final pass: let the expected gap follow the singer's tempo drift (ignoring pauses)
    if (N >= 8) {
      const gaps = [], mids = [];
      for (let k = 0; k < N - 1; k++) { const g = times[k + 1] - times[k]; if (!isRest(g)) { gaps.push(g); mids.push((times[k] + times[k + 1]) / 2); } }
      if (gaps.length >= 4) {
        const sm = runningMedian(gaps, 5);
        const Pfn = (t) => {
          if (t <= mids[0]) return sm[0];
          if (t >= mids[mids.length - 1]) return sm[sm.length - 1];
          const j = lowerBound(mids, t);
          const a = mids[j - 1], b = mids[j], u = (t - a) / (b - a);
          return sm[j - 1] * (1 - u) + sm[j] * u;
        };
        const idx2 = dpSelect(cands, N, Pfn, cost, 0.5, gapHi, ends);
        if (idx2) { idx = idx2; times = idx.map(i => cands[i].t); }
      }
    }
    const strengths = idx.map(i => cands[i].s);
    const med = strengths.slice().sort((a, b) => a - b)[N >> 1] || 1;
    const gapsAll = []; for (let k = 0; k < N - 1; k++) gapsAll.push(times[k + 1] - times[k]);
    const regular = gapsAll.filter(g => !isRest(g)).sort((a, b) => a - b);
    const Pm = regular[regular.length >> 1] || P;
    const conf = times.map((t, k) => {
      let c = Math.min(1, strengths[k] / (0.7 * med));
      const g1 = k > 0 ? gapsAll[k - 1] : Pm, g2 = k < N - 1 ? gapsAll[k] : Pm;
      // a too-short gap is suspicious; a long gap is just a pause
      if (Math.min(g1, g2) < 0.7 * Pm) c *= 0.5;
      return c;
    });
    const rests = gapsAll.filter(isRest).length;
    return { times, conf, period: Pm, rests };
  }

  /** move each time to the strongest nearby onset peak (for tapped markers) */
  function snap(feat, times, win) {
    win = win || 0.3;
    const { onset, fps } = feat;
    return times.map(t => {
      const f0 = Math.max(0, Math.floor((t - win) * fps)), f1 = Math.min(onset.length - 1, Math.ceil((t + win * 0.6) * fps));
      let best = -1, bv = 0;
      for (let f = f0; f <= f1; f++) {
        const isPeak = (f === 0 || onset[f] >= onset[f - 1]) && (f === onset.length - 1 || onset[f] >= onset[f + 1]);
        if (!isPeak) continue;
        const d = (f / fps - t) / win;
        const v = onset[f] * (1 - 0.5 * d * d);
        if (v > bv) { bv = v; best = f; }
      }
      return best >= 0 ? best / fps : t;
    });
  }

  const api = { computeFeatures, detect, snap, findCandidates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JaapDetect = api;
})(typeof window !== 'undefined' ? window : globalThis);
