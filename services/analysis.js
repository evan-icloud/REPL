const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config.json');
const DATA_DIR = path.join(__dirname, '..', 'data', 'daily');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { watchlist: [], riskAlerts: {}, tradeLog: [] };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// 通过资金流向+板块表现+涨停数量识别主线题材
function identifyMainThemes(data) {
  const { conceptSectors, industrySectors, limitUpStocks } = data;
  const themes = [];
  const allSectors = [...(conceptSectors || []), ...(industrySectors || [])];

  const active = allSectors.filter(s => s.mainInflow > 0 && s.changePct > 0);
  const sorted = active.sort((a, b) => (b.mainInflow || 0) - (a.mainInflow || 0)).slice(0, 15);

  for (const sector of sorted) {
    const maxInflow = sorted[0]?.mainInflow || 1;
    const maxPct = Math.max(...sorted.map(s => s.changePct || 0), 1);
    const maxRise = Math.max(...sorted.map(s => (s.riseCount || 0)), 1);

    const inFlowScore = ((sector.mainInflow || 0) / maxInflow) * 40;
    const pctScore = ((sector.changePct || 0) / maxPct) * 20;
    const riseScore = ((sector.riseCount || 0) / maxRise) * 40;

    sector.score = inFlowScore + pctScore + riseScore;
    sector.leadStockInfo = {
      code: sector.leadStock, name: sector.leadStockName, changePct: sector.leadStockChange
    };
    themes.push(sector);
  }

  themes.sort((a, b) => (b.score || 0) - (a.score || 0));
  return themes;
}

// 总结市场共识方向
function summarizeConsensus(data, themes) {
  const { indices, limitUpStocks } = data;
  const shIdx = (indices || []).find(i => i.code === '000001');
  const szIdx = (indices || []).find(i => i.code === '399001');
  const cyIdx = (indices || []).find(i => i.code === '399006');

  const marketSentiment = {
    shChange: shIdx?.changePct || 0,
    szChange: szIdx?.changePct || 0,
    cyChange: cyIdx?.changePct || 0,
    avgChange: ((shIdx?.changePct||0) + (szIdx?.changePct||0) + (cyIdx?.changePct||0)) / 3,
    northBoundNet: 0
  };

  const limitUpCount = (limitUpStocks || []).filter(s => s.changePct > 9.5).length;
  const brokenBoard = (limitUpStocks || []).filter(s => s.changePct < -9.5).length;

  const mainDirections = themes.slice(0, 3).map(t => ({
    name: t.name,
    reason: '领涨板块，综合评分: ' + (t.score || 0).toFixed(1),
    leadStock: t.leadStockName || ''
  }));

  return {
    marketSentiment, limitUpCount, brokenBoard, mainDirections,
    summary: marketSentiment.avgChange > 1 ? '强势多头市场' :
              marketSentiment.avgChange > 0.3 ? '震荡偏多' :
              marketSentiment.avgChange > 0 ? '窄幅整理' :
              marketSentiment.avgChange > -0.5 ? '弱势整理' : '空头市场'
  };
}

// 寻找波段套利标的：大市值 + 主线题材 + 高成交量 + 非情绪末端加速
function findBandTradeTargets(data, themes) {
  const { limitUpStocks, dragonTiger } = data;
  const candidates = [];
  const allStocks = [...(limitUpStocks || []), ...(dragonTiger || [])];

  const seen = new Set();
  const unique = allStocks.filter(s => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  });

  for (const stock of unique) {
    const mc = stock.marketCap || 0;
    const tr = stock.turnoverRate || 0;
    const cp = stock.changePct || 0;
    const mi = stock.mainInflow || 0;

    if (mc < 2e10) continue;           // 市值不足200亿
    if (cp <= 0 || cp > 9) continue;   // 涨幅不在0-9%区间
    if (tr < 3 || tr > 15) continue;   // 换手率不在3-15%区间
    if (mi <= 0) continue;             // 主力资金无流入
    if (stock.consecutiveBoard >= 3 && cp > 8) continue;  // 连续3板以上且接近涨停 → 情绪末端

    candidates.push({
      ...stock,
      marketCapDisplay: (mc / 1e8).toFixed(0) + '亿',
      mainInflowDisplay: (mi / 1e8).toFixed(2) + '亿'
    });
  }

  candidates.sort((a, b) => {
    const aScore = (a.mainInflow||0)*0.5 + (a.marketCap||0)*0.2 + (a.turnoverRate||0)*0.3;
    const bScore = (b.mainInflow||0)*0.5 + (b.marketCap||0)*0.2 + (b.turnoverRate||0)*0.3;
    return bScore - aScore;
  });

  return candidates.slice(0, 20);
}

