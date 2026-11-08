/* 落地页：只读预览图 + 当前读数 */
(function () {
  'use strict';
  var D = window.BT;
  if (!D) return;
  var S = D.series, N = S.dates.length;
  var NS = 'http://www.w3.org/2000/svg';
  var UP = '#c0392b', DN = '#16785a';
  function el(t, a) { var e = document.createElementNS(NS, t); for (var k in a) if (a[k] !== null && a[k] !== undefined) e.setAttribute(k, a[k]); return e; }
  function tempColor(v) { return v < 20 ? '#1d6b4d' : v < 40 ? '#4d9575' : v < 60 ? '#9aa1a8' : v < 80 ? '#d17259' : '#b0362a'; }

  document.getElementById('asof').textContent = D.meta.end;
  document.getElementById('footGen').textContent = '生成于 ' + D.meta.generated;

  var c = D.current;
  var tEl = document.getElementById('curTemp');
  tEl.textContent = c.temp.toFixed(1);
  tEl.style.color = tempColor(c.temp);

  var chg = document.getElementById('curChg');
  chg.textContent = (c.chg1 > 0 ? '+' : '') + c.chg1.toFixed(1) + ' / 日';
  chg.style.color = c.chg1 >= 0 ? UP : DN;

  document.getElementById('curPe').textContent = (c.pe ? c.pe.toFixed(2) : '—') + ' / ' +
    (c.erp ? c.erp.toFixed(2) + '%' : '—');

  /* ---- 预览图 ---- */
  var SHOW = Math.min(500, N);
  var s0 = N - SHOW;
  var dates = S.dates.slice(s0), O = S.open_px.slice(s0), H = S.high_px.slice(s0),
      L = S.low_px.slice(s0), C = S.bench_px.slice(s0), T = S.temp.slice(s0);

  var host = document.getElementById('pvChart');
  var W = host.clientWidth || 1200, H0 = 322;
  var P = { l: 26, r: 52, t: 12, b: 20 };
  var iw = W - P.l - P.r;
  var tempH = 84, gap = 22;
  var mainH = H0 - P.t - P.b - tempH - gap;
  var n = dates.length, bw = iw / n;

  var lo = Math.min.apply(null, L), hi = Math.max.apply(null, H);
  var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  var Y = function (v) { return P.t + mainH * (1 - (v - lo) / (hi - lo)); };
  var X = function (i) { return P.l + bw * (i + 0.5); };
  var yT0 = P.t + mainH + gap;
  var YT = function (v) { return yT0 + tempH * (1 - v / 100); };

  var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H0, width: '100%', height: H0 });

  for (var g = 1; g <= 3; g++) {
    var gv = lo + (hi - lo) * g / 3, gy = Y(gv);
    svg.appendChild(el('line', { x1: P.l, y1: gy, x2: P.l + iw, y2: gy, stroke: '#f5f6f7' }));
    var gt = el('text', { x: P.l + iw + 6, y: gy + 3.4, fill: '#b3b9be', 'font-size': 10 });
    gt.textContent = gv.toFixed(2); svg.appendChild(gt);
  }

  var cw = Math.max(1, bw * 0.62);
  for (var i = 0; i < n; i++) {
    var up = C[i] >= O[i], col = up ? UP : DN, x = X(i);
    svg.appendChild(el('line', { x1: x, y1: Y(H[i]), x2: x, y2: Y(L[i]), stroke: col, 'stroke-width': Math.min(1, cw) }));
    var y1 = Y(Math.max(O[i], C[i])), y2 = Y(Math.min(O[i], C[i]));
    svg.appendChild(el('rect', { x: x - cw / 2, y: y1, width: cw, height: Math.max(1, y2 - y1), fill: col }));
  }

  // MA20 / MA60
  [[20, '#d99a2b'], [60, '#3c5a9a']].forEach(function (m) {
    var d = '', started = false;
    for (var i = 0; i < n; i++) {
      var gi = s0 + i;
      if (gi < m[0] - 1) { started = false; continue; }
      var sum = 0;
      for (var k = 0; k < m[0]; k++) sum += S.bench_px[gi - k];
      d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(sum / m[0]).toFixed(1);
      started = true;
    }
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: m[1], 'stroke-width': 1.1, 'vector-effect': 'non-scaling-stroke' }));
  });

  // 温度带
  svg.appendChild(el('rect', { x: P.l, y: YT(35), width: iw, height: YT(0) - YT(35), fill: 'rgba(22,120,90,.055)' }));
  svg.appendChild(el('rect', { x: P.l, y: YT(100), width: iw, height: YT(70) - YT(100), fill: 'rgba(192,57,43,.06)' }));
  var dT = '', st = false;
  for (var j = 0; j < n; j++) {
    if (T[j] === null) { st = false; continue; }
    dT += (st ? 'L' : 'M') + X(j).toFixed(1) + ' ' + YT(T[j]).toFixed(1);
    st = true;
  }
  svg.appendChild(el('path', { d: dT, fill: 'none', stroke: '#5f666d', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
  [0, 50, 100].forEach(function (v) {
    var t = el('text', { x: P.l - 6, y: YT(v) + 3.2, 'text-anchor': 'end', fill: '#c2c7cc', 'font-size': 9 });
    t.textContent = v; svg.appendChild(t);
  });
  var lbl = el('text', { x: P.l + iw + 6, y: yT0 + 10, fill: '#b9bfc4', 'font-size': 9.5 });
  lbl.textContent = '温度'; svg.appendChild(lbl);

  var xt = 8;
  for (var q = 0; q < xt; q++) {
    var idx = Math.round((n - 1) * q / (xt - 1));
    var tb = el('text', { x: X(idx), y: H0 - 5, fill: '#b3b9be', 'font-size': 10,
      'text-anchor': q === 0 ? 'start' : (q === xt - 1 ? 'end' : 'middle') });
    tb.textContent = dates[idx].slice(0, 7);
    svg.appendChild(tb);
  }
  host.appendChild(svg);
})();
