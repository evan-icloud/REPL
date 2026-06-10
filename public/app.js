const API = '/api';

async function fetchAPI(endpoint) {
  try {
    const res = await fetch(API + endpoint);
    return await res.json();
  } catch (e) {
    console.error('API error:', e);
    return { success: false, error: e.message };
  }
}

function formatMoney(val) {
  if (val == null) return '-';
  const n = Math.abs(Number(val));
  if (n >= 1e8) return (val / 1e8).toFixed(2) + '\u4ebf';
  if (n >= 1e4) return (val / 1e4).toFixed(0) + '\u4e07';
  return val.toFixed(0);
}

function formatPct(val) {
  if (val == null) return '-';
  const cls = Number(val) > 0 ? 'up' : Number(val) < 0 ? 'down' : '';
  return '<span class="' + cls + '">' + (val > 0 ? '+' : '') + Number(val).toFixed(2) + '%</span>';
}

function renderIndices(indices) {
  const bar = document.getElementById('indicesBar');
  if (!indices || indices.length === 0) {
    bar.innerHTML = '<div class="index-card"><span class="name">\u6682\u65e0\u6570\u636e</span></div>';
    return;
  }
  bar.innerHTML = indices.map(function(i) {
    var cls = (i.changePct || 0) >= 0 ? 'up' : 'down';
    return '<div class="index-card">' +
      '<div class="name">' + i.name + '</div>' +
      '<div class="price ' + cls + '">' + (i.price != null ? i.price.toFixed(2) : '-') + '</div>' +
      '<div class="change ' + cls + '">' + ((i.changePct || 0) > 0 ? '+' : '') + (i.changePct || 0).toFixed(2) + '%</div>' +
    '</div>';
  }).join('');
}

