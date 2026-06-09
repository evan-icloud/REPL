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
  if (n >= 1e8) return (val / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (val / 1e4).toFixed(0) + '万';
  return val.toFixed(0);
}

function formatPct(val) {
  if (val == null) return '-';
  const cls = Number(val) > 0 ? 'up' : Number(val) < 0 ? 'down' : '';
  return `<span class="${cls}">${val > 0 ? '+' : ''}${Number(val).toFixed(2)}%</span>`;
}

// 渲染大盘指数
function renderIndices(indices) {
  const bar = document.getElementById('indicesBar');
  if (!indices || indices.length === 0) {
    bar.innerHTML = '<div class="index-card"><span class="name">暂无数据</span></div>';
    return;
  }
  bar.innerHTML = indices.map(i => {
    const cls = (i.changePct || 0) >= 0 ? 'up' : 'down';
    return `<div class="index-card">
      <div class="name">${i.name}</div>
      <div class="price ${cls}">${i.price?.toFixed(2) || '-'}</div>
      <div class="change ${cls}">${(i.changePct || 0) > 0 ? '+' : ''}${(i.changePct || 0).toFixed(2)}%</div>
    </div>`;
  }).join('');
}

// 渲染主线题材
function renderMainThemes(themes) {
  const el = document.getElementById('mainThemes');
  if (!themes || themes.length === 0) {
    el.innerHTML = '<div class="skeleton">暂无数据</div>';
    return;
  }
  const html = `<table>
    <thead><tr>
      <th>#</th><th>板块</th><th>涨幅</th><th>主力净流入</th><th>涨停/跌停</th><th>龙头</th>
    </tr></thead>
    <tbody>${themes.slice(0, 10).map((t, i) => {
      const rankCls = i < 3 ? `rank-${i+1}` : 'rank-n';
      return `<tr>
        <td><span class="theme-rank ${rankCls}">${i+1}</span></td>
        <td><strong>${t.name}</strong></td>
        <td>${formatPct(t.changePct)}</td>
        <td class="${(t.mainInflow || 0) > 0 ? 'flow-strong' : 'flow-weak'}">${formatMoney(t.mainInflow)}</td>
        <td><span class="tag tag-up">${t.riseCount || 0}涨</span> <span class="tag tag-down">${t.fallCount || 0}跌</span></td>
        <td>${t.leadStockName || '-'} ${t.leadStockChange ? formatPct(t.leadStockChange) : ''}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  el.innerHTML = html;
}

// 渲染波段套利标的
function renderBandTargets(targets) {
  const el = document.getElementById('bandTargets');
  if (!targets || targets.length === 0) {
    el.innerHTML = '<div class="skeleton">暂无符合条件的波段标的</div>';
    return;
  }
  const html = `<table>
    <thead><tr>
      <th>代码</th><th>名称</th><th>现价</th><th>涨幅</th><th>市值</th><th>换手</th><th>主力净流入</th><th>连板</th>
    </tr></thead>
    <tbody>${targets.slice(0, 15).map(s => `<tr>
      <td>${s.code}</td>
      <td><strong>${s.name}</strong></td>
      <td>${s.price?.toFixed(2) || '-'}</td>
      <td>${formatPct(s.changePct)}</td>
      <td>${s.marketCapDisplay || '-'}</td>
      <td>${(s.turnoverRate || 0).toFixed(2)}%</td>
      <td class="flow-strong">${s.mainInflowDisplay || '-'}</td>
      <td>${s.consecutiveBoard || 0}板</td>
    </tr>`).join('')}</tbody></table>`;
  el.innerHTML = html;
}

