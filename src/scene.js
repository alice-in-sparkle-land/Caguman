'use strict';
/* ===== scene.js — Ghibli themes and the misty-hills header (drawn once as an <img>) ===== */
const THEMES = {
  earth:  { name: 'Đất',  sky: ['#EBC9A0', '#F7E9D4'], r: ['#E2B88E', '#CF946A', '#B0704C', '#7E4A33'], sun: '#C8452C', ac: '#B0532A', ac2: '#C99230' },
  forest: { name: 'Rừng', sky: ['#C9DFCB', '#EFF4E7'], r: ['#AECBA8', '#84AC82', '#5C8C61', '#3B6948'], sun: '#FFFDF4', ac: '#3B7A4D', ac2: '#C6613A' },
  sea:    { name: 'Biển', sky: ['#B8DCE8', '#EDF6F4'], r: ['#A3CEDC', '#74B2C8', '#4690B0', '#256A8C'], sun: '#FFFFFF', ac: '#1D7898', ac2: '#E0784E' },
  wind:   { name: 'Gió',  sky: ['#CFDBF0', '#F4F2F8'], r: ['#C3CEE6', '#A6B4D7', '#8894C2', '#6772A6'], sun: '#FFFFFF', ac: '#4569B3', ac2: '#D9A32E' }
};
const PHASES = {
  dawn:  { sky: ['#EDB9AC', '#FAE3CF'], tint: '#F2B3A0', k: 0.22 },
  dusk:  { sky: ['#D98A7E', '#F4C9A6'], tint: '#6A3E62', k: 0.42 },
  night: { sky: ['#16203D', '#34406A'], tint: '#111933', k: 0.66 }
};
function phaseOf(h) {
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 16) return 'day';
  if (h >= 16 && h < 19) return 'dusk';
  return 'night';
}
function rng(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function mix(c1, c2, k) {
  const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
function ridge(yBase, amp, seed, freq, W = 800, H = 440) {
  const r = rng(seed), p = [r() * 6, r() * 6];
  let d = `M0 ${H} L`;
  for (let x = 0; x <= W; x += 5) {
    const y = yBase - amp * (0.7 * Math.sin(x * freq + p[0]) + 0.3 * Math.sin(x * freq * 2.1 + p[1]));
    d += `${x} ${y.toFixed(1)} L`;
  }
  return d + `${W} ${H}Z`;
}
function sceneSrc(theme, phase) {
  const T = THEMES[theme], P = PHASES[phase];
  const sky = P ? P.sky : T.sky, ridges = T.r.map(c => P ? mix(c, P.tint, P.k) : c);
  const R = [[246, 26, .0085], [286, 22, .011], [326, 18, .014], [366, 14, .018]];
  const mistOp = phase === 'night' ? .12 : .35;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 440" preserveAspectRatio="xMidYMax slice">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>` +
    `<linearGradient id="m" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="${mistOp}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="800" height="440" fill="url(#s)"/>`;
  if (phase === 'night') {
    const r = rng(11);
    for (let i = 0; i < 46; i++) s += `<circle cx="${(r() * 800).toFixed(0)}" cy="${(r() * 210).toFixed(0)}" r="${(r() * 1.3 + .4).toFixed(1)}" fill="#fff" opacity="${(r() * .5 + .35).toFixed(2)}"/>`;
    s += `<circle cx="610" cy="110" r="26" fill="#F4F1E4"/><circle cx="622" cy="102" r="23" fill="${sky[0]}"/>`;
  } else {
    const cy = phase === 'day' ? 120 : 172, sun = phase === 'day' ? T.sun : phase === 'dawn' ? '#FFF1E2' : '#F6B486';
    s += `<circle cx="600" cy="${cy}" r="34" fill="${sun}"/>`;
    if (phase !== 'dusk') [[520, 90], [540, 80], [556, 96]].forEach(([x, y]) => { s += `<path d="M${x} ${y}q5 -5 10 0q5 -5 10 0" stroke="#3a3a3a" stroke-opacity=".45" fill="none" stroke-width="1.6"/>`; });
  }
  R.forEach(([y, a, f], i) => {
    s += `<path d="${ridge(y, a, i * 7 + 3, f)}" fill="${ridges[i]}"/>`;
    if (i < 3) s += `<rect x="0" y="${y + a - 10}" width="800" height="40" fill="url(#m)"/>`;
  });
  return 'data:image/svg+xml,' + encodeURIComponent(s + '</svg>');
}
