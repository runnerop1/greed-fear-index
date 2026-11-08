/* 盘中实时：浏览器直连东方财富公开行情（接口支持跨域），不需要后端。
   日频温度来自构建好的快照，日内情绪由四个实时维度合成。 */
(function () {
  'use strict';
  var D = window.BT;
  if (!D || !D.live) { document.body.insertAdjacentHTML('beforeend', '<p style="padding:40px">数据未加载</p>'); return; }

  var L = D.live;
  var NS = 'http://www.w3.org/2000/svg';
  var UP = '#c0392b', DN = '#16785a', INK = '#2b3034';

  var QURL = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2' +
             '&secids=1.000300,1.510300,1.511010' +
             '&fields=f2,f3,f4,f6,f12,f14,f104,f105';
  var TURL = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=1.000300' +
             '&fields1=f1,f2,f3,f4,f5&fields2=f51,f53,f56,f58&iscr=0&ndays=1';

  var state = { q: null, trends: null, emotion: null, dims: null, ts: null, timer: null };

  function $(id) { return document.getElementById(id); }
  function el(t, a) { var e = document.createElementNS(NS, t); for (var k in a) if (a[k] !== null && a[k] !== undefined) e.setAttribute(k, a[k]); return e; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tempColor(v) { return v < 20 ? '#1d6b4d' : v < 40 ? '#4d9575' : v < 60 ? '#9aa1a8' : v < 80 ? '#d17259' : '#b0362a'; }
  function tempTag(v) { return v < 20 ? '极度恐慌' : v < 40 ? '恐慌' : v < 60 ? '中性' : v < 80 ? '贪婪' : '极度贪婪'; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------- 交易时段 ---------- */
  function session() {
    var d = new Date(), day = d.getDay(), m = d.getHours() * 60 + d.getMinutes();
    if (day === 0 || day === 6) return { open: false, label: '周末休市' };
    if (m >= 570 && m <= 690) return { open: true, label: '交易中 · 上午' };
    if (m >= 780 && m <= 900) return { open: true, label: '交易中 · 下午' };
    if (m > 690 && m < 780) return { open: false, label: '午间休市' };
    if (m < 570) return { open: false, label: '未开盘' };
    return { open: false, label: '已收盘' };
  }
  function progress() {
    var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    if (m < 570) return 0;
    if (m <= 690) return (m - 570) / 240;
    if (m < 780) return 0.5;
    if (m <= 900) return 0.5 + (m - 780) / 240;
    return 1;
  }

  /* ---------- 取数 ---------- */
  function fetchJSON(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }); }

  function load() {
    var s = session();
    $('liveDot').className = 'live-dot' + (s.open ? ' on' : '');
    $('mktStatus').textContent = s.label;

    Promise.all([fetchJSON(QURL), fetchJSON(TURL)]).then(function (res) {
      var list = (res[0].data && res[0].data.diff) || [];
      var q = {};
      list.forEach(function (x) { q[x.f12] = x; });
      state.q = q;
      var tr = (res[1].data && res[1].data.trends) || [];
      state.trends = tr.map(function (row) {
        var p = row.split(',');
        return { t: p[0], px: +p[1], vol: +p[2], avg: +p[3] };
      });
      state.ts = new Date();
      compute();
      render();
    }).catch(function (e) {
      $('updTime').textContent = '取数失败，显示最近一次结果';
      console && console.warn && console.warn('live fetch failed', e);
    });
  }

  /* ---------- 计算 ---------- */
  function compute() {
    var q = state.q || {};
    var idx = q['000300'], etf = q['510300'], bond = q['511010'];
    if (!idx) return;

    var px = +idx.f2, chg = +idx.f3 / 100;
    var amt = +idx.f6 / 1e8;                    // 亿元
    var up = +idx.f104, dn = +idx.f105;
    var prog = Math.max(progress(), 0.02);
    var amtExp = L.amt20 * prog;
    var volRatio = amtExp > 0 ? amt / amtExp : 1;

    // 涨跌幅分位（以历史日波动为尺度）
    var z = chg / L.retStd;
    var s1 = clamp(50 + z * 20, 0, 100);

    // 涨跌家数（沪深300 成分股）
    var b = (up + dn) > 0 ? (up - dn) / (up + dn) : 0;
    var s2 = clamp(50 + b * 50, 0, 100);

    // 量价配合：放量上涨为强，放量下跌为弱，缩量下跌反而不算坏
    var dir = chg >= 0 ? 1 : -1;
    var s3 = clamp(50 + dir * (volRatio - 1) * 60, 0, 100);

    // 分时形态：现价相对当日均价
    var last = state.trends.length ? state.trends[state.trends.length - 1] : null;
    var avg = last ? last.avg : px;
    var s4 = clamp(50 + ((px / avg - 1) / L.retStd) * 15, 0, 100);

    state.dims = [
      { key: '涨跌幅', score: s1, val: (chg > 0 ? '+' : '') + (chg * 100).toFixed(2) + '%',
        sub: '沪深300 现价 ' + px.toFixed(2), color: chg >= 0 ? UP : DN },
      { key: '涨跌家数', score: s2, val: up + ' : ' + dn,
        sub: '成分股上涨 / 下跌', color: s2 >= 50 ? UP : DN },
      { key: '量价配合', score: s3, val: volRatio.toFixed(2) + '×',
        sub: (chg >= 0 ? '放量上涨' : '放量下跌') + '，已成交 ' + amt.toFixed(0) + ' 亿', color: s3 >= 50 ? UP : DN },
      { key: '分时形态', score: s4, val: (px >= avg ? '均价上方' : '均价下方'),
        sub: '现价 ' + px.toFixed(2) + ' / 均价 ' + avg.toFixed(2), color: px >= avg ? UP : DN }
    ];
    state.emotion = (s1 + s2 + s3 + s4) / 4;
    state.px = px; state.chg = chg; state.amt = amt; state.volRatio = volRatio;
    state.etf = etf ? +etf.f2 : null; state.etfChg = etf ? +etf.f3 / 100 : null;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (state.emotion === null) return;
    var s = state.emotion;

    var e = $('liveTemp');
    e.textContent = s.toFixed(1);
    e.style.color = tempColor(s);

    $('idxPx').textContent = state.px.toFixed(2);
    var chgEl = $('idxChg');
    chgEl.textContent = (state.chg > 0 ? '+' : '') + (state.chg * 100).toFixed(2) + '%';
    chgEl.style.color = state.chg >= 0 ? UP : DN;
    $('amt').textContent = state.amt.toFixed(0);
    $('volX').textContent = state.volRatio.toFixed(2) + '×';

    var t = state.ts;
    $('updTime').textContent = '最后更新 ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());

    // 维度
    var html = '';
    state.dims.forEach(function (d) {
      html += '<div class="dim" style="border-left-color:' + tempColor(d.score) + '">' +
        '<div class="dname">' + d.key + '</div>' +
        '<div class="dval" style="color:' + d.color + '">' + d.val + '</div>' +
        '<div class="dbar"><span style="width:' + d.score.toFixed(0) + '%;background:' + tempColor(d.score) + '"></span></div>' +
        '<div class="dsub">' + d.sub + '　得分 ' + d.score.toFixed(0) + '</div></div>';
    });
    $('dims').innerHTML = html;

    // 建议
    var T = L.tempLast, mult = T < 20 ? 3 : T < 40 ? 2 : T < 60 ? 1 : T < 80 ? 0.5 : 0;
    $('dayTemp').textContent = T.toFixed(1);
    $('dayTempTag').textContent = tempTag(T);
    $('dayMult').textContent = mult.toFixed(1) + '×';

    var tag = $('vTag'), main = $('vMain'), sub = $('vSub'), note = $('verdictNote');
    if (T <= 40) {
      if (s <= 35) {
        tag.textContent = '执行日';
        tag.style.background = '#e8f1ed'; tag.style.color = '#16785a';
        main.textContent = '今天就是下手的时候';
        sub.textContent = '日频在恐慌区，日内还在往下走。这种日子最难受，但正是回测里胜率最高的买点。按 ' + mult.toFixed(1) + ' 倍执行。';
      } else if (s < 65) {
        tag.textContent = '正常执行';
        tag.style.background = '#f2f3f4'; tag.style.color = '#5f666d';
        main.textContent = '按计划买';
        sub.textContent = '日频偏低、日内没有极端情绪，按 ' + mult.toFixed(1) + ' 倍正常执行，不需要等。';
      } else {
        tag.textContent = '等回踩';
        tag.style.background = '#f8ece9'; tag.style.color = '#c0392b';
        main.textContent = '今天在涨，别追';
        sub.textContent = '日频仍在低位，但日内已经偏热。当天冲高买入会把成本抬高，可以拆到明后天，或等回到均价下方再执行。';
      }
    } else if (T < 65) {
      tag.textContent = '常规';
      tag.style.background = '#f2f3f4'; tag.style.color = '#5f666d';
      main.textContent = '按 1 倍定投';
      sub.textContent = '日频在中性区间，不给方向性建议。按基准金额正常投，日内情绪只作参考。';
    } else {
      tag.textContent = '缓一缓';
      tag.style.background = '#f8ece9'; tag.style.color = '#c0392b';
      main.textContent = '不新增，等温度回落';
      sub.textContent = '日频已经偏高' + (T >= 80 ? '（极度贪婪）' : '') + '，此时加码等于给别人的收益买单。停投或减半，等温度回到 40 以下再说。';
    }
    note.innerHTML = '日内情绪 ' + s.toFixed(1) + ' 只说明今天资金的状态，不含预测。' +
      '真正决定仓位的是左边这个日频温度 —— 它是收盘定档的，一天之内不会变。';

    drawChart();
  }

  /* ---------- 分时图 ---------- */
  function drawChart() {
    var host = $('intraChart');
    if (!host || !state.trends || !state.trends.length) return;
    host.innerHTML = '';
    var W = host.clientWidth || 700, H = 268;
    var P = { l: 12, r: 54, t: 10, b: 20 };
    var volH = 50, gap = 14;
    var mainH = H - P.t - P.b - volH - gap;
    var iw = W - P.l - P.r;

    var data = state.trends;
    var n = data.length;
    // 分时返回的是"最近一个交易日"。若那天正是构建基准日，昨收要再往前推一天
    var trendDate = (data[0].t || '').slice(0, 10);
    var prev = (trendDate === L.date && L.prevClose2) ? L.prevClose2 : L.prevClose;
    state.ref = prev;
    var pxs = data.map(function (d) { return d.px; });
    var avgs = data.map(function (d) { return d.avg; });
    var lo = Math.min.apply(null, pxs.concat(avgs, [prev]));
    var hi = Math.max.apply(null, pxs.concat(avgs, [prev]));
    var pad = (hi - lo) * 0.12 || 0.5;
    lo -= pad; hi += pad;
    var X = function (i) { return P.l + iw * i / 239; };   // 240 分钟固定坐标
    var Y = function (v) { return P.t + mainH * (1 - (v - lo) / (hi - lo)); };
    var vmax = Math.max.apply(null, data.map(function (d) { return d.vol; })) || 1;
    var VY = function (v) { return P.t + mainH + gap + volH * (1 - v / vmax); };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });

    for (var g = 0; g <= 3; g++) {
      var gv = lo + (hi - lo) * g / 3, gy = Y(gv);
      svg.appendChild(el('line', { x1: P.l, y1: gy, x2: P.l + iw, y2: gy, stroke: '#f5f6f7' }));
      var gt = el('text', { x: P.l + iw + 6, y: gy + 3.4, fill: '#b3b9be', 'font-size': 10 });
      gt.textContent = gv.toFixed(1); svg.appendChild(gt);
    }
    // 昨收线
    svg.appendChild(el('line', { x1: P.l, y1: Y(prev), x2: P.l + iw, y2: Y(prev),
      stroke: '#cfd3d7', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    var pl = el('text', { x: P.l + 2, y: Y(prev) - 4, fill: '#b3b9be', 'font-size': 9.5 });
    pl.textContent = '昨收 ' + prev.toFixed(2); svg.appendChild(pl);

    // 成交量
    var bw = Math.max(1, iw / 240 * 0.6);
    data.forEach(function (d, i) {
      var h = volH * (d.vol / vmax);
      svg.appendChild(el('rect', { x: X(i) - bw / 2, y: VY(d.vol), width: bw, height: Math.max(0.5, h),
        fill: d.px >= prev ? UP : DN, opacity: .3 }));
    });

    // 价格线
    var col = state.chg >= 0 ? UP : DN;
    var dpath = '';
    data.forEach(function (d, i) { dpath += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(d.px).toFixed(1); });
    svg.appendChild(el('path', { d: dpath, fill: 'none', stroke: col, 'stroke-width': 1.4,
      'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
    var apath = '';
    data.forEach(function (d, i) { apath += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(d.avg).toFixed(1); });
    svg.appendChild(el('path', { d: apath, fill: 'none', stroke: '#d99a2b', 'stroke-width': 1,
      'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' }));

    // 时间轴
    [['09:30', 0], ['10:30', 60], ['11:30/13:00', 120], ['14:00', 180], ['15:00', 239]].forEach(function (t) {
      var tb = el('text', { x: X(t[1]), y: H - 4, fill: '#b3b9be', 'font-size': 10,
        'text-anchor': t[1] === 0 ? 'start' : (t[1] === 239 ? 'end' : 'middle') });
      tb.textContent = t[0]; svg.appendChild(tb);
    });

    host.appendChild(svg);
  }

  /* ---------- 启动 ---------- */
  function tick() {
    var s = session();
    $('liveDot').className = 'live-dot' + (s.open ? ' on' : '');
    $('mktStatus').textContent = s.label;
    if (s.open) load();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearInterval(state.timer); }
    else { load(); state.timer = setInterval(tick, 30000); }
  });

  load();
  state.timer = setInterval(tick, 30000);
  window.addEventListener('resize', function () { drawChart(); });

  // 先铺底：日频信息不依赖网络
  $('dayTemp').textContent = L.tempLast.toFixed(1);
  $('dayTempTag').textContent = tempTag(L.tempLast);
})();