// 渲染市场共识
function renderConsensus(consensus) {
  const el = document.getElementById('consensus');
  if (!consensus) {
    el.innerHTML = '<div class="skeleton">暂无数据</div>';
    return;
  }
  const ms = consensus.marketSentiment || {};
  let html = `
    <div class="consensus-block">
      <div class="label">市场判断</div>
      <div class="value"><span class="tag tag-info">${consensus.summary || '-'}</span></div>
    </div>
    <div class="consensus-block">
      <div class="label">上证 ${formatPct(ms.shChange)} | 深证 ${formatPct(ms.szChange)} | 创业板 ${formatPct(ms.cyChange)}</div>
    </div>
    <div class="consensus-block">
      <div class="label">涨停 ${consensus.limitUpCount || 0} 家 | 跌停 ${consensus.brokenBoard || 0} 家</div>
    </div>`;

  if (consensus.mainDirections && consensus.mainDirections.length > 0) {
    html += '<div class="consensus-block"><div class="label">主线方向</div>';
    consensus.mainDirections.forEach(d => {
      html += `<div style="font-size:13px;margin:4px 0">&#9989; <strong>${d.name}</strong> — ${d.reason}</div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;
}

// 渲染操作建议
function renderAdvice(advice) {
  const el = document.getElementById('advice');
  if (!advice) {
    el.innerHTML = '<div class="skeleton">暂无建议</div>';
    return;
  }

  let html = `<div class="advice-section">
    <h4>&#128200; 整体判断</h4>
    <p>${advice.overall || ''}</p>
  </div>`;

  if (advice.buyZones && advice.buyZones.length > 0) {
    html += `<div class="advice-section"><h4>&#127919; 买入方向</h4>`;
    advice.buyZones.forEach(z => {
      html += `<p style="margin-bottom:6px"><strong>${z.theme}</strong><br>${z.suggestion}</p>`;
      html += `<p style="font-size:12px;color:#888;margin-left:12px">理想入场: ${z.idealEntry}<br>止损条件: ${z.stopLoss}</p>`;
    });
    html += `</div>`;
  }

  if (advice.sellConditions && advice.sellConditions.length > 0) {
    html += `<div class="advice-section"><h4>&#128201; 卖出条件</h4><ul>`;
    advice.sellConditions.forEach(s => { html += `<li>${s}</li>`; });
    html += `</ul></div>`;
  }

  if (advice.nextDayPlan && advice.nextDayPlan.length > 0) {
    html += `<div class="advice-section"><h4>&#128197; 明日操作计划</h4>`;
    advice.nextDayPlan.forEach(p => {
      html += `<div class="plan-phase"><div class="phase-name">${p.phase}</div><ul>`;
      p.actions.forEach(a => { html += `<li>${a}</li>`; });
      html += `</ul></div>`;
    });
    html += `</div>`;
  }

  el.innerHTML = html;
}

// 渲染风险提示
function renderRiskWarnings(advice) {
  const el = document.getElementById('riskWarnings');
  const warnings = advice?.riskWarnings || [];
  if (warnings.length === 0) {
    el.innerHTML = '<div class="skeleton">暂无风险提示</div>';
    return;
  }
  el.innerHTML = warnings.map(w => `<div class="risk-item">${w}</div>`).join('');
}

// 主渲染函数
function renderReport(report) {
  if (!report) return;
  document.getElementById('updateTime').textContent =
    `数据时间: ${new Date(report.generatedAt).toLocaleString('zh-CN')}`;

  renderIndices(report.marketIndices);
  renderMainThemes(report.mainThemes);
  renderBandTargets(report.bandTradeTargets);
  renderConsensus(report.consensus);
  renderAdvice(report.advice);
  renderRiskWarnings(report.advice);
}

// 刷新数据
async function refreshData() {
  document.getElementById('updateTime').textContent = '正在采集数据...';
  const result = await fetchAPI('/collect');
  if (result.success && result.report) {
    renderReport(result.report);
  } else {
    document.getElementById('updateTime').textContent = '采集失败: ' + (result.error || '未知错误');
  }
}

// 加载已有报告
async function loadReport() {
  const result = await fetchAPI('/report');
  if (result.success && result.report) {
    renderReport(result.report);
  } else {
    document.getElementById('updateTime').textContent = '暂无报告, 点击"刷新数据"采集';
  }
}

// 观察池管理
async function showWatchlist() {
  document.getElementById('watchlistModal').style.display = 'flex';
  document.getElementById('watchlistOverlay').style.display = 'block';
  const result = await fetchAPI('/watchlist');
  const body = document.getElementById('watchlistBody');
  if (!result.success || !result.watchlist) {
    body.innerHTML = '<p>加载失败</p>';
    return;
  }
  let html = '';
  result.watchlist.forEach((w, i) => {
    html += `<div class="watchlist-row">
      <input class="code-inp" value="${w.code || ''}" placeholder="代码" data-idx="${i}" data-field="code">
      <input class="name-inp" value="${w.name || ''}" placeholder="名称" data-idx="${i}" data-field="name">
      <input class="price-inp" value="${w.entryPrice || ''}" placeholder="入场价" data-idx="${i}" data-field="entryPrice">
      <input class="note-inp" value="${w.notes || ''}" placeholder="备注" data-idx="${i}" data-field="notes">
      <button class="btn btn-secondary" onclick="removeWatchlistItem(${i})">删除</button>
    </div>`;
  });
  html += `<button class="btn btn-primary" style="margin-top:10px" onclick="addWatchlistItem()">+ 添加</button>
    <button class="btn btn-primary" style="margin-top:10px;margin-left:8px" onclick="saveWatchlist()">&#128190; 保存</button>`;
  body.innerHTML = html;
}

function closeWatchlist() {
  document.getElementById('watchlistModal').style.display = 'none';
  document.getElementById('watchlistOverlay').style.display = 'none';
}

async function saveWatchlist() {
  const rows = document.querySelectorAll('#watchlistBody .watchlist-row');
  const list = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    list.push({
      code: inputs[0]?.value || '',
      name: inputs[1]?.value || '',
      entryPrice: parseFloat(inputs[2]?.value) || 0,
      notes: inputs[3]?.value || ''
    });
  });
  await fetch(API + '/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watchlist: list })
  });
  closeWatchlist();
}

function addWatchlistItem() {
  const body = document.getElementById('watchlistBody');
  const btn = body.querySelector('button');
  const div = document.createElement('div');
  div.className = 'watchlist-row';
  const idx = body.querySelectorAll('.watchlist-row').length;
  div.innerHTML = `<input class="code-inp" placeholder="代码" data-idx="${idx}" data-field="code">
    <input class="name-inp" placeholder="名称" data-idx="${idx}" data-field="name">
    <input class="price-inp" placeholder="入场价" data-idx="${idx}" data-field="entryPrice">
    <input class="note-inp" placeholder="备注" data-idx="${idx}" data-field="notes">
    <button class="btn btn-secondary" onclick="this.parentElement.remove()">删除</button>`;
  body.insertBefore(div, btn);
}

function removeWatchlistItem(idx) {
  const rows = document.querySelectorAll('#watchlistBody .watchlist-row');
  if (rows[idx]) rows[idx].remove();
}

// 初始化
document.addEventListener('DOMContentLoaded', loadReport);
