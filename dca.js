/* 定投方案页 */
(function () {
  'use strict';
  var D = window.DCA;
  if (!D) { document.body.insertAdjacentHTML('beforeend', '<p style="padding:40px">数据未加载</p>'); return; }

  var NS = 'http://www.w3.org/2000/svg';
  var UP = '#c0392b', DN = '#16785a', GRAY = '#bcc2c7';
  var COLORS = { '等额定投': '#9aa1a8', '情绪加权定投': '#c0392b', '情绪加权 + 贪婪清仓': '#3c5a9a' };

  function el(t, a) { var e = document.createElementNS(NS, t); for (var k in a) if (a[k] !== null && a[k] !== undefined) e.setAttribute(k, a[k]); return e; }
  function $(id) { return document.getElementById(id); }
  function money(v) { return (v / 10000).toFixed(1) + ' 万'; }
  function pct(v, d) { return (v * 100).toFixed(d === undefined ? 2 : d) + '%'; }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  /* ---------- 通用折线（支持 null 断点） ---------- */
  function line(host, cfg) {
    host.innerHTML = '';
    var W = host.clientWidth || 800, H = cfg.height || 220;
    var P = cfg.pad || { l: 46, r: 46, t: 12, b: 22 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b, n = cfg.len;
    var X = function (i) { return P.l + iw * i / (n - 1); };
    var Y = function (v) { return P.t + ih * (1 - (v - cfg.yMin) / (cfg.yMax - cfg.yMin)); };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });

    var ticks = cfg.ticks || null;
    var tk = ticks ? ticks.length - 1 : (cfg.yTicks || 4);
    for (var k = 0; k <= tk; k++) {
      var v = ticks ? ticks[k] : cfg.yMin + (cfg.yMax - cfg.yMin) * k / (cfg.yTicks || 4);
      svg.appendChild(el('line', { x1: P.l, y1: Y(v), x2: W - P.r, y2: Y(v), stroke: '#f4f5f6' }));
      var t = el('text', { x: P.l - 7, y: Y(v) + 3.3, 'text-anchor': 'end', fill: '#b3b9be', 'font-size': 10 });
      t.textContent = cfg.yFmt ? cfg.yFmt(v) : v.toFixed(0);
      svg.appendChild(t);
    }
    if (cfg.zero !== undefined) {
      svg.appendChild(el('line', { x1: P.l, y1: Y(cfg.zero), x2: W - P.r, y2: Y(cfg.zero), stroke: '#dfe2e4', 'stroke-dasharray': '3 3' }));
    }

    cfg.series.forEach(function (s) {
      var d = '', started = false;
      for (var i = 0; i < s.data.length; i++) {
        var v = s.data[i];
        if (v === null || v === undefined || isNaN(v)) { started = false; continue; }
        d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        started = true;
      }
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.4,
        'stroke-dasharray': s.dash || null, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
    });

    var xt = 6;
    for (var q = 0; q < xt; q++) {
      var idx = Math.round((n - 1) * q / (xt - 1));
      var tb = el('text', { x: X(idx), y: H - 4, fill: '#b3b9be', 'font-size': 10,
        'text-anchor': q === 0 ? 'start' : (q === xt - 1 ? 'end' : 'middle') });
      tb.textContent = cfg.labels[idx].slice(0, 7);
      svg.appendChild(tb);
    }

    if (cfg.right) {
      cfg.right.forEach(function (r) {
        var t2 = el('text', { x: W - P.r + 7, y: Y(r.v) + 3.3, fill: r.color || '#b3b9be', 'font-size': 10 });
        t2.textContent = r.text; svg.appendChild(t2);
      });
    }
    host.appendChild(svg);
  }

  /* ---------- 数据 ---------- */
  var M = D.meta, plans = D.plans;
  var base = plans[0], smart = plans[1], tp = plans[2];

  $('asof').textContent = M.end;
  $('footGen').textContent = '生成于 ' + M.generated;
  $('dcaRange').textContent = M.start + ' 至 ' + M.end + '　共 ' + M.periods + ' 期';

  /* ---------- 当前建议 ---------- */
  var C = D.current;
  $('adMult').textContent = C.mult.toFixed(1);
  $('adAmt').textContent = C.amount.toLocaleString();
  $('adBase').textContent = M.base.toLocaleString();
  $('adReason').innerHTML = '当前温度 <b style="color:#fff">' + C.temp.toFixed(1) + '</b>（' + C.label +
    '）。按下方分档表，本期投基准金额的 ' + C.mult.toFixed(1) + ' 倍。' +
    '如果这个月拿不出这么多，按 1 倍投也不影响长期方向——倍数只影响节奏，不改变结论。';

  var bandHtml = '<thead><tr><th>温度区间</th><th>情绪</th><th>倍数</th><th>历史期数</th></tr></thead><tbody>';
  D.buckets.forEach(function (b) {
    var now = (C.temp >= b.lo && C.temp < (b.hi >= 100 ? 101 : b.hi)) ? ' class="now"' : '';
    bandHtml += '<tr' + now + '><td>' + b.lo + '–' + b.hi + '</td><td>' + b.label + '</td>' +
      '<td class="mul">' + b.mult.toFixed(1) + '×</td><td class="cnt">' + b.count + ' 期</td></tr>';
  });
  $('bandTb').innerHTML = bandHtml + '</tbody>';

  /* ---------- 方案表 ---------- */
  var rows = [
    ['投入本金', 'invested', function (v) { return money(v); }, false],
    ['期末市值', 'asset', function (v) { return money(v); }, false],
    ['累计收益率', 'ret', function (v) { return pct(v, 1); }, true],
    ['年化 IRR', 'irr', function (v) { return pct(v); }, true],
    ['最大浮亏', 'mdd', function (v) { return pct(v, 1); }, false],
    ['平均成本', 'cost', function (v) { return v === null ? '—' : v.toFixed(3); }, false]
  ];
  var best = { ret: Math.max.apply(null, plans.map(function (p) { return p.ret; })),
               irr: Math.max.apply(null, plans.map(function (p) { return p.irr; })) };
  var h = '<thead><tr><th>指标</th>';
  plans.forEach(function (p) { h += '<th>' + p.name + '</th>'; });
  h += '</tr></thead><tbody>';
  rows.forEach(function (r) {
    h += '<tr><td>' + r[0] + '</td>';
    plans.forEach(function (p) {
      var v = p[r[1]];
      var isBest = (r[1] === 'ret' || r[1] === 'irr') && v === best[r[1]];
      h += '<td class="' + (isBest ? 'best' : '') + '">' + r[2](v) + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody>';
  $('planTb').innerHTML = h;

  $('retNote').innerHTML = '同样每月拿 1 万元，<b>情绪加权把年化 IRR 从 ' + pct(base.irr) + ' 提到 ' + pct(smart.irr) +
    '</b>（+' + ((smart.irr - base.irr) * 100).toFixed(2) + ' 个百分点），代价是多投了 ' +
    money(smart.invested - base.invested) + ' 本金。而一旦加上「贪婪清仓」，IRR 掉到 ' + pct(tp.irr) +
    '，等于白做十年。';

  /* ---------- 收益率曲线 ---------- */
  var dates = D.dates, n = dates.length;
  var series = plans.map(function (p) {
    return { data: p.rows.map(function (r) { return r.ret * 100; }), color: COLORS[p.name] || '#333', width: 1.6 };
  });
  var all = [];
  series.forEach(function (s) { all = all.concat(s.data); });
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
  var step = niceStep((hi - lo) / 4);
  var y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  var ticks = [];
  for (var v0 = y0; v0 <= y1 + 1e-9; v0 += step) ticks.push(Math.round(v0 * 100) / 100);
  line($('retChart'), {
    len: n, labels: dates, height: 230, yMin: y0, yMax: y1, ticks: ticks,
    yFmt: function (v) { return v.toFixed(0) + '%'; }, zero: 0, series: series
  });

  /* ---------- 成本曲线 ---------- */
  var price = plans[0].rows.map(function (r) { return r.price; });
  var c1 = base.rows.map(function (r) { return r.cost; });
  var c2 = smart.rows.map(function (r) { return r.cost; });
  var cAll = price.concat(c1).concat(c2).filter(function (v) { return v !== null; });
  var cl = Math.min.apply(null, cAll), ch = Math.max.apply(null, cAll);
  var cs = niceStep((ch - cl) / 4);
  var c0 = Math.floor(cl / cs) * cs, c1h = Math.ceil(ch / cs) * cs;
  var cticks = [];
  for (var cv = c0; cv <= c1h + 1e-9; cv += cs) cticks.push(Math.round(cv * 100) / 100);
  line($('costChart'), {
    len: n, labels: dates, height: 220, yMin: c0, yMax: c1h, ticks: cticks,
    yFmt: function (v) { return v.toFixed(2); },
    series: [
      { data: price, color: GRAY, width: 1.1, dash: '4 3' },
      { data: c1, color: '#9aa1a8', width: 1.5 },
      { data: c2, color: UP, width: 1.7 }
    ],
    right: [{ v: price[n - 1], text: '价格 ' + price[n - 1].toFixed(2), color: '#8f979f' }]
  });

  var disc1 = (1 - base.cost / price[n - 1]) * 100;
  var disc2 = (1 - smart.cost / price[n - 1]) * 100;
  $('costNote').innerHTML = '期末价 ' + price[n - 1].toFixed(3) + '。等额定投的平均成本 <b>' + base.cost.toFixed(3) +
    '</b>（较现价折价 ' + disc1.toFixed(1) + '%），情绪加权 <b>' + smart.cost.toFixed(3) +
    '</b>（折价 ' + disc2.toFixed(1) + '%）。成本低 ' + ((base.cost - smart.cost) / base.cost * 100).toFixed(1) +
    '%，这就是多出来的那部分收益来源——不是因为买得准，是因为在低位买得多。';

  /* ---------- 敏感性 ---------- */
  var sh = '<thead><tr><th>倍数方案</th><th>全样本</th><th>前段</th><th>后段</th></tr></thead><tbody>';
  D.sens.forEach(function (s) {
    sh += '<tr><td>' + s.name + '</td><td class="' + (s.irr > 0 ? 'pos' : 'neg') + '">' + pct(s.irr) +
      '</td><td>' + pct(s.irr_a) + '</td><td>' + pct(s.irr_b) + '</td></tr>';
  });
  $('sensTb').innerHTML = sh + '</tbody>';

  /* ---------- 止盈 ---------- */
  var th = '<thead><tr><th>清仓阈值</th><th>年化 IRR</th><th>累计收益</th></tr></thead><tbody>';
  th += '<tr><td>不清仓（对照）</td><td class="pos">' + pct(smart.irr) + '</td><td>' + pct(smart.ret, 1) + '</td></tr>';
  D.tp.forEach(function (t) {
    th += '<tr><td>温度 ≥ ' + t.level + '</td><td>' + pct(t.irr) + '</td><td>' + pct(t.ret, 1) + '</td></tr>';
  });
  $('tpTb').innerHTML = th + '</tbody>';

  var worst = D.tp[0], bestTp = D.tp[D.tp.length - 1];
  $('tpNote').innerHTML = '<b>这一组和直觉相反：贪婪时清仓是负贡献。</b>阈值 80 触发时 IRR 只剩 ' + pct(worst.irr) +
    '，比不清仓的 ' + pct(smart.irr) + ' 少 ' + ((smart.irr - worst.irr) * 100).toFixed(2) +
    ' 个百分点。原因很直接——卖在 80 之后，市场往往还涨了一段，而定投的钱还得继续投回去，买得更贵。' +
    '阈值抬到 ' + bestTp.level + ' 才基本不伤，但那已经等于不清仓了。';

})();