// 生成操作建议
function generateOperationAdvice(data, themes, consensus) {
  const mt = consensus.marketSentiment.avgChange;
  const advice = { overall: '', buyZones: [], sellConditions: [], riskWarnings: [], nextDayPlan: [] };

  if (mt > 1) {
    advice.overall = '市场强势上涨，持仓为主，新开仓需精选标的。仓位控制在70%左右，重点关注主线题材回调支撑位。';
  } else if (mt > 0.3) {
    advice.overall = '震荡偏多，主线题材清晰但轮动加速。半仓参与，低吸不追高，关注持续资金流入板块。';
  } else if (mt > 0) {
    advice.overall = '窄幅整理，方向不明。仓位控制在30-50%，以波段交易为主。关注北向资金流向和成交量变化。';
  } else {
    advice.overall = '市场处于回调阶段，仓位控制在30%以下，防御为主。关注抗跌主线品种，等待企稳信号。';
  }

  const top3 = themes.slice(0, 3);
  for (const t of top3) {
    advice.buyZones.push({
      theme: t.name,
      suggestion: '关注该板块中大市值、量价适中的个股，在5日/10日均线支撑位附近买入。',
      idealEntry: '靠近5日或10日均线处，分时回调不破前低。',
      stopLoss: '跌破10日均线或连续2日主力资金净流出则离场。'
    });
  }

  advice.sellConditions = [
    '跌破10日均线且连续2日主力资金净流出 → 减仓',
    '放量滞涨（涨幅不足1%但成交量超过5日均量2倍）→ 止盈',
    '板块龙头炸板或大幅跳水 → 减持该板块持仓',
    '大盘指数跌破关键支撑位 → 整体减仓'
  ];

  advice.riskWarnings = [
    '避免追高连续4板以上且换手极低的纯情绪炒作个股',
    '集合竞价阶段不追涨，等待开盘后走势确认',
    '单只个股仓位不超过总仓位20%，单一板块不超过30%',
    '密切关注北向资金大幅流出及大盘放量下跌信号',
    '消息面驱动的脉冲行情持续性差，宜快进快出'
  ];

  advice.nextDayPlan = generateNextDayPlan(data, themes, consensus);
  return advice;
}

function generateNextDayPlan(data, themes, consensus) {
  return [
    { phase: '盘前 (9:00-9:25)', actions: [
      '查看隔夜美股及A50期货走势，判断开盘方向',
      '关注集合竞价阶段板块强度，重点看是否有板块集中高开',
      '确认观察池标的，设置预警价位'
    ]},
    { phase: '开盘 (9:30-10:00)', actions: [
      '高开个股：等待30分钟确认能否站稳，若量能不足考虑部分止盈',
      '低开个股：等待企稳信号（15分钟内不再创新低），关注逆势走强板块',
      '观察开盘北向资金流向'
    ]},
    { phase: '盘中 (10:00-14:30)', actions: [
      '关注前两大主线题材持续性，缩量回踩均线支撑时低吸',
      '若涨停炸板率超过40%，市场分歧大 → 谨慎开新仓',
      '下午2点后若指数放量上攻，跟随主线仓位加仓'
    ]},
    { phase: '尾盘 (14:30-15:00)', actions: [
      '若尾盘放量拉升，可适当加仓博次日高开溢价',
      '若尾盘跳水，减持已有盈利仓位锁定利润',
      '收盘后复盘当日数据，更新观察池评估'
    ]}
  ];
}

// 分析观察池跟踪
function analyzeWatchlist(data) {
  const config = loadConfig();
  const watchlist = config.watchlist || [];
  return watchlist.map(item => ({
    name: item.name, code: item.code, entryPrice: item.entryPrice,
    currentPrice: null, change: null, meetsExpectation: null, note: '', action: ''
  }));
}

// 判断高开站稳 vs 冲高回落
function judgeOpenStrength(klineData) {
  if (!klineData || klineData.length < 2) return { verdict: '数据不足', confidence: 0 };

  const today = klineData[klineData.length - 1];
  const yesterday = klineData[klineData.length - 2];

  const openGap = ((today.open - yesterday.close) / yesterday.close) * 100;
  const closeVsOpen = ((today.close - today.open) / today.open) * 100;
  const volumeRatio = yesterday.volume > 0 ? today.volume / yesterday.volume : 1;

  let verdict, confidence;
  if (openGap > 2 && closeVsOpen > 1) {
    verdict = '高开站稳，强势确认';
    confidence = Math.min(volumeRatio * 30, 85);
  } else if (openGap > 2 && closeVsOpen < -0.5) {
    verdict = '高开回落 ⚠️ 需警惕';
    confidence = Math.min((Math.abs(closeVsOpen) + openGap) * 15, 90);
  } else if (openGap > 1 && closeVsOpen > 0) {
    verdict = '小幅高开，偏多';
    confidence = 55;
  } else {
    verdict = '平开或低开';
    confidence = 70;
  }

  return {
    verdict, confidence: Math.round(confidence),
    openGap: openGap.toFixed(2) + '%',
    closeVsOpen: closeVsOpen.toFixed(2) + '%',
    volumeRatio: volumeRatio.toFixed(2),
    detail: '开盘价 ' + today.open + ', 收盘价 ' + today.close + ', 昨收 ' + yesterday.close
  };
}

// 生成综合报告
function generateReport(data) {
  const themes = identifyMainThemes(data);
  const consensus = summarizeConsensus(data, themes);
  const bandTargets = findBandTradeTargets(data, themes);
  const advice = generateOperationAdvice(data, themes, consensus);

  return {
    generatedAt: new Date().toISOString(),
    marketIndices: data.indices || [],
    consensus,
    mainThemes: themes.slice(0, 10),
    bandTradeTargets: bandTargets,
    advice,
    stats: {
      totalLimitUp: (data.limitUpStocks || []).filter(s => s.changePct > 9.5).length,
      mainInflowTotal: themes.reduce((s, t) => s + (t.mainInflow || 0), 0)
    }
  };
}

function saveReport(report) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const filepath = path.join(DATA_DIR, `report_${date}.json`);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
  return filepath;
}

module.exports = {
  loadConfig, saveConfig,
  identifyMainThemes, summarizeConsensus, findBandTradeTargets,
  generateOperationAdvice, judgeOpenStrength, analyzeWatchlist,
  generateReport, saveReport
};
