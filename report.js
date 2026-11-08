/* A股贪恐指数 · 回测报告
   前端只负责展示与"同口径重算"：阈值改变时在浏览器端复现与 Python 完全一致的
   状态机回测（收盘出信号、次日开盘成交、单边万三），不参与因子计算。 */
(function () {
  'use strict';

  var D = window.BT;
  if (!D) { document.body.innerHTML = '<p style="padding:40px">数据未加载</p>'; return; }

  var S = D.series;
  var N = S.dates.length;
  var C = { up: '#c0392b', down: '#16785a', gray: '#9aa1a9', ink: '#2b2f34' };
  var COST = 0.0003;
  var FIVE_START = '2021-11-05';

  var ST = { buy: D.default.buy, sell: D.default.sell, period: 'full', hm: 'cagr' };

  /* ---------------- 工具 ---------------- */
  function pct(v, d) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
    d = d === undefined ? 2 : d;
    return (v * 100).toFixed(d) + '%';
  }
  function signed(v, d) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
    var s = (v * 100).toFixed(d === undefined ? 2 : d);
    return (v > 0 ? '+' : '') + s + '%';
  }
  function cls(v) { return v > 0 ? 'pos' : (v < 0 ? 'neg' : 'flat'); }
  function num(v, d) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
    return Number(v).toFixed(d === undefined ? 3 : d);
  }
  function tempColor(v) {
    if (v < 20) return '#1d6b4d';
    if (v < 40) return '#4d9575';
    if (v < 60) return '#9aa1a9';
    if (v < 80) return '#d17259';
    return '#b0362a';
  }
  function label(v) {
    return v < 20 ? '极度恐慌' : v < 40 ? '恐慌' : v < 60 ? '中性' : v < 80 ? '贪婪' : '极度贪婪';
  }

  /* ---------------- 回测（与 Python 同逻辑） ---------------- */
  function runBacktest(buy, sell) {
    var o = S.open_px, c = S.bench_px, t = S.temp;
    var nav = new Float64Array(N), r = new Float64Array(N), pos = new Float64Array(N);
    var trades = [], st = 0, ei = null, epx = null, eq = 1;
    for (var i = 1; i < N; i++) {
      var s = t[i - 1];
      if (st === 0 && s !== null && s <= buy) {
        r[i] = c[i] / o[i] - 1 - COST;
        st = 1; ei = i; epx = o[i];
      } else if (st === 1 && s !== null && s >= sell) {
        r[i] = o[i] / c[i - 1] - 1 - COST;
        trades.push({ in: S.dates[ei], out: S.dates[i], pin: epx, pout: o[i],
                      ret: o[i] / epx - 1 - 2 * COST, days: i - ei });
        st = 0;
      } else if (st === 1) {
        r[i] = c[i] / c[i - 1] - 1;
      }
      pos[i] = st;
    }
    for (var j = 0; j < N; j++) { eq *= (1 + r[j]); nav[j] = eq; }
    if (st === 1) {
      trades.push({ in: S.dates[ei], out: null, pin: epx, pout: c[N - 1],
                    ret: c[N - 1] / epx - 1 - COST, days: null, open: true });
    }
    return { nav: nav, r: r, pos: pos, trades: trades };
  }

  function calcMetrics(nav, r, pos, i0, i1) {
    var base = nav[i0];
    var total = nav[i1] / base - 1;
    var yrs = (new Date(S.dates[i1]) - new Date(S.dates[i0])) / 31557600000;
    var cagr = Math.pow(nav[i1] / base, 1 / yrs) - 1;
    var peak = -Infinity, mdd = 0, sum = 0, sum2 = 0, cnt = 0, posSum = 0;
    for (var i = i0; i <= i1; i++) {
      var v = nav[i] / base;
      if (v > peak) peak = v;
      var d = v / peak - 1;
      if (d < mdd) mdd = d;
      if (i > i0) { sum += r[i]; sum2 += r[i] * r[i]; cnt++; }
      posSum += pos[i];
    }
    var mean = cnt ? sum / cnt : 0;
    var sd = cnt ? Math.sqrt(Math.max(sum2 / cnt - mean * mean, 0)) : 0;
    return {
      total: total, cagr: cagr, mdd: mdd,
      calmar: mdd < 0 ? cagr / Math.abs(mdd) : null,
      vol: sd * Math.sqrt(252),
      sharpe: sd > 0 ? mean / sd * Math.sqrt(252) : null,
      avgPos: posSum / (i1 - i0 + 1),
      years: yrs
    };
  }

  var FULL = runBacktest(ST.buy, ST.sell);

  function idxOfDate(str) {
    for (var i = 0; i < N; i++) if (S.dates[i] >= str) return i;
    return N - 1;
  }
  var I_FIVE = idxOfDate(FIVE_START);

  function currentView() {
    var i0 = ST.period === 'full' ? 0 : Math.max(I_FIVE - 1, 0);
    var i1 = N - 1;
    var m = calcMetrics(FULL.nav, FULL.r, FULL.pos, i0, i1);
    var bnav = new Float64Array(N), eq = 1;
    var r0 = new Float64Array(N);
    for (var i = 1; i < N; i++) { r0[i] = S.bench_px[i] / S.bench_px[i - 1] - 1; }
    for (var j = 0; j < N; j++) { eq *= (1 + r0[j]); bnav[j] = eq; }
    var bm = calcMetrics(bnav, r0, new Float64Array(N).fill(1), i0, i1);
    var trades = FULL.trades.filter(function (t) { return t.in >= S.dates[i0]; });
    var closed = trades.filter(function (t) { return !t.open; });
    var wins = closed.filter(function (t) { return t.ret > 0; }).length;
    m.trades = closed.length;
    m.winRate = closed.length ? wins / closed.length : null;
    return { m: m, bm: bm, i0: i0, i1: i1, nav: FULL.nav, bnav: bnav, trades: trades };
  }

  /* ---------------- SVG 图表 ---------------- */
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
  }

  function fmtDate(d) {
    var p = d.split('-');
    return p[0] + '/' + p[1];
  }

  function lineChart(host, cfg) {
    host.innerHTML = '';
    var W = host.clientWidth || 900;
    var H = cfg.height || 250;
    var P = cfg.pad || { l: 48, r: 14, t: 12, b: 24 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var n = cfg.len;
    var yMin = cfg.yMin, yMax = cfg.yMax;
    var X = function (i) { return P.l + (n <= 1 ? 0 : iw * i / (n - 1)); };
    var Y = function (v) { return P.t + ih * (1 - (v - yMin) / (yMax - yMin)); };

    // 网格与 y 轴
    var ticks = cfg.yTicks || 4;
    for (var k = 0; k <= ticks; k++) {
      var val = yMin + (yMax - yMin) * k / ticks;
      var y = Y(val);
      svg.appendChild(el('line', { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: '#f0f1f2', 'stroke-width': 1 }));
      var tx = el('text', { x: P.l - 8, y: y + 3.5, 'text-anchor': 'end', fill: '#9aa1a8', 'font-size': 10.5 });
      tx.textContent = cfg.yFmt ? cfg.yFmt(val) : val.toFixed(0);
      svg.appendChild(tx);
    }
    // 参考线
    (cfg.hlines || []).forEach(function (h) {
      svg.appendChild(el('line', { x1: P.l, y1: Y(h.y), x2: W - P.r, y2: Y(h.y),
        stroke: h.color || '#dcdedf', 'stroke-width': 1, 'stroke-dasharray': h.dash || '4 4' }));
      if (h.label) {
        var t2 = el('text', { x: W - P.r - 2, y: Y(h.y) - 4, 'text-anchor': 'end', fill: '#9aa1a8', 'font-size': 10 });
        t2.textContent = h.label;
        svg.appendChild(t2);
      }
    });

    // x 轴标签
    var xt = cfg.xTicks || 6;
    for (var q = 0; q < xt; q++) {
      var idx = Math.round((n - 1) * q / (xt - 1));
      var tb = el('text', { x: X(idx), y: H - 6, 'text-anchor': q === 0 ? 'start' : (q === xt - 1 ? 'end' : 'middle'),
        fill: '#9aa1a8', 'font-size': 10.5 });
      tb.textContent = fmtDate(cfg.labels[idx]);
      svg.appendChild(tb);
    }

    // 系列
    cfg.series.forEach(function (s) {
      var pts = [], started = false;
      for (var i = 0; i < s.data.length; i++) {
        var v = s.data[i];
        if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) { started = false; continue; }
        pts.push((started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1));
        started = true;
      }
      if (s.area) {
        var path = pts.join('') + 'L' + X(s.data.length - 1) + ' ' + Y(cfg.baseline !== undefined ? cfg.baseline : yMin) +
                   'L' + X(0) + ' ' + Y(cfg.baseline !== undefined ? cfg.baseline : yMin) + 'Z';
        svg.appendChild(el('path', { d: path, fill: s.fill, stroke: 'none' }));
      }
      if (s.line !== false) {
        svg.appendChild(el('path', {
          d: pts.join(''), fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.4,
          'stroke-linejoin': 'round', 'stroke-dasharray': s.dash || null,
          'vector-effect': 'non-scaling-stroke'
        }));
      }
    });

    // 交互层
    var hover = el('line', { stroke: '#2b2f34', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
    svg.appendChild(hover);
    var hit = el('rect', { x: P.l, y: P.t, width: iw, height: ih, fill: 'transparent' });
    svg.appendChild(hit);
    var tip = document.createElement('div');
    tip.className = 'tip';
    host.appendChild(tip);

    hit.addEventListener('mousemove', function (ev) {
      var rect = svg.getBoundingClientRect();
      var rel = (ev.clientX - rect.left) * (W / rect.width);
      var i = Math.round((rel - P.l) / (iw / (n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      hover.setAttribute('x1', X(i)); hover.setAttribute('x2', X(i)); hover.setAttribute('opacity', 1);
      var html = '<b>' + cfg.labels[i] + '</b>';
      cfg.series.forEach(function (s) {
        var v = s.data[i];
        if (v === null || v === undefined) return;
        html += '<br><span class="sw" style="background:' + (s.color || '#888') + '"></span>' +
                (s.name || '') + ' ' + (s.fmt ? s.fmt(v) : v);
      });
      tip.innerHTML = html;
      tip.style.opacity = 1;
      var px = X(i) * (rect.width / W);
      tip.style.left = Math.min(Math.max(px + 12, 0), rect.width - tip.offsetWidth - 4) + 'px';
      tip.style.top = '8px';
    });
    hit.addEventListener('mouseleave', function () { hover.setAttribute('opacity', 0); tip.style.opacity = 0; });

    host.appendChild(svg);
  }

  /* ---------------- 渲染 ---------------- */
  function renderMeta() {
    document.getElementById('metaRange').textContent = D.meta.start + ' — ' + D.meta.end;
    document.getElementById('metaEnd').textContent = D.meta.end;
    document.getElementById('metaGen').textContent = D.meta.generated;
    document.getElementById('footGen').textContent = '生成时间 ' + D.meta.generated;
  }

  function renderHero() {
    var c = D.current;
    var tEl = document.getElementById('tempNow');
    tEl.textContent = c.temp.toFixed(1);
    tEl.style.color = tempColor(c.temp);
    var tag = document.getElementById('tempTag');
    tag.textContent = c.label;
    tag.style.color = tempColor(c.temp);
    tag.style.background = tempColor(c.temp) + '1a';
    document.getElementById('gaugeMarker').style.left = 'calc(' + c.temp + '% - 1px)';
    document.getElementById('tempDate').textContent = c.date;

    var lo = 0, hi = 0, na = 0;
    D.factors.forEach(function (f) {
      if (f.score === null) { na++; return; }
      if (f.score < 40) lo++; else if (f.score > 60) hi++;
    });
    var zoneWord = c.temp < 30 ? '处于回测规则定义的买入区间' : (c.temp >= 75 ? '处于回测规则定义的卖出区间' : '不在触发区间内');
    document.getElementById('heroSub').innerHTML =
      '十因子中 <span class="k">' + lo + '</span> 个处于 40 分以下的恐慌区，' +
      '<span class="k">' + hi + '</span> 个高于 60 分，' + (na ? '<span class="k">' + na + '</span> 个数据缺失，' : '') +
      '当前' + zoneWord + '。';

    var sig = c.last_signal;
    document.getElementById('lastSignal').textContent = sig ? sig.date + ' ' + sig.action : '—';
    document.getElementById('curPos').textContent = c.holding ? '持有沪深300ETF' : '空仓';
    var open = D.trades.filter(function (t) { return t.open; })[0];
    var fe = document.getElementById('curFloat');
    if (c.holding && open) {
      var pxPct = (D.series.bench_px[N - 1] / open.pin - 1 - COST);
      fe.textContent = signed(pxPct) + '（' + open.in + ' 建仓）';
      fe.className = 'v ' + cls(pxPct);
    } else {
      fe.textContent = '—';
      fe.className = 'v';
    }
  }

  function renderCore() {
    var v = currentView(), m = v.m, b = v.bm;
    var isFull = ST.period === 'full';
    document.getElementById('sec1Title').textContent = '一、' + (isFull ? '过去十年' : '最近五年') + '核心表现';
    document.getElementById('note1').textContent =
      (isFull ? '回测区间 ' + D.meta.start + ' 至 ' + D.meta.end : '统计区间 ' + S.dates[v.i0] + ' 至 ' + D.meta.end) +
      '，共 ' + (v.i1 - v.i0 + 1) + ' 个交易日。年化按自然日折算；信号于收盘生成，次日开盘成交，单边成本万三。';

    var mt = document.getElementById('mTotal'), mc = document.getElementById('mCagr'), md = document.getElementById('mMdd');
    mt.textContent = signed(m.total); mt.className = 'v num ' + cls(m.total);
    mc.textContent = pct(m.cagr); mc.className = 'v num ' + cls(m.cagr);
    md.textContent = pct(m.mdd); md.className = 'v num ' + cls(m.mdd);
    document.getElementById('bTotal').textContent = '沪深300ETF ' + signed(b.total);
    document.getElementById('bCagr').textContent = '沪深300ETF ' + pct(b.cagr);
    document.getElementById('bMdd').textContent = '沪深300ETF ' + pct(b.mdd);

    var openN = v.trades.filter(function (t) { return t.open; }).length;
    var rows = [
      [(isFull ? '十年' : '五年') + '累计收益率', signed(m.total), signed(b.total), true],
      ['年化收益率', pct(m.cagr), pct(b.cagr), false],
      ['最大回撤', pct(m.mdd), pct(b.mdd), true],
      ['Calmar 收益回撤比', num(m.calmar), num(b.calmar), false],
      ['年化波动率', pct(m.vol), pct(b.vol), false],
      ['夏普比率（无风险利率 0）', num(m.sharpe, 2), num(b.sharpe, 2), false],
      ['平均股票仓位', pct(m.avgPos, 1), '约 100%', false],
      ['交易次数', m.trades + ' 笔' + (openN ? '（另有 ' + openN + ' 笔持仓中）' : ''), '1 笔（买入持有）', false],
      ['单笔胜率', m.winRate === null ? '—' : pct(m.winRate, 0), '—', false]
    ];
    var html = '';
    rows.forEach(function (r) {
      html += '<tr><td>' + r[0] + '</td><td class="strong ' + (r[3] ? (r[1].charAt(0) === '-' ? 'neg' : 'pos') : '') + '">' + r[1] +
              '</td><td class="mute">' + r[2] + '</td></tr>';
    });
    document.getElementById('tbCore').innerHTML = html;

    document.getElementById('tradeCount').textContent = v.trades.length;
    var th = '';
    v.trades.forEach(function (t) {
      th += '<tr><td>' + t.in + '</td><td>' + (t.out || '持有中') + '</td>' +
            '<td>' + (t.days === null ? '—' : t.days) + '</td>' +
            '<td class="' + cls(t.ret) + '">' + signed(t.ret) + '</td></tr>';
    });
    document.getElementById('tbTrades').innerHTML = th || '<tr><td colspan="4" class="mute">该区间内没有交易</td></tr>';
    return v;
  }

  function renderFive() {
    var i0 = I_FIVE - 1, i1 = N - 1;
    var m = calcMetrics(FULL.nav, FULL.r, FULL.pos, i0, i1);
    var bnav = new Float64Array(N), eq = 1, r0 = new Float64Array(N);
    for (var i = 1; i < N; i++) r0[i] = S.bench_px[i] / S.bench_px[i - 1] - 1;
    for (var j = 0; j < N; j++) { eq *= (1 + r0[j]); bnav[j] = eq; }
    var b = calcMetrics(bnav, r0, new Float64Array(N).fill(1), i0, i1);
    var trades = FULL.trades.filter(function (t) { return t.in >= S.dates[i0] && !t.open; });
    var wins = trades.filter(function (t) { return t.ret > 0; }).length;

    document.getElementById('note5').textContent =
      '最近五年：' + S.dates[i0] + ' 至 ' + D.meta.end + '。区间起点沿用策略当时的持仓状态，非从空仓重新开始。';

    var rows = [
      ['累计收益率', signed(m.total), signed(b.total), 'pct'],
      ['年化收益率', pct(m.cagr), pct(b.cagr), 'pct'],
      ['最大回撤', pct(m.mdd), pct(b.mdd), 'pct'],
      ['Calmar 收益回撤比', num(m.calmar), num(b.calmar), 'raw'],
      ['年化波动率', pct(m.vol), pct(b.vol), 'raw'],
      ['平均股票仓位', pct(m.avgPos, 1), '约 100%', 'raw'],
      ['交易次数', trades.length + ' 笔', '—', 'raw']
    ];
    var html = '';
    rows.forEach(function (r) {
      var c = r[3] === 'pct' ? (r[1].charAt(0) === '-' ? 'neg' : 'pos') : '';
      html += '<tr><td>' + r[0] + '</td><td class="strong ' + c + '">' + r[1] + '</td><td class="mute">' + r[2] + '</td></tr>';
    });
    document.getElementById('tbFive').innerHTML = html;
  }

  function renderNav(v) {
    var i0 = v.i0, i1 = v.i1;
    var labels = S.dates.slice(i0, i1 + 1);
    var baseS = v.nav[i0], baseB = v.bnav[i0];
    var sN = [], bN = [], sD = [], bD = [];
    var peakS = -Infinity, peakB = -Infinity;
    for (var i = i0; i <= i1; i++) {
      var sv = v.nav[i] / baseS, bv = v.bnav[i] / baseB;
      sN.push(sv); bN.push(bv);
      if (sv > peakS) peakS = sv;
      if (bv > peakB) peakB = bv;
      sD.push(sv / peakS - 1); bD.push(bv / peakB - 1);
    }
    var lo = Math.min.apply(null, sN.concat(bN)), hi = Math.max.apply(null, sN.concat(bN));
    var pad = (hi - lo) * 0.08;
    lineChart(document.getElementById('navChart'), {
      len: sN.length, labels: labels, height: 260, yMin: Math.max(0, lo - pad), yMax: hi + pad,
      yTicks: 4, yFmt: function (x) { return x.toFixed(2); },
      series: [
        { data: bN, color: C.gray, width: 1.3, name: '沪深300ETF', fmt: function (x) { return x.toFixed(3); } },
        { data: sN, color: C.up, width: 1.7, name: '策略', fmt: function (x) { return x.toFixed(3); } }
      ]
    });
    var dlo = Math.min.apply(null, sD.concat(bD));
    lineChart(document.getElementById('ddChart'), {
      len: sD.length, labels: labels, height: 150, yMin: dlo * 1.05, yMax: 0,
      yTicks: 3, yFmt: function (x) { return (x * 100).toFixed(0) + '%'; },
      baseline: 0,
      series: [
        { data: bD, color: '#c9cdd2', width: 1, area: true, fill: 'rgba(201,205,210,.55)',
          name: '基准回撤', fmt: function (x) { return (x * 100).toFixed(1) + '%'; } },
        { data: sD, color: '#e6b3ab', width: 1.2, area: true, fill: 'rgba(230,179,171,.6)',
          name: '策略回撤', fmt: function (x) { return (x * 100).toFixed(1) + '%'; } }
      ]
    });
  }

  function renderTempChart(v) {
    var i0 = v.i0, i1 = v.i1;
    var labels = S.dates.slice(i0, i1 + 1);
    var t = S.temp.slice(i0, i1 + 1), px = S.bench_px.slice(i0, i1 + 1);
    var host = document.getElementById('tempChart');
    host.innerHTML = '';
    var W = host.clientWidth || 900, H = 316;
    var P = { l: 46, r: 54, t: 10, b: 26 };
    var iw = W - P.l - P.r;
    var h1 = 168, gap = 30, h2 = H - P.t - P.b - h1 - gap;
    var y1 = P.t, y2 = P.t + h1 + gap;
    var n = t.length;
    var X = function (i) { return P.l + iw * i / (n - 1); };
    var YT = function (x) { return y1 + h1 * (1 - x / 100); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });

    // 温度面板
    svg.appendChild(el('rect', { x: P.l, y: YT(30), width: iw, height: YT(0) - YT(30), fill: 'rgba(22,120,90,.05)' }));
    svg.appendChild(el('rect', { x: P.l, y: YT(100), width: iw, height: YT(75) - YT(100), fill: 'rgba(192,57,43,.055)' }));
    [0, 25, 50, 75, 100].forEach(function (val) {
      svg.appendChild(el('line', { x1: P.l, y1: YT(val), x2: W - P.r, y2: YT(val), stroke: '#f1f2f3' }));
      var tx = el('text', { x: P.l - 8, y: YT(val) + 3.5, 'text-anchor': 'end', fill: '#a4aab0', 'font-size': 10 });
      tx.textContent = val; svg.appendChild(tx);
    });
    [30, 75].forEach(function (lv) {
      svg.appendChild(el('line', { x1: P.l, y1: YT(lv), x2: W - P.r, y2: YT(lv),
        stroke: '#c9ced3', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
    });
    var lt = el('text', { x: P.l, y: y1 - 1, fill: '#a4aab0', 'font-size': 10 });
    lt.textContent = '贪婪温度'; svg.appendChild(lt);

    var lineT = '';
    for (var i = 0; i < n; i++) if (t[i] !== null) lineT += (lineT ? 'L' : 'M') + X(i).toFixed(1) + ' ' + YT(t[i]).toFixed(1);
    svg.appendChild(el('path', { d: lineT, fill: 'none', stroke: '#8f979f', 'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke' }));

    // 价格面板
    var pmin = Math.min.apply(null, px), pmax = Math.max.apply(null, px);
    var pad = (pmax - pmin) * 0.06;
    pmin -= pad; pmax += pad;
    var YP = function (p) { return y2 + h2 * (1 - (p - pmin) / (pmax - pmin)); };
    [0, 0.5, 1].forEach(function (f) {
      var pv = pmin + (pmax - pmin) * f;
      svg.appendChild(el('line', { x1: P.l, y1: YP(pv), x2: W - P.r, y2: YP(pv), stroke: '#f1f2f3' }));
      var ty = el('text', { x: W - P.r + 8, y: YP(pv) + 3.5, fill: '#a4aab0', 'font-size': 10 });
      ty.textContent = pv.toFixed(2); svg.appendChild(ty);
    });
    var lp = el('text', { x: P.l, y: y2 - 4, fill: '#a4aab0', 'font-size': 10 });
    lp.textContent = '沪深300ETF 前复权价'; svg.appendChild(lp);
    var linePrice = '';
    for (var m = 0; m < n; m++) linePrice += (linePrice ? 'L' : 'M') + X(m).toFixed(1) + ' ' + YP(px[m]).toFixed(1);
    svg.appendChild(el('path', { d: linePrice, fill: 'none', stroke: '#2b2f34', 'stroke-width': 1.2,
      'vector-effect': 'non-scaling-stroke' }));

    // x 轴
    var xt = 6;
    for (var q = 0; q < xt; q++) {
      var idx = Math.round((n - 1) * q / (xt - 1));
      var tb = el('text', { x: X(idx), y: H - 6, 'text-anchor': q === 0 ? 'start' : (q === xt - 1 ? 'end' : 'middle'),
        fill: '#a4aab0', 'font-size': 10.5 });
      tb.textContent = fmtDate(labels[idx]); svg.appendChild(tb);
    }

    var hover = el('line', { stroke: '#2b2f34', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
    svg.appendChild(hover);
    var hit = el('rect', { x: P.l, y: P.t, width: iw, height: H - P.t - P.b, fill: 'transparent' });
    svg.appendChild(hit);
    var tip = document.createElement('div');
    tip.className = 'tip'; host.appendChild(tip);

    hit.addEventListener('mousemove', function (ev) {
      var rect = svg.getBoundingClientRect();
      var rel = (ev.clientX - rect.left) * (W / rect.width);
      var i2 = Math.max(0, Math.min(n - 1, Math.round((rel - P.l) / (iw / (n - 1)))));
      hover.setAttribute('x1', X(i2)); hover.setAttribute('x2', X(i2));
      hover.setAttribute('y1', P.t); hover.setAttribute('y2', H - P.b);
      hover.setAttribute('opacity', 1);
      tip.innerHTML = '<b>' + labels[i2] + '</b><br>温度 ' + (t[i2] === null ? '—' : t[i2].toFixed(1)) +
        ' · ' + (t[i2] === null ? '—' : label(t[i2])) + '<br>510300 ' + px[i2].toFixed(3);
      tip.style.opacity = 1;
      tip.style.left = Math.min(Math.max(X(i2) * (rect.width / W) + 12, 0), rect.width - 130) + 'px';
      tip.style.top = '8px';
    });
    hit.addEventListener('mouseleave', function () { hover.setAttribute('opacity', 0); tip.style.opacity = 0; });
    host.appendChild(svg);
  }

  function renderFactors() {
    var html = '';
    D.factors.forEach(function (f) {
      var sc = f.score;
      var col = sc === null ? '#dcdedf' : tempColor(sc);
      html += '<div class="factor-row">' +
        '<div><div class="factor-name">' + f.name + '</div>' +
        '<div class="factor-w num">权重 ' + (f.weight * 100).toFixed(1) + '%</div></div>' +
        '<div><div class="fbar"><span style="width:' + (sc === null ? 0 : sc) + '%;background:' + col + '"></span></div>' +
        '<div class="factor-desc">' + f.desc + '</div></div>' +
        '<div class="factor-score" style="color:' + col + '">' + (sc === null ? '—' : sc.toFixed(1)) + '</div>' +
        '</div>';
    });
    document.getElementById('factorList').innerHTML = html;

    var top = D.factors.slice().filter(function (f) { return f.score !== null; })
      .sort(function (a, b) { return b.score - a.score; });
    document.getElementById('factorNote').innerHTML =
      '当前最贪婪的是 <b>' + top[0].name + '</b>（' + top[0].score.toFixed(1) + '），' +
      '最恐慌的是 <b>' + top[top.length - 1].name + '</b>（' + top[top.length - 1].score.toFixed(1) + '）。' +
      '十因子等权平均得到总温度 ' + D.current.temp.toFixed(1) + '。' +
      '权重不做优化是有意为之：任何按历史收益调出来的权重都会带来过拟合，等权是唯一不含未来信息的设定。';
  }

  function renderYear(v) {
    var years = {}, order = [];
    for (var i = v.i0 + 1; i <= v.i1; i++) {
      var y = S.dates[i].slice(0, 4);
      if (!years[y]) { years[y] = { s: 1, b: 1, prev: i - 1 }; order.push(y); }
      years[y].s = v.nav[i] / v.nav[years[y].prev];
      years[y].b = v.bnav[i] / v.bnav[years[y].prev];
    }
    var html = '';
    order.forEach(function (y) {
      var d = years[y].s - years[y].b;
      var dtxt = Math.abs(d) < 0.0005 ? '0.0pp' : (d > 0 ? '+' : '') + (d * 100).toFixed(1) + 'pp';
      html += '<tr><td>' + y + '</td><td class="' + cls(years[y].s - 1) + '">' + signed(years[y].s - 1) +
              '</td><td class="mute">' + signed(years[y].b - 1) + '</td><td class="' + cls(d) + '">' +
              dtxt + '</td></tr>';
    });
    document.getElementById('tbYear').innerHTML = html;

    // 柱状
    var host = document.getElementById('yearChart');
    host.innerHTML = '';
    var W = host.clientWidth || 900, H = 172, P = { l: 40, r: 10, t: 10, b: 22 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var vals = order.map(function (y) { return years[y].s - 1; })
      .concat(order.map(function (y) { return years[y].b - 1; }));
    var mx = Math.max.apply(null, vals.map(Math.abs)) * 1.15;
    var bw = iw / order.length;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });
    var Y = function (x) { return P.t + ih * (0.5 - x / (2 * mx)); };
    svg.appendChild(el('line', { x1: P.l, y1: Y(0), x2: W - P.r, y2: Y(0), stroke: '#e3e5e7' }));
    order.forEach(function (y, i) {
      var x0 = P.l + bw * i + bw * 0.18;
      var sv = years[y].s - 1, bv = years[y].b - 1;
      svg.appendChild(el('rect', { x: x0, y: Math.min(Y(0), Y(sv)), width: bw * 0.28, height: Math.abs(Y(sv) - Y(0)),
        fill: sv >= 0 ? C.up : C.down, opacity: .85 }));
      svg.appendChild(el('rect', { x: x0 + bw * 0.30, y: Math.min(Y(0), Y(bv)), width: bw * 0.28, height: Math.abs(Y(bv) - Y(0)),
        fill: '#c9cdd2' }));
      var tb = el('text', { x: x0 + bw * 0.29, y: H - 6, 'text-anchor': 'middle', fill: '#9aa1a8', 'font-size': 10 });
      tb.textContent = y; svg.appendChild(tb);
    });
    var l1 = el('text', { x: 4, y: Y(mx * 0.9) + 8, fill: '#9aa1a8', 'font-size': 10 });
    l1.textContent = '+' + (mx * 100).toFixed(0) + '%';
    svg.appendChild(l1);
    var l2 = el('text', { x: 4, y: Y(-mx * 0.9) + 8, fill: '#9aa1a8', 'font-size': 10 });
    l2.textContent = '-' + (mx * 100).toFixed(0) + '%';
    svg.appendChild(l2);
    var l0 = el('text', { x: 4, y: Y(0) + 8, fill: '#c2c7cc', 'font-size': 10 });
    l0.textContent = '0';
    svg.appendChild(l0);
    host.appendChild(svg);
  }

  var HM_LABEL = { cagr: '年化收益', mdd: '最大回撤', calmar: 'Calmar' };
  function renderHeatmap() {
    var g = D.grid, met = ST.hm;
    var vals = [];
    g.buys.forEach(function (_, i) { g.sells.forEach(function (__, j) { if (g[met][i][j] !== null) vals.push(g[met][i][j]); }); });
    var mx = Math.max.apply(null, vals.map(Math.abs));
    var html = '<thead><tr><th></th>';
    g.buys.forEach(function (b) { html += '<th>' + b + '</th>'; });
    html += '</tr></thead><tbody>';
    g.sells.forEach(function (s, j) {
      html += '<tr><th>' + s + '</th>';
      g.buys.forEach(function (b, i) {
        var val = g[met][i][j];
        if (val === null) { html += '<td class="na">—</td>'; return; }
        var sel = (b === ST.buy && s === ST.sell) ? ' sel' : '';
        var t = val / mx;
        var col = t >= 0
          ? 'rgba(192,57,43,' + (0.08 + 0.72 * t) + ')'
          : 'rgba(22,120,90,' + (0.08 + 0.72 * -t) + ')';
        html += '<td class="' + sel.trim() + '" style="background:' + col + '" data-b="' + b + '" data-s="' + s + '">' +
                (met === 'calmar' ? val.toFixed(2) : val.toFixed(1)) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody>';
    var tb = document.getElementById('heatmap');
    tb.innerHTML = html;
    tb.querySelectorAll('td[data-b]').forEach(function (td) {
      td.addEventListener('click', function () {
        ST.buy = +td.dataset.b; ST.sell = +td.dataset.s;
        document.getElementById('buyR').value = ST.buy;
        document.getElementById('sellR').value = ST.sell;
        document.getElementById('buyV').textContent = ST.buy;
        document.getElementById('sellV').textContent = ST.sell;
        FULL = runBacktest(ST.buy, ST.sell);
        renderAll();
      });
    });
    document.getElementById('hmNote').innerHTML =
      '行是卖出阈值，列是买入阈值，当前高亮为 ' + ST.buy + ' / ' + ST.sell + '。' +
      '以' + HM_LABEL[met] + '着色，红为高、绿为低。最优区域不是一个点，' +
      '而是一整片：卖出阈值 70–80、买入阈值 25–45 的格子结果接近，说明结论不是靠调参调出来的。';
  }

  function renderBuckets() {
    var html = '';
    D.buckets.forEach(function (b) {
      html += '<tr><td>' + b.range + '</td><td>' + b.n + '</td>' +
        '<td class="' + cls(b.fwd20) + '">' + (b.fwd20 > 0 ? '+' : '') + b.fwd20.toFixed(2) + '%</td>' +
        '<td>' + b.win20.toFixed(1) + '%</td>' +
        '<td class="' + cls(b.fwd60) + '">' + (b.fwd60 > 0 ? '+' : '') + b.fwd60.toFixed(2) + '%</td>' +
        '<td>' + b.win60.toFixed(1) + '%</td></tr>';
    });
    document.getElementById('tbBucket').innerHTML = html;
    var mid = D.buckets[1], top = D.buckets[D.buckets.length - 1];
    var best60 = Math.max.apply(null, D.buckets.map(function (b) { return b.fwd60; }));
    var isBest = Math.abs(mid.fwd60 - best60) < 1e-9;
    document.getElementById('bucketNote').innerHTML =
      '恐慌区（' + mid.range + '）的未来 60 日平均收益 ' + mid.fwd60.toFixed(2) + '%、胜率 ' + mid.win60.toFixed(1) + '%' +
      (isBest ? '，是全样本最好的区间' : '') + '；而极度贪婪区（' + top.range + '）的 60 日平均收益为 ' +
      top.fwd60.toFixed(2) + '%，胜率却只有 ' + top.win60.toFixed(1) + '%，是所有区间里最低的。' +
      '这说明温度在高位的价值不在于"预测下跌"，而在于"赢面变小"——少数大涨掩盖了多数下跌，平均收益因此被拉回正值。';
  }

  function renderVariants() {
    var html = '';
    D.variants.forEach(function (v, i) {
      html += '<tr><td>' + v.name + (i === 0 ? '（本页采用）' : '') + '</td>' +
        '<td class="strong">' + v.cagr.toFixed(2) + '%</td>' +
        '<td class="' + cls(v.mdd) + '">' + v.mdd.toFixed(2) + '%</td>' +
        '<td>' + v.calmar.toFixed(3) + '</td></tr>';
    });
    document.getElementById('tbVariant').innerHTML = html;
    document.getElementById('variantNote').innerHTML =
      '<b>这组结果对本策略不利，但必须放上来。</b>加趋势止损能把最大回撤从 -36.4% 压到 -19.7%，' +
      '代价是年化从 7.29% 掉到 5.00%——因为在 A 股，恐慌点几乎总是出现在跌破均线之后，' +
      '用趋势确认去过滤买点，等于把最好的买点全部过滤掉。移动止损和回升确认同样不划算。' +
      '换句话说：<b>这套规则的收益来自"在没人敢买的时候买"，而不是来自精细的风控。</b>';
  }

  function renderSpec() {
    var html = '';
    D.factors.forEach(function (f) {
      html += '<tr><td style="width:78px">' + f.name + '</td><td style="text-align:left;color:var(--text-2);font-size:12.5px">' +
              f.desc + '</td><td style="width:52px">' + (f.weight * 100).toFixed(1) + '%</td></tr>';
    });
    document.getElementById('tbSpec').innerHTML = html;

    var src = [
      ['指数与成分股行情', '东方财富行情接口，前复权'],
      ['沪深300ETF / 国债ETF', '510300 / 511010 日线'],
      ['宽度 / 新高新低 / 涨停', '全 A 沪深个股逐日统计，剔除北交所'],
      ['融资融券余额', '沪深交易所，经东方财富汇总'],
      ['10 年期国债收益率', '中债估值，经东方财富'],
      ['全 A 成交额', '中证全指（000985）']
    ];
    var h2 = '';
    src.forEach(function (s) { h2 += '<tr><td style="width:140px">' + s[0] + '</td><td style="text-align:left;color:var(--text-2);font-size:12.5px">' + s[1] + '</td></tr>'; });
    document.getElementById('tbSrc').innerHTML = h2;

    document.getElementById('assump').innerHTML =
      '· 标的：沪深300ETF（510300），前复权价，分红再投已包含在价格序列中。<br>' +
      '· 仓位：满仓或空仓两态，不加杠杆、不做空、不做 T。<br>' +
      '· 信号：T 日收盘计算温度，T+1 日开盘成交，不使用未来数据。<br>' +
      '· 成本：单边万三（佣金万二点五 + 冲击成本半个基点），ETF 免印花税。<br>' +
      '· 空仓期收益按 0 计，未计入货币基金收益，这是偏保守的处理。<br>' +
      '· 年化按自然日折算，未按 252 交易日折算。';

    document.getElementById('limits').innerHTML =
      '<b>1. 2018 型慢熊防不住。</b>2018 年 1 月至 2019 年 1 月，策略满仓承受了 -36.4% 的回撤，与基准的 -44.8% 相差不大。' +
      '原因是 2017 年的温和上涨里温度始终没到 75，没有卖出信号；而 2018 年 2 月温度跌破 30 后又触发买入，等于在下跌中继里加仓。<br>' +
      '<b>2. 宽度因子存在幸存者偏差。</b>全 A 与成分股样本取自当前仍在交易的股票，已退市个股不在其中，' +
      '会系统性高估历史宽度。<br>' +
      '<b>3. 没有估值因子。</b>沪深300 的历史 PE / 股息率序列在公开接口上只能取到最近数据，无法覆盖十年区间，' +
      '因此指数里缺少"贵不贵"这一维，只有"热不热"。<br>' +
      '<b>4. 只有一个标的、一个十年。</b>结论对区间敏感，2024 年 9 月单笔交易贡献了全部收益的很大一部分，' +
      '不宜外推为稳定 alpha。<br>' +
      '<b>5. 北向资金已不可用。</b>2024 年 8 月起实时数据停止披露，只保留季度持股，无法作为日频因子。';
  }

  function renderAll() {
    var v = renderCore();
    renderNav(v);
    renderFive();
    renderTempChart(v);
    renderYear(v);
    renderHeatmap();
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    var buyR = document.getElementById('buyR'), sellR = document.getElementById('sellR');
    function onSlide() {
      ST.buy = +buyR.value; ST.sell = +sellR.value;
      if (ST.sell <= ST.buy) { ST.sell = ST.buy + 5; sellR.value = ST.sell; }
      document.getElementById('buyV').textContent = ST.buy;
      document.getElementById('sellV').textContent = ST.sell;
      FULL = runBacktest(ST.buy, ST.sell);
      renderAll();
      renderHero();
    }
    buyR.addEventListener('input', onSlide);
    sellR.addEventListener('input', onSlide);

    document.getElementById('periodSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      ST.period = b.dataset.p;
      var v = renderCore();
      renderNav(v); renderYear(v); renderTempChart(v);
    });

    document.getElementById('hmSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      ST.hm = b.dataset.m;
      renderHeatmap();
    });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { var v = currentView(); renderNav(v); renderTempChart(v); renderYear(v); }, 180);
    });
  }

  /* ---------------- 启动 ---------------- */
  // 阈值初值以数据为准，避免与 HTML 里的默认值不一致
  (function () {
    var b = document.getElementById('buyR'), sl = document.getElementById('sellR');
    if (b) { b.value = ST.buy; document.getElementById('buyV').textContent = ST.buy; }
    if (sl) { sl.value = ST.sell; document.getElementById('sellV').textContent = ST.sell; }
  })();
  renderMeta();
  renderHero();
  bind();
  renderFactors();
  renderBuckets();
  renderVariants();
  renderSpec();
  renderAll();
})();