function renderMainThemes(themes) {
  var el = document.getElementById('mainThemes');
  if (!themes || themes.length === 0) {
    el.innerHTML = '<div class="skeleton">\u6682\u65e0\u6570\u636e</div>';
    return;
  }
  var html = '<table><thead><tr>' +
    '<th>#</th><th>\u677f\u5757</th><th>\u6da8\u5e45</th><th>\u6210\u4ea4\u91cf</th><th>\u4e2a\u80a1\u6570</th><th>\u9f99\u5934</th>' +
  '</tr></thead><tbody>';
  for (var i = 0; i < Math.min(themes.length, 10); i++) {
    var t = themes[i];
    var rankCls = i < 3 ? 'rank-' + (i + 1) : 'rank-n';
    html += '<tr>' +
      '<td><span class="theme-rank ' + rankCls + '">' + (i + 1) + '</span></td>' +
      '<td><strong>' + t.name + '</strong></td>' +
      '<td>' + formatPct(t.changePct) + '</td>' +
      '<td>' + formatMoney(t.turnover) + '</td>' +
      '<td>' + (t.stockCount || '-') + '\u53ea</td>' +
      '<td>' + (t.leadStockName || '-') + (t.leadStockChangePct ? ' ' + formatPct(t.leadStockChangePct) : '') + '</td>' +
    '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;

  // 延时绘制 K线小图
  setTimeout(function() { drawKlineMiniChart(data.kline || []); }, 100);
}

function drawKlineMiniChart(klineData) {
  var canvas = document.getElementById('klineMiniChart');
  if (!canvas || !klineData || klineData.length < 2) return;
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var pad = { top: 16, right: 16, bottom: 32, left: 50 };
  var w = W - pad.left - pad.right;
  var h = H - pad.top - pad.bottom;

  var closes = klineData.map(function(k) { return k.close; });
  var lows = klineData.map(function(k) { return k.low; });
  var highs = klineData.map(function(k) { return k.high; });
  var min = Math.min.apply(null, lows);
  var max = Math.max.apply(null, highs);
  var range = max - min || 1;
  var n = klineData.length;

  // Background
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 0.5;
  for (var g = 0; g < 4; g++) {
    var gy = pad.top + (h * g / 3);
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
    var gridVal = max - (range * g / 3);
    ctx.fillStyle = '#999'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
    ctx.fillText(gridVal.toFixed(2), pad.left - 4, gy + 4);
  }

  // MA lines and K-line bars
  var barW = Math.max(w / n * 0.6, 1);
  var gap = w / n;
  for (var i = 0; i < n; i++) {
    var x = pad.left + gap * i + gap / 2;
    var k = klineData[i];
    var yOpen = pad.top + h - (k.open - min) / range * h;
    var yClose = pad.top + h - (k.close - min) / range * h;
    var yHigh = pad.top + h - (k.high - min) / range * h;
    var yLow = pad.top + h - (k.low - min) / range * h;

    var isUp = k.close >= k.open;
    ctx.strokeStyle = isUp ? '#cf1322' : '#52c41a';
    ctx.fillStyle = isUp ? '#cf1322' : '#52c41a';

    // Wick
    ctx.beginPath(); ctx.moveTo(x, yHigh); ctx.lineTo(x, yLow); ctx.stroke();

    // Body
    var bodyH = Math.max(Math.abs(yClose - yOpen), 1);
    var bodyTop = Math.min(yOpen, yClose);
    ctx.fillRect(x - barW/2, bodyTop, barW, bodyH);

    // x-axis label
    if (i % Math.ceil(n / 5) === 0 || i === n - 1) {
      ctx.fillStyle = '#999'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      var dateStr = (k.date || '').slice(4);
      if (dateStr.length > 10) dateStr = dateStr.slice(0, 5);
      ctx.fillText(dateStr, x, H - pad.bottom + 16);
    }
  }
}

function renderBandTargets(targets) {
  var el = document.getElementById('bandTargets');
  if (!targets || targets.length === 0) {
    el.innerHTML = '<div class="skeleton">\u6682\u65e0\u7b26\u5408\u6761\u4ef6\u7684\u6ce2\u6bb5\u6807\u7684</div>';
    return;
  }
  var html = '<table><thead><tr>' +
    '<th>\u4ee3\u7801</th><th>\u540d\u79f0</th><th>\u73b0\u4ef7</th><th>\u6da8\u5e45</th><th>\u6362\u624b</th><th>PE</th>' +
  '</tr></thead><tbody>';
  for (var j = 0; j < Math.min(targets.length, 15); j++) {
    var s = targets[j];
    html += '<tr>' +
      '<td>' + s.code + '</td>' +
      '<td><strong>' + s.name + '</strong></td>' +
      '<td>' + (s.price ? s.price.toFixed(2) : '-') + '</td>' +
      '<td>' + formatPct(s.changePct) + '</td>' +
      '<td>' + (s.turnoverRate || 0).toFixed(2) + '%</td>' +
      '<td>' + (s.pe ? s.pe.toFixed(1) : '-') + '</td>' +
    '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderConsensus(consensus) {
  var el = document.getElementById('consensus');
  if (!consensus) { el.innerHTML = '<div class="skeleton">\u6682\u65e0\u6570\u636e</div>'; return; }
  var ms = consensus.marketSentiment || {};
  var html = '<div class="consensus-block"><div class="label">\u5e02\u573a\u5224\u65ad</div>' +
    '<div class="value"><span class="tag tag-info">' + (consensus.summary || '-') + '</span></div>' +
  '</div>' +
  '<div class="consensus-block"><div class="label">' +
    '\u4e0a\u8bc1 ' + formatPct(ms.shChange) + ' | ' +
    '\u6df1\u8bc1 ' + formatPct(ms.szChange) + ' | ' +
    '\u521b\u4e1a\u677f ' + formatPct(ms.cyChange) +
  '</div></div>' +
  '<div class="consensus-block"><div class="label">' +
    '\u6da8\u505c ' + (consensus.limitUpCount || 0) + ' \u5bb6 | ' +
    '\u8dcc\u505c ' + (consensus.brokenBoard || 0) + ' \u5bb6' +
  '</div></div>';
  el.innerHTML = html;
}

function renderAdvice(advice) {
  var el = document.getElementById('advice');
  if (!advice) { el.innerHTML = '<div class="skeleton">\u6682\u65e0\u5efa\u8bae</div>'; return; }
  var html = '<div class="advice-section"><h4>\u0084\u6574\u4f53\u5224\u65ad</h4><p>' + (advice.overall || '') + '</p></div>';
  if (advice.buyZones && advice.buyZones.length > 0) {
    html += '<div class="advice-section"><h4>\u0042\u5165\u65b9\u5411</h4>';
    for (var i = 0; i < advice.buyZones.length; i++) {
      var z = advice.buyZones[i];
      html += '<p style="margin-bottom:6px"><strong>' + z.theme + '</strong><br>' + z.suggestion + '</p>' +
        '<p style="font-size:12px;color:#888;margin-left:12px">' +
        '\u7406\u60f3\u5165\u573a: ' + z.idealEntry + '<br>' +
        '\u6b62\u635f\u6761\u4ef6: ' + z.stopLoss + '</p>';
    }
    html += '</div>';
  }
  if (advice.sellConditions && advice.sellConditions.length > 0) {
    html += '<div class="advice-section"><h4>\u0053\u51fa\u6761\u4ef6</h4><ul>';
    for (var j = 0; j < advice.sellConditions.length; j++) {
      html += '<li>' + advice.sellConditions[j] + '</li>';
    }
    html += '</ul></div>';
  }
  el.innerHTML = html;
}

function renderRiskWarnings(advice) {
  var el = document.getElementById('riskWarnings');
  var warnings = advice ? advice.riskWarnings || [] : [];
  if (warnings.length === 0) {
    el.innerHTML = '<div class="skeleton">\u6682\u65e0\u98ce\u9669\u63d0\u793a</div>';
    return;
  }
  el.innerHTML = warnings.map(function(w) { return '<div class="risk-item">' + w + '</div>'; }).join('');
}

function renderReport(report) {
  if (!report) return;
  document.getElementById('updateTime').textContent =
    '\u6570\u636e\u65f6\u95f4: ' + new Date(report.generatedAt).toLocaleString('zh-CN');
  renderIndices(report.marketIndices);
  renderMainThemes(report.mainThemes);
  renderBandTargets(report.bandTradeTargets);
  renderConsensus(report.consensus);
  renderAdvice(report.advice);
  renderRiskWarnings(report.advice);
}

async function refreshData() {
  document.getElementById('updateTime').textContent = '\u6b63\u5728\u91c7\u96c6\u6570\u636e...';
  var result = await fetchAPI('/collect');
  if (result.success && result.report) {
    renderReport(result.report);
  } else {
    document.getElementById('updateTime').textContent = '\u91c7\u96c6\u5931\u8d25: ' + (result.error || '\u672a\u77e5\u9519\u8bef');
  }
}

// ========== 观察池个股分析 ==========
async function loadStockAnalysis() {
  var body = document.getElementById("stockAnalysisBody");
  var summary = document.getElementById("stockSummary");
  body.innerHTML = '<div class="skeleton">\u52a0\u8f7d\u4e2d...</div>';
  try {
    var res = await fetch("/api/stock-analysis");
    var data = await res.json();
    if (data.success) {
      renderStockAnalysis(data.stocks);
      renderStockSummary(data.summary);
      summary.style.display = "block";
    } else {
      body.innerHTML = '<div class="skeleton">\u52a0\u8f7d\u5931\u8d25: ' + (data.error || "") + '</div>';
    }
  } catch (e) {
    body.innerHTML = '<div class="skeleton">\u52a0\u8f7d\u5931\u8d25: ' + e.message + '</div>';
  }
}

function renderStockAnalysis(stocks) {
  var body = document.getElementById("stockAnalysisBody");
  if (!stocks || stocks.length === 0) {
    body.innerHTML = '<div class="skeleton">\u6682\u65e0\u6570\u636e</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < stocks.length; i++) {
    var s = stocks[i];
    var rec = s.recommendation || {};
    var act = rec.action || "";

    // Fix: check against actual action strings
    var badgeClass = "badge-hold";
    if (act === "\u4e70\u5165") badgeClass = "badge-buy";
    else if (act === "\u8f7b\u4ed3\u8bd5\u4e70") badgeClass = "badge-buy";
    else if (act === "\u5356\u51fa/\u56de\u907f") badgeClass = "badge-sell";

    var conf = rec.confidence || 0;
    var confColor = conf >= 65 ? "#cf1322" : conf >= 50 ? "#d46b08" : "#888";

    var chg = s.changePct || 0;
    var chgCls = chg > 0 ? "up" : chg < 0 ? "down" : "";

    html += '<div class="stock-analysis-row">' +
      '<div class="sa-left">' +
        '<div class="sa-name">' +
          '<span class="sa-index">#' + (i + 1) + '</span>' +
          '<strong>' + s.name + '</strong>' +
          '<span class="sa-code">' + s.code + '</span>' +
        '</div>' +
        '<div class="sa-price-row">' +
          '<span class="sa-price">' + (s.currentPrice != null ? s.currentPrice.toFixed(2) : "-") + '</span>' +
          '<span class="' + chgCls + '" style="font-weight:600;font-size:13px">' + (chg > 0 ? "+" : "") + chg.toFixed(2) + '%</span>' +
        '</div>' +
      '</div>' +
      '<div class="sa-center">' +
        '<div class="sa-indicators">' +
          '<div class="sa-ind"><span class="sa-label">MA5</span><span class="sa-val">' + (s.maValues && s.maValues.ma5 != null ? s.maValues.ma5.toFixed(2) : "-") + '</span></div>' +
          '<div class="sa-ind"><span class="sa-label">MA10</span><span class="sa-val">' + (s.maValues && s.maValues.ma10 != null ? s.maValues.ma10.toFixed(2) : "-") + '</span></div>' +
          '<div class="sa-ind"><span class="sa-label">MA20</span><span class="sa-val">' + (s.maValues && s.maValues.ma20 != null ? s.maValues.ma20.toFixed(2) : "-") + '</span></div>' +
          '<div class="sa-ind"><span class="sa-label">\u91cf\u6bd4</span><span class="sa-val">' + ((s.volumeAnalysis ? s.volumeAnalysis.volRatio : 1) || 1).toFixed(1) + '</span></div>' +
        '</div>' +
        '<div class="sa-trend">\u8d8b\u52bf: ' + (s.trend ? s.trend.description : "-") + '</div>' +
        '<div class="sa-vol-desc">' + (s.volumeAnalysis ? s.volumeAnalysis.description || "" : "") + '</div>' +
      '</div>' +
      '<div class="sa-right">' +
        '<div class="sa-action-row">' +
          '<span class="badge ' + badgeClass + '">' + act + '</span>' +
          '<span class="sa-confidence" style="color:' + confColor + '">\u4fe1\u5fc3 ' + conf + '%</span>' +
        '</div>' +
        '<div class="sa-reason">' + (rec.reason || "") + '</div>' +
        '<div class="sa-prices">';

    if (rec.entryPrice) html += '<span class="sa-price-tag entry">\u5165 ' + rec.entryPrice + '</span>';
    if (rec.stopLoss) html += '<span class="sa-price-tag stop">\u6b62 ' + rec.stopLoss + '</span>';
    if (rec.targetPrice) html += '<span class="sa-price-tag target">\u76ee ' + rec.targetPrice + '</span>';
    if (rec.riskReward && rec.riskReward !== "-") html += '<span class="sa-price-tag rr">\u8d54\u8d54 ' + rec.riskReward + '</span>';

    html += '</div>' +
        '<div class="sa-sr">' +
          '<span class="sa-sr-item">\u652f\u6491: ' + (s.support ? s.support.description : "-") + '</span>' +
          '<span class="sa-sr-item">\u963b\u529b: ' + (s.resistance ? s.resistance.description : "-") + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  body.innerHTML = html;
}

function renderStockSummary(summary) {
  if (!summary) return;
  document.getElementById("summaryText").textContent = summary.overallAdvice || "";

  document.getElementById("summaryCards").innerHTML =
    '<div class="sum-card sum-buy"><span class="sum-num">' + (summary.buyCount || 0) + '</span><span class="sum-label">\u4e70\u5165\u4fe1\u53f7</span></div>' +
    '<div class="sum-card sum-hold"><span class="sum-num">' + (summary.holdCount || 0) + '</span><span class="sum-label">\u6301\u6709\u89c2\u671b</span></div>' +
    '<div class="sum-card sum-sell"><span class="sum-num">' + (summary.sellCount || 0) + '</span><span class="sum-label">\u5356\u51fa/\u56de\u907f</span></div>';

  var picksEl = document.getElementById("topPicks");
  if (summary.topPicks && summary.topPicks.length > 0) {
    var picksHtml = '<div class="picks-title">\u2605 \u7cbe\u9009\u6807\u7684 TOP3</div>';
    for (var k = 0; k < summary.topPicks.length; k++) {
      var p = summary.topPicks[k];
      var actBadge = "";
      if (p.action === "\u4e70\u5165" || p.action === "\u8f7b\u4ed3\u8bd5\u4e70") {
        actBadge = '<span class="badge badge-buy badge-sm">\u4e70\u5165</span>';
      } else if (p.action === "\u5356\u51fa/\u56de\u907f") {
        actBadge = '<span class="badge badge-sell badge-sm">\u5356\u51fa</span>';
      }
      picksHtml += '<div class="pick-item">' +
        actBadge + ' <strong>' + p.name + '</strong> (' + p.code + ') ' +
        '<span class="pick-detail">\u4fe1\u5fc3' + p.confidence + '% | ' + p.reason + '</span>';
      if (p.entryPrice) picksHtml += ' | \u5165' + p.entryPrice;
      if (p.targetPrice) picksHtml += ' \u76ee' + p.targetPrice;
      if (p.stopLoss) picksHtml += ' \u6b62' + p.stopLoss;
      picksHtml += '</div>';
    }
    picksEl.innerHTML = picksHtml;
  } else {
    picksEl.innerHTML = "";
  }
}

// ========== 个股深度分析（输入代码查询） ==========
async function analyzeSingleStock() {
  var codeInput = document.getElementById("stockCodeInput");
  var code = (codeInput.value || "").trim();
  if (!code || code.length !== 6) {
    alert("\u8bf7\u8f93\u5165\u6709\u6548\u7684 6 \u4f4d\u80a1\u7968\u4ee3\u7801");
    return;
  }

  var resultEl = document.getElementById("singleStockResult");
  resultEl.innerHTML = '<div class="skeleton">\u5206\u6790\u4e2d...</div>';
  resultEl.style.display = "block";

  try {
    var res = await fetch("/api/stock/" + code + "/analyze");
    var data = await res.json();
    if (data.success) {
      renderSingleStockAnalysis(data);
    } else {
      resultEl.innerHTML = '<div class="skeleton">\u5206\u6790\u5931\u8d25: ' + (data.error || "") + '</div>';
    }
  } catch (e) {
    resultEl.innerHTML = '<div class="skeleton">\u8bf7\u6c42\u5931\u8d25: ' + e.message + '</div>';
  }
}

function renderSingleStockAnalysis(data) {
  var el = document.getElementById("singleStockResult");
  var s = data.analysis;
  var rec = s.recommendation || {};

  // Determine action styling
  var act = rec.action || "";
  var actionColor, actionBg;
  if (act === "\u4e70\u5165") { actionColor = "#cf1322"; actionBg = "#fff1f0"; }
  else if (act === "\u8f7b\u4ed3\u8bd5\u4e70") { actionColor = "#d46b08"; actionBg = "#fff7e6"; }
  else if (act === "\u5356\u51fa/\u56de\u907f") { actionColor = "#08979c"; actionBg = "#e6fffb"; }
  else { actionColor = "#595959"; actionBg = "#fafafa"; }

  var conf = rec.confidence || 0;
  var trend = s.trend || {};
  var maValues = s.maValues || {};
  var vol = s.volumeAnalysis || {};
  var sup = s.support || {};
  var res = s.resistance || {};

  var chg = s.changePct || 0;
  var chgCls = chg > 0 ? "up" : chg < 0 ? "down" : "";

  // K-line chart placeholder (simple bar)
  var prices = data.kline || [];

  var html = '<div class="ssa-card">' +
    '<div class="ssa-header">' +
      '<div class="ssa-header-left">' +
        '<h3>' + s.name + ' <span class="sa-code">' + s.code + '</span></h3>' +
        '<div class="ssa-price-row">' +
          '<span class="ssa-price">\u00a5' + (s.currentPrice != null ? s.currentPrice.toFixed(2) : "-") + '</span>' +
          '<span class="' + chgCls + '" style="font-size:16px;font-weight:600">' + (chg > 0 ? "+" : "") + chg.toFixed(2) + '%</span>' +
        '</div>' +
      '</div>' +
      '<div class="ssa-action" style="background:' + actionBg + ';color:' + actionColor + '">' +
        '<div class="ssa-action-text">' + act + '</div>' +
        '<div class="ssa-confidence">\u4fe1\u5fc3\u5ea6 ' + conf + '%</div>' +
      '</div>' +
    '</div>' +

    // AI 综合评语
    '<div class="ssa-ai-summary">' +
      '<div class="ssa-ai-icon">AI</div>' +
      '<div class="ssa-ai-text">' + (s.aiSummary || '正在分析...') + '</div>' +
    '</div>' +

    '<div class="ssa-body">' +
      '<div class="ssa-section">' +
        '<h4>\u6280\u672f\u6307\u6807</h4>' +
        '<div class="ssa-grid">' +
          '<div class="ssa-item"><span class="ssa-label">MA5</span><span class="ssa-value">' + (maValues.ma5 != null ? maValues.ma5.toFixed(2) : "-") + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">MA10</span><span class="ssa-value">' + (maValues.ma10 != null ? maValues.ma10.toFixed(2) : "-") + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">MA20</span><span class="ssa-value">' + (maValues.ma20 != null ? maValues.ma20.toFixed(2) : "-") + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">\u91cf\u6bd4(5\u65e5)</span><span class="ssa-value">' + ((vol.volRatio || 1)).toFixed(2) + 'x</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">\u4eca\u65e5\u6210\u4ea4\u91cf</span><span class="ssa-value">' + formatMoney(vol.todayVol) + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">5\u65e5\u5747\u91cf</span><span class="ssa-value">' + formatMoney(vol.avg5Vol) + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">\u4eca\u65e5\u5f00\u76d8</span><span class="ssa-value">' + (data.quote ? data.quote.open.toFixed(2) : '-') + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">\u6362\u624b\u7387</span><span class="ssa-value">' + (data.quote ? (data.quote.turnoverRate || 0).toFixed(2) + '%' : '-') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="ssa-section">' +
        '<h4>\u8d8b\u52bf\u5206\u6790</h4>' +
        '<div class="ssa-grid-3">' +
          '<div class="ssa-item"><span class="ssa-label">\u65b9\u5411</span><span class="ssa-value">' + (trend.direction || "-") + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">\u5f3a\u5ea6</span><span class="ssa-value">' + (trend.strength || "-") + '</span></div>' +
          '<div class="ssa-item"><span class="ssa-label">\u6210\u4ea4\u91cf</span><span class="ssa-value">' + (vol.description || "-") + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="ssa-section">' +
        '<h4>K\u7ebf\u8d70\u52bf\u56fe</h4>' +
        '<canvas id="klineMiniChart" width="700" height="180" style="width:100%;height:180px;border:1px solid #f0f0f0;border-radius:4px"></canvas>' +
      '</div>' +

      '<div class="ssa-section">' +
        '<h4>\u652f\u6491\u4e0e\u963b\u529b</h4>' +
        '<div class="ssa-grid-2">' +
          '<div class="ssa-item ssa-support"><span class="ssa-label">\u652f\u6491\u4f4d</span><span class="ssa-value">' + (sup.description || "-") + '</span></div>' +
          '<div class="ssa-item ssa-resist"><span class="ssa-label">\u963b\u529b\u4f4d</span><span class="ssa-value">' + (res.description || "-") + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="ssa-section">' +
        '<h4>\u4ea4\u6613\u5efa\u8bae</h4>' +
        '<div class="ssa-advice">' +
          '<p><strong>\u7406\u7531:</strong> ' + (rec.reason || "\u6570\u636e\u4e0d\u8db3") + '</p>';
    if (rec.entryPrice) html += '<p><strong>\u5efa\u8bae\u5165\u573a\u4ef7:</strong> \u00a5' + rec.entryPrice + '</p>';
    if (rec.stopLoss) html += '<p><strong>\u6b62\u635f\u4ef7:</strong> \u00a5' + rec.stopLoss + '</p>';
    if (rec.targetPrice) html += '<p><strong>\u76ee\u6807\u4ef7:</strong> \u00a5' + rec.targetPrice + '</p>';
    if (rec.riskReward && rec.riskReward !== "-") html += '<p><strong>\u98ce\u9669/\u56de\u62a5:</strong> ' + rec.riskReward + '</p>';
    html += '</div></div>' +

      '<div class="ssa-section">' +
        '<h4>\u8fd1\u671f K \u7ebf\u6570\u636e</h4>' +
        '<div class="ssa-kline-table"><table><thead><tr>' +
          '<th>\u65e5\u671f</th><th>\u5f00\u76d8</th><th>\u6536\u76d8</th><th>\u6700\u9ad8</th><th>\u6700\u4f4e</th><th>\u6210\u4ea4\u91cf</th>' +
        '</tr></thead><tbody>';
    var klineData = prices.slice(-10);
    for (var ki = 0; ki < klineData.length; ki++) {
      var k = klineData[ki];
      var isUp = k.close >= k.open;
      html += '<tr class="' + (isUp ? "kline-up" : "kline-down") + '">' +
        '<td>' + k.date + '</td>' +
        '<td>' + k.open.toFixed(2) + '</td>' +
        '<td>' + k.close.toFixed(2) + '</td>' +
        '<td>' + k.high.toFixed(2) + '</td>' +
        '<td>' + k.low.toFixed(2) + '</td>' +
        '<td>' + formatMoney(k.volume) + '</td>' +
      '</tr>';
    }
    html += '</tbody></table></div></div>' +
    '</div></div>';

  el.innerHTML = html;
}
