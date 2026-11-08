/* 贪恐指数 · 市场雷达
   数据层在 Python 侧算完（因子、温度、回测），前端只做展示，
   以及"同逻辑重算"——拖阈值时在浏览器里复现完全一致的状态机。 */
(function () {
  'use strict';

  var D = window.BT;
  if (!D) { document.body.innerHTML = '<p style="padding:40px">数据未加载</p>'; return; }

  var S = D.series, N = S.dates.length;
  var COST = 0.0003, FIVE_START = '2021-11-05';
  var UP = '#c0392b', DN = '#16785a', GRAY = '#bcc2c7', BLUE = '#3c5a9a';
  var NS = 'http://www.w3.org/2000/svg';

  var ST = { buy: D.default.buy, sell: D.default.sell, period: 'full', tf: 'd', ma: { 20: true, 60: true, 120: false }, hm: 'cagr' };

  /* ---------- 工具 ---------- */
  function pct(v, d) { return (v === null || v === undefined || isNaN(v)) ? '—' : (v * 100).toFixed(d === undefined ? 2 : d) + '%'; }
  function signed(v, d) { if (v === null || v === undefined || isNaN(v)) return '—'; var x = (v * 100).toFixed(d === undefined ? 2 : d); return (v > 0 ? '+' : '') + x + '%'; }
  function cls(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : ''); }
  function num(v, d) { return (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toFixed(d === undefined ? 3 : d); }
  function tempColor(v) { return v < 20 ? '#1d6b4d' : v < 40 ? '#4d9575' : v < 60 ? '#9aa1a8' : v < 80 ? '#d17259' : '#b0362a'; }
  function tempTag(v) { return v < 20 ? '极度恐慌' : v < 40 ? '恐慌' : v < 60 ? '中性' : v < 80 ? '贪婪' : '极度贪婪'; }
  function el(t, a) { var e = document.createElementNS(NS, t); for (var k in a) if (a[k] !== null && a[k] !== undefined) e.setAttribute(k, a[k]); return e; }
  function $(id) { return document.getElementById(id); }
  function mmdd(s) { return s.slice(5).replace('-', '/'); }
  function ymd(s) { return s.replace(/-/g, '/'); }

  /* ---------- 回测（与 Python 同逻辑） ---------- */
  function runBT(buy, sell) {
    var o = S.open_px, c = S.bench_px, t = S.temp;
    var nav = new Float64Array(N), r = new Float64Array(N), pos = new Float64Array(N);
    var trades = [], st = 0, ei = null, epx = null, eq = 1;
    for (var i = 1; i < N; i++) {
      var s = t[i - 1];
      if (st === 0 && s !== null && s <= buy) { r[i] = c[i] / o[i] - 1 - COST; st = 1; ei = i; epx = o[i]; }
      else if (st === 1 && s !== null && s >= sell) {
        r[i] = o[i] / c[i - 1] - 1 - COST;
        trades.push({ in: S.dates[ei], out: S.dates[i], pin: epx, pout: o[i], ret: o[i] / epx - 1 - 2 * COST, days: i - ei });
        st = 0;
      } else if (st === 1) { r[i] = c[i] / c[i - 1] - 1; }
      pos[i] = st;
    }
    for (var j = 0; j < N; j++) { eq *= (1 + r[j]); nav[j] = eq; }
    if (st === 1) trades.push({ in: S.dates[ei], out: null, pin: epx, pout: c[N - 1], ret: c[N - 1] / epx - 1 - COST, days: null, open: true });
    return { nav: nav, r: r, pos: pos, trades: trades };
  }

  function calcM(nav, r, pos, i0, i1) {
    var base = nav[i0], total = nav[i1] / base - 1;
    var yrs = (new Date(S.dates[i1]) - new Date(S.dates[i0])) / 31557600000;
    var cagr = Math.pow(nav[i1] / base, 1 / yrs) - 1;
    var peak = -Infinity, mdd = 0, sum = 0, sum2 = 0, cnt = 0, ps = 0;
    for (var i = i0; i <= i1; i++) {
      var v = nav[i] / base;
      if (v > peak) peak = v;
      var d = v / peak - 1; if (d < mdd) mdd = d;
      if (i > i0) { sum += r[i]; sum2 += r[i] * r[i]; cnt++; }
      ps += pos[i];
    }
    var mean = cnt ? sum / cnt : 0, sd = cnt ? Math.sqrt(Math.max(sum2 / cnt - mean * mean, 0)) : 0;
    return { total: total, cagr: cagr, mdd: mdd, calmar: mdd < 0 ? cagr / Math.abs(mdd) : null,
             vol: sd * Math.sqrt(252), avgPos: ps / (i1 - i0 + 1), years: yrs };
  }

  var FULL = runBT(ST.buy, ST.sell);
  var I5 = (function () { for (var i = 0; i < N; i++) if (S.dates[i] >= FIVE_START) return i; return N - 1; })();

  function view() {
    var i0 = ST.period === 'full' ? 0 : Math.max(I5 - 1, 0), i1 = N - 1;
    var m = calcM(FULL.nav, FULL.r, FULL.pos, i0, i1);
    var bn = new Float64Array(N), br = new Float64Array(N), eq = 1;
    for (var i = 1; i < N; i++) br[i] = S.bench_px[i] / S.bench_px[i - 1] - 1;
    for (var j = 0; j < N; j++) { eq *= (1 + br[j]); bn[j] = eq; }
    var bm = calcM(bn, br, new Float64Array(N).fill(1), i0, i1);
    var closed = FULL.trades.filter(function (t) { return t.in >= S.dates[i0] && !t.open; });
    m.trades = closed.length;
    m.winRate = closed.length ? closed.filter(function (t) { return t.ret > 0; }).length / closed.length : null;
    return { m: m, bm: bm, i0: i0, i1: i1, bn: bn, nav: FULL.nav };
  }

  /* ---------- 通用折线 ---------- */
  function lineChart(host, cfg) {
    host.innerHTML = '';
    var W = host.clientWidth || 600, H = cfg.height || 160;
    var P = cfg.pad || { l: 42, r: 12, t: 10, b: 20 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b, n = cfg.len;
    var yMin = cfg.yMin, yMax = cfg.yMax;
    var X = function (i) { return P.l + (n <= 1 ? 0 : iw * i / (n - 1)); };
    var Y = function (v) { return P.t + ih * (1 - (v - yMin) / (yMax - yMin)); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });

    (cfg.bands || []).forEach(function (b) {
      svg.appendChild(el('rect', { x: P.l, y: Y(Math.max(b.to, b.from)), width: iw,
        height: Math.abs(Y(b.from) - Y(b.to)), fill: b.fill }));
    });

    var tk = cfg.yTicks === undefined ? 3 : cfg.yTicks;
    for (var k = 0; k <= tk; k++) {
      var val = yMin + (yMax - yMin) * k / tk, y = Y(val);
      svg.appendChild(el('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#f4f5f6' }));
      if (cfg.yFmt) {
        var tx = el('text', { x: P.l - 7, y: y + 3.4, 'text-anchor': 'end', fill: '#b3b9be', 'font-size': 10 });
        tx.textContent = cfg.yFmt(val); svg.appendChild(tx);
      }
    }
    (cfg.hlines || []).forEach(function (h) {
      svg.appendChild(el('line', { x1: P.l, y1: Y(h.y), x2: W - P.r, y2: Y(h.y),
        stroke: h.color || '#c9ced3', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
    });

    (cfg.series || []).forEach(function (s) {
      var d = '', started = false;
      for (var i = 0; i < s.data.length; i++) {
        var v = s.data[i];
        if (v === null || v === undefined || isNaN(v)) { started = false; continue; }
        d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        started = true;
      }
      var lineD = d;
      if (s.area) {
        var baseY = Y(cfg.base !== undefined ? cfg.base : yMin);
        svg.appendChild(el('path', { d: lineD + 'L' + X(s.data.length - 1) + ' ' + baseY +
          'L' + X(0) + ' ' + baseY + 'Z', fill: s.fill, stroke: 'none' }));
      }
      if (s.color) svg.appendChild(el('path', { d: lineD, fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.3,
        'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round', 'stroke-dasharray': s.dash || null }));
    });

    var xt = cfg.xTicks || 5;
    for (var q = 0; q < xt; q++) {
      var idx = Math.round((n - 1) * q / (xt - 1));
      var tb = el('text', { x: X(idx), y: H - 4, fill: '#b3b9be', 'font-size': 10,
        'text-anchor': q === 0 ? 'start' : (q === xt - 1 ? 'end' : 'middle') });
      tb.textContent = cfg.xFmt ? cfg.xFmt(cfg.labels[idx]) : cfg.labels[idx];
      svg.appendChild(tb);
    }

    if (cfg.tip) {
      var hv = el('line', { stroke: '#8f979f', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
      var hh = el('line', { stroke: '#8f979f', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
      svg.appendChild(hv); svg.appendChild(hh);
      var hit = el('rect', { x: P.l, y: P.t, width: iw, height: ih, fill: 'transparent' });
      svg.appendChild(hit);
      var tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip);
      hit.addEventListener('mousemove', function (ev) {
        var rc = svg.getBoundingClientRect();
        var rel = (ev.clientX - rc.left) * (W / rc.width);
        var i = Math.max(0, Math.min(n - 1, Math.round((rel - P.l) / (iw / Math.max(n - 1, 1)))));
        hv.setAttribute('x1', X(i)); hv.setAttribute('x2', X(i)); hv.setAttribute('opacity', .55);
        var html = '<b>' + cfg.labels[i] + '</b>';
        (cfg.series || []).forEach(function (s) {
          var v = s.data[i];
          if (v === null || v === undefined) return;
          if (s.y2) { hh.setAttribute('y1', Y(v)); hh.setAttribute('y2', Y(v)); hh.setAttribute('opacity', .35); }
          html += '<br>' + (s.name || '') + ' ' + (s.fmt ? s.fmt(v) : v);
        });
        tip.innerHTML = html; tip.style.opacity = 1;
        var px = X(i) * (rc.width / W);
        tip.style.left = Math.min(Math.max(px + 10, 0), rc.width - tip.offsetWidth - 6) + 'px';
        tip.style.top = '4px';
      });
      hit.addEventListener('mouseleave', function () { hv.setAttribute('opacity', 0); hh.setAttribute('opacity', 0); tip.style.opacity = 0; });
    }
    host.appendChild(svg);
  }

  /* ---------- 迷你线 ---------- */
  function spark(host, data, color) {
    host.innerHTML = '';
    var W = host.clientWidth || 200, H = host.clientHeight || 58;
    var vals = data.filter(function (v) { return v !== null; });
    if (!vals.length) return;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
    var X = function (i) { return 2 + (W - 4) * i / (data.length - 1); };
    var Y = function (v) { return 2 + (H - 4) * (1 - (v - lo) / (hi - lo)); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });
    var d = '', started = false;
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      if (v === null || v === undefined) { started = false; continue; }
      d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
      started = true;
    }
    var a = d + 'L' + X(data.length - 1) + ' ' + H + 'L' + X(0) + ' ' + H + 'Z';
    svg.appendChild(el('path', { d: a, fill: color, opacity: .07, stroke: 'none' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 1.3, 'vector-effect': 'non-scaling-stroke' }));
    host.appendChild(svg);
  }

  /* ---------- 蜡烛图 ---------- */
  function agg(tf) {
    if (tf === 'd') return null;
    var out = { dates: [], o: [], h: [], l: [], c: [], v: [] };
    var key = null;
    for (var i = 0; i < N; i++) {
      var d = S.dates[i], k;
      if (tf === 'w') {
        var dt = new Date(d), day = (dt.getDay() + 6) % 7;
        var mon = new Date(dt.getTime() - day * 86400000);
        k = mon.toISOString().slice(0, 10);
      } else { k = d.slice(0, 7); }
      if (k !== key) {
        out.dates.push(d); out.o.push(S.open_px[i]); out.h.push(S.high_px[i]);
        out.l.push(S.low_px[i]); out.c.push(S.bench_px[i]); out.v.push(S.vol[i]);
        key = k;
      } else {
        var j = out.dates.length - 1;
        out.h[j] = Math.max(out.h[j], S.high_px[i]);
        out.l[j] = Math.min(out.l[j], S.low_px[i]);
        out.c[j] = S.bench_px[i]; out.v[j] += S.vol[i];
      }
    }
    return out;
  }

  var WEEKLY = null, MONTHLY = null;

  function drawKline(host) {
    var src = ST.tf === 'd' ? { dates: S.dates, o: S.open_px, h: S.high_px, l: S.low_px, c: S.bench_px, v: S.vol }
              : (ST.tf === 'w' ? (WEEKLY || (WEEKLY = agg('w'))) : (MONTHLY || (MONTHLY = agg('m'))));
    var total = src.dates.length;
    var show = ST.tf === 'd' ? Math.min(250, total) : (ST.tf === 'w' ? Math.min(200, total) : Math.min(120, total));
    var s0 = total - show;

    var dates = src.dates.slice(s0), O = src.o.slice(s0), H = src.h.slice(s0), L = src.l.slice(s0), C = src.c.slice(s0), V = src.v.slice(s0);

    function ma(period) {
      var out = [];
      for (var i = 0; i < dates.length; i++) {
        var gi = s0 + i;
        if (gi < period - 1) { out.push(null); continue; }
        var s = 0;
        for (var k = 0; k < period; k++) s += src.c[gi - k];
        out.push(s / period);
      }
      return out;
    }

    host.innerHTML = '';
    var W = host.clientWidth || 800, H0 = host.clientHeight || 340;
    var P = { l: 8, r: 48, t: 8, b: 18 };
    var volH = Math.round(H0 * 0.17), gap = 12;
    var mainH = H0 - P.t - P.b - volH - gap;
    var iw = W - P.l - P.r;
    var n = dates.length, bw = iw / n;

    var lo = Math.min.apply(null, L), hi = Math.max.apply(null, H);
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var Y = function (v) { return P.t + mainH * (1 - (v - lo) / (hi - lo)); };
    var X = function (i) { return P.l + bw * (i + 0.5); };
    var vmax = Math.max.apply(null, V);
    var VY = function (v) { return P.t + mainH + gap + volH * (1 - v / vmax); };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H0, width: '100%', height: H0 });

    for (var g = 0; g <= 4; g++) {
      var gv = lo + (hi - lo) * g / 4, gy = Y(gv);
      svg.appendChild(el('line', { x1: P.l, y1: gy, x2: P.l + iw, y2: gy, stroke: '#f5f6f7' }));
      var gt = el('text', { x: P.l + iw + 5, y: gy + 3.4, fill: '#b3b9be', 'font-size': 10 });
      gt.textContent = gv.toFixed(2); svg.appendChild(gt);
    }

    var cw = Math.max(1, Math.min(bw * 0.66, 8));
    for (var i = 0; i < n; i++) {
      var up = C[i] >= O[i], col = up ? UP : DN, x = X(i);
      svg.appendChild(el('line', { x1: x, y1: Y(H[i]), x2: x, y2: Y(L[i]), stroke: col, 'stroke-width': Math.min(1.2, cw) }));
      var y1 = Y(Math.max(O[i], C[i])), y2 = Y(Math.min(O[i], C[i]));
      svg.appendChild(el('rect', { x: x - cw / 2, y: y1, width: cw, height: Math.max(1, y2 - y1), fill: col }));
      var vh = volH * (V[i] / vmax);
      svg.appendChild(el('rect', { x: x - cw / 2, y: P.t + mainH + gap + volH - vh, width: cw, height: Math.max(0.6, vh), fill: col, opacity: .35 }));
    }

    [[20, '#d99a2b'], [60, BLUE], [120, '#7a5ea8']].forEach(function (m) {
      if (!ST.ma[m[0]]) return;
      var arr = ma(m[0]), d = '', started = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] === null) { started = false; continue; }
        d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(arr[i]).toFixed(1);
        started = true;
      }
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: m[1], 'stroke-width': 1.1, 'vector-effect': 'non-scaling-stroke' }));
    });

    var xt = 6;
    for (var q = 0; q < xt; q++) {
      var idx = Math.round((n - 1) * q / (xt - 1));
      var lbl = ST.tf === 'd' ? mmdd(dates[idx]) : dates[idx].slice(0, 7);
      var tb = el('text', { x: X(idx), y: H0 - 4, fill: '#b3b9be', 'font-size': 10,
        'text-anchor': q === 0 ? 'start' : (q === xt - 1 ? 'end' : 'middle') });
      tb.textContent = lbl; svg.appendChild(tb);
    }

    var vline = el('line', { stroke: '#7b838a', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
    var hline = el('line', { stroke: '#7b838a', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
    svg.appendChild(vline); svg.appendChild(hline);
    var hit = el('rect', { x: P.l, y: P.t, width: iw, height: mainH + gap + volH, fill: 'transparent' });
    svg.appendChild(hit);
    var tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip);

    hit.addEventListener('mousemove', function (ev) {
      var rc = svg.getBoundingClientRect();
      var rel = (ev.clientX - rc.left) * (W / rc.width);
      var i = Math.max(0, Math.min(n - 1, Math.floor((rel - P.l) / bw)));
      vline.setAttribute('x1', X(i)); vline.setAttribute('x2', X(i)); vline.setAttribute('opacity', .6);
      hline.setAttribute('y1', Y(C[i])); hline.setAttribute('y2', Y(C[i])); hline.setAttribute('opacity', .45);
      var chg = i > 0 ? C[i] / C[i - 1] - 1 : 0;
      tip.innerHTML = '<b>' + dates[i] + '</b><br>' +
        '开 ' + O[i].toFixed(3) + '　高 ' + H[i].toFixed(3) + '<br>' +
        '低 ' + L[i].toFixed(3) + '　收 ' + C[i].toFixed(3) + '<br>' +
        '涨跌 <span class="' + (chg > 0 ? 'r' : 'g') + '">' + signed(chg) + '</span><br>' +
        '成交量 ' + (V[i] / 1e4).toFixed(0) + ' 万手';
      tip.style.opacity = 1;
      var px = X(i) * (rc.width / W);
      tip.style.left = Math.min(Math.max(px + 12, 0), rc.width - tip.offsetWidth - 6) + 'px';
      tip.style.top = '6px';
    });
    hit.addEventListener('mouseleave', function () { vline.setAttribute('opacity', 0); hline.setAttribute('opacity', 0); tip.style.opacity = 0; });

    host.appendChild(svg);
    var hint = $('klineHint');
    if (hint) hint.textContent = ymd(dates[0]) + ' — ' + ymd(dates[n - 1]) + '　共 ' + n + ' 根';
  }

  /* ---------- 卡片渲染 ---------- */
  function renderKline() { drawKline($('klineChart')); }

  function renderTemp() {
    var c = D.current, tv = c.temp;
    var e = $('tempNow'); e.textContent = tv.toFixed(1); e.style.color = tempColor(tv);
    var tag = $('tempTag'); tag.textContent = tempTag(tv);
    tag.style.color = tempColor(tv); tag.style.background = tempColor(tv) + '1a';
    $('gaugeMarker').style.left = 'calc(' + tv + '% - 1px)';
    $('lastSignal').textContent = c.last_signal ? (c.last_signal.date.slice(5) + ' ' + c.last_signal.action) : '—';
    $('curPos').textContent = c.holding ? '持有' : '空仓';

    // 日变化
    [['dChg1', c.chg1], ['dChg5', c.chg5], ['dChg20', c.chg20]].forEach(function (p) {
      var e = $(p[0]);
      if (p[1] === null || p[1] === undefined) { e.textContent = '—'; return; }
      e.textContent = (p[1] > 0 ? '+' : '') + p[1].toFixed(1);
      e.style.color = p[1] > 0 ? UP : (p[1] < 0 ? DN : 'var(--ink-2)');
    });
    var dp = $('dPe');
    if (dp) dp.textContent = (c.pe ? c.pe.toFixed(1) : '—') + ' / ' + (c.erp ? c.erp.toFixed(1) + '%' : '—');

    var s0 = Math.max(0, N - 250);
    var labels = S.dates.slice(s0), data = S.temp.slice(s0);
    lineChart($('tempMini'), {
      len: data.length, labels: labels, height: 132,
      yMin: 0, yMax: 100, yTicks: 2,
      yFmt: function (v) { return v.toFixed(0); },
      xFmt: function (s) { return s.slice(0, 7); }, xTicks: 4,
      hlines: [{ y: 30, color: '#c3c8cd' }, { y: 75, color: '#c3c8cd' }],
      bands: [{ from: 0, to: 30, fill: 'rgba(22,120,90,.05)' }, { from: 75, to: 100, fill: 'rgba(192,57,43,.05)' }],
      series: [{ data: data, color: '#8f979f', width: 1.1, name: '温度', fmt: function (v) { return v.toFixed(1); }, y2: true }],
      tip: true
    });
  }

  function renderSparks() {
    var map = [['breadth', 'spBreadth', 'scBreadth'], ['hl', 'spHl', 'scHl'], ['limitup', 'spLimit', 'scLimit'], ['vol', 'spVol', 'scVol']];
    var s0 = Math.max(0, N - 250);
    map.forEach(function (m) {
      var f = D.factors.filter(function (x) { return x.key === m[0]; })[0];
      if (!f) return;
      var col = tempColor(f.score === null ? 50 : f.score);
      spark($(m[1]), f.series.slice(s0), col);
      var e = $(m[2]);
      e.textContent = f.score === null ? '—' : f.score.toFixed(0);
      e.style.color = col;
    });
  }

  function renderBT() {
    var v = view(), m = v.m, b = v.bm;
    $('btRange').textContent = S.dates[v.i0] + ' 至 ' + S.dates[v.i1] + '　' + (v.i1 - v.i0 + 1) + ' 个交易日';

    var mt = $('mTotal'); mt.textContent = signed(m.total); mt.style.color = m.total >= 0 ? UP : DN;
    $('mCagr').textContent = pct(m.cagr); $('mCagr').style.color = m.cagr >= 0 ? UP : DN;
    $('mMdd').textContent = pct(m.mdd); $('mMdd').style.color = DN;
    $('mCalmar').textContent = num(m.calmar, 2);
    $('mPos').textContent = pct(m.avgPos, 0);
    $('mTrades').textContent = m.trades + ' 笔';
    $('bTotal').textContent = signed(b.total);
    $('bMdd').textContent = pct(b.mdd);

    var labels = S.dates.slice(v.i0, v.i1 + 1);
    var bs = v.nav[v.i0], bb = v.bn[v.i0];
    var sN = [], bN = [], sD = [], bD = [], pkS = -Infinity, pkB = -Infinity;
    for (var i = v.i0; i <= v.i1; i++) {
      var sv = v.nav[i] / bs, bv = v.bn[i] / bb;
      sN.push(sv); bN.push(bv);
      if (sv > pkS) pkS = sv;
      if (bv > pkB) pkB = bv;
      sD.push(sv / pkS - 1); bD.push(bv / pkB - 1);
    }
    var lo = Math.min.apply(null, sN.concat(bN)), hi = Math.max.apply(null, sN.concat(bN));
    var pad = (hi - lo) * 0.08;
    lineChart($('navChart'), {
      len: sN.length, labels: labels, height: 150, yMin: lo - pad, yMax: hi + pad, yTicks: 3,
      yFmt: function (x) { return x.toFixed(2); },
      xFmt: function (s) { return s.slice(0, 7); }, xTicks: 5,
      series: [
        { data: bN, color: GRAY, width: 1.2, name: '沪深300ETF', fmt: function (x) { return x.toFixed(3); }, y2: true },
        { data: sN, color: UP, width: 1.5, name: '策略', fmt: function (x) { return x.toFixed(3); }, y2: true }
      ],
      tip: true
    });
    var dlo = Math.min.apply(null, sD.concat(bD));
    lineChart($('ddChart'), {
      len: sD.length, labels: labels, height: 64, yMin: dlo * 1.06, yMax: 0, yTicks: 1,
      yFmt: function (x) { return (x * 100).toFixed(0) + '%'; },
      xFmt: function () { return ''; }, xTicks: 2,
      base: 0,
      series: [
        { data: sD, color: '#c0392b', width: 1.1, area: true, fill: 'rgba(192,57,43,.13)' },
        { data: bD, color: '#aeb5bb', width: 1, dash: '3 3' }
      ]
    });
  }

  function renderFactors() {
    var html = '';
    D.factors.forEach(function (f) {
      var sc = f.score, col = sc === null ? '#dfe2e4' : tempColor(sc);
      html += '<div class="frow"><div class="fname">' + f.name + '</div>' +
              '<div class="fbar"><span style="width:' + (sc === null ? 0 : sc) + '%;background:' + col + '"></span></div>' +
              '<div class="fval" style="color:' + col + '">' + (sc === null ? '—' : sc.toFixed(0)) + '</div></div>';
    });
    $('factorList').innerHTML = html;
  }

  function renderHeat() {
    var g = D.grid, met = ST.hm, vals = [];
    g.buys.forEach(function (_, i) { g.sells.forEach(function (__, j) { if (g[met][i][j] !== null) vals.push(g[met][i][j]); }); });
    var mx = Math.max.apply(null, vals.map(Math.abs));
    var h = '<thead><tr><th></th>';
    g.buys.forEach(function (b) { h += '<th>' + b + '</th>'; });
    h += '</tr></thead><tbody>';
    g.sells.forEach(function (s, j) {
      h += '<tr><th>' + s + '</th>';
      g.buys.forEach(function (b, i) {
        var val = g[met][i][j];
        if (val === null) { h += '<td class="na">—</td>'; return; }
        var t = val / mx;
        var col = t >= 0 ? 'rgba(192,57,43,' + (0.06 + 0.68 * t) + ')' : 'rgba(22,120,90,' + (0.06 + 0.68 * -t) + ')';
        var sel = (b === ST.buy && s === ST.sell) ? 'sel' : '';
        h += '<td class="' + sel + '" style="background:' + col + '" data-b="' + b + '" data-s="' + s + '">' +
             (met === 'calmar' ? val.toFixed(2) : val.toFixed(1)) + '</td>';
      });
      h += '</tr>';
    });
    var tb = $('heatmap');
    tb.innerHTML = h + '</tbody>';
    tb.querySelectorAll('td[data-b]').forEach(function (td) {
      td.addEventListener('click', function () {
        ST.buy = +td.dataset.b; ST.sell = +td.dataset.s;
        $('buyR').value = ST.buy; $('sellR').value = ST.sell;
        $('buyV').textContent = ST.buy; $('sellV').textContent = ST.sell;
        FULL = runBT(ST.buy, ST.sell);
        renderBT(); renderHeat();
      });
    });
  }

  function renderTables() {
    var hb = '';
    D.buckets.forEach(function (b) {
      hb += '<tr><td>' + b.range + '</td><td>' + b.n + '</td>' +
            '<td class="' + cls(b.fwd60) + '">' + (b.fwd60 > 0 ? '+' : '') + b.fwd60.toFixed(2) + '%</td>' +
            '<td>' + b.win60.toFixed(1) + '%</td></tr>';
    });
    $('tbBucket').innerHTML = '<thead><tr><th>温度</th><th>天数</th><th>未来60日</th><th>胜率</th></tr></thead><tbody>' + hb + '</tbody>';

    var hv = '';
    D.variants.forEach(function (v) {
      hv += '<tr><td>' + v.name.replace('基准规则（温度 30/75）', '基准 30/75').replace('加：', '') + '</td>' +
            '<td class="' + cls(v.cagr) + '">' + v.cagr.toFixed(1) + '%</td>' +
            '<td class="' + cls(v.mdd) + '">' + v.mdd.toFixed(0) + '%</td></tr>';
    });
    $('tbVariant').innerHTML = '<thead><tr><th>规则</th><th>年化</th><th>回撤</th></tr></thead><tbody>' + hv + '</tbody>';

    var hs = '';
    D.factors.forEach(function (f) {
      hs += '<tr><td>' + f.name + '</td><td style="color:var(--ink-3);font-size:11px;text-align:left">' + f.desc + '</td>' +
            '<td>' + (f.weight * 100).toFixed(1) + '%</td></tr>';
    });
    $('tbSpec').innerHTML = hs;
  }

  /* ---------- 放大 ---------- */
  var OV_RENDER = { kline: renderKline, temp: renderTemp, bt: renderBT };
  var moved = null, movedParent = null, movedNext = null;

  function openOverlay(key) {
    var card = document.querySelector('[data-card="' + key + '"]');
    if (!card) return;
    var bd = card.querySelector('.card-bd');
    $('ovTitle').textContent = card.querySelector('h2').textContent + '　放大视图';
    moved = bd; movedParent = card; movedNext = bd.nextSibling;
    $('ovBody').innerHTML = '';
    $('ovBody').appendChild(bd);
    $('overlay').hidden = false;
    setTimeout(function () { if (OV_RENDER[key]) OV_RENDER[key](); }, 30);
  }
  function closeOverlay() {
    $('overlay').hidden = true;
    if (moved) {
      $('ovBody').innerHTML = '';
      if (movedNext) movedParent.insertBefore(moved, movedNext); else movedParent.appendChild(moved);
      moved = null;
      setTimeout(function () { renderKline(); renderTemp(); renderBT(); renderSparks(); }, 30);
    }
  }

  function bind() {
    $('tfSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); ST.tf = b.dataset.tf; renderKline();
    });
    [[20, 'ma20'], [60, 'ma60'], [120, 'ma120']].forEach(function (m) {
      $(m[1]).addEventListener('change', function () { ST.ma[m[0]] = this.checked; renderKline(); });
    });
    function slide() {
      ST.buy = +$('buyR').value; ST.sell = +$('sellR').value;
      if (ST.sell <= ST.buy) { ST.sell = ST.buy + 5; $('sellR').value = ST.sell; }
      $('buyV').textContent = ST.buy; $('sellV').textContent = ST.sell;
      FULL = runBT(ST.buy, ST.sell);
      renderBT(); renderHeat();
    }
    $('buyR').addEventListener('input', slide);
    $('sellR').addEventListener('input', slide);
    $('periodSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); ST.period = b.dataset.p; renderBT();
    });
    $('hmSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); ST.hm = b.dataset.m; renderHeat();
    });
    document.querySelectorAll('[data-expand]').forEach(function (b) {
      b.addEventListener('click', function () { openOverlay(b.dataset.expand); });
    });
    $('ovClose').addEventListener('click', closeOverlay);
    $('overlay').addEventListener('click', function (e) { if (e.target === this) closeOverlay(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('overlay').hidden) closeOverlay(); });
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.querySelectorAll('.nav-links a').forEach(function (x) { x.classList.remove('on'); });
        a.classList.add('on');
      });
    });
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { renderKline(); renderTemp(); renderBT(); renderSparks(); }, 180);
    });
  }

  /* ---------- 启动 ---------- */
  $('asof').textContent = D.meta.end;
  $('footGen').textContent = '生成于 ' + D.meta.generated;
  // 阈值初值以数据为准，避免与 HTML 里的默认值不一致
  (function () {
    var b = document.getElementById('buyR'), sl = document.getElementById('sellR');
    if (b) { b.value = ST.buy; document.getElementById('buyV').textContent = ST.buy; }
    if (sl) { sl.value = ST.sell; document.getElementById('sellV').textContent = ST.sell; }
  })();
  bind();
  renderKline();
  renderTemp();
  renderSparks();
  renderBT();
  renderFactors();
  renderHeat();
  renderTables();
})();
