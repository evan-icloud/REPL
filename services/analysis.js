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

  const sorted = [...allSectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 20);

  for (const sector of sorted) {
    const changes = sorted.map(s => s.changePct || 0);
    const maxPct = Math.max(...changes, 0.01);
    const minPct = Math.min(...changes, -0.01);
    const range = Math.max(maxPct - minPct, 0.01);
    const maxTurnover = Math.max(...sorted.map(s => s.turnover || 0), 1);
    const maxCount = Math.max(...sorted.map(s => s.stockCount || 0), 1);
    const maxLeadPct = Math.max(...sorted.map(s => Math.abs(s.leadStockChangePct || 0)), 1);

    // 归一化到 [0,1] 区间后再加权
    const pctNorm = maxPct > 0 ? Math.max((sector.changePct || 0) - minPct, 0) / range : 0.5;
    const pctScore = pctNorm * 40;
    const turnoverScore = ((sector.turnover || 0) / maxTurnover) * 30;
    const sizeScore = ((sector.stockCount || 0) / maxCount) * 15;
    const leadScore = ((Math.abs(sector.leadStockChangePct || 0)) / maxLeadPct) * 15;

    sector.score = pctScore + turnoverScore + sizeScore + leadScore;
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
  let allStocks = [...(limitUpStocks || []), ...(dragonTiger || [])];

  // 当涨停池为空时，从主线板块龙头中抽取标的
  if (allStocks.length === 0 && themes && themes.length > 0) {
    const seen = new Set();
    for (const t of themes.slice(0, 8)) {
      const code = t.leadStockCode || (t.leadStockInfo && t.leadStockInfo.code);
      const name = t.leadStockName || (t.leadStockInfo && t.leadStockInfo.name);
      const cp = t.leadStockChangePct || (t.leadStockInfo && t.leadStockInfo.changePct) || 0;
      if (code && !seen.has(code)) {
        seen.add(code);
        allStocks.push({
          code: code, name: name || code,
          price: t.leadStockPrice || 0, changePct: cp,
          change: t.leadStockChange || 0, turnoverRate: 5,
          marketCap: 1e10, pe: 0, mainInflow: 0,
          consecutiveBoard: 0, boardDesc: '板块龙头'
        });
      }
    }
  }

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

    // 放宽筛选条件，确保熊市也有候选池
    if (mc < 1e10 && mc !== 0) continue;
    if (cp <= -5 || cp > 10) continue;

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
      '收盘后复盘当日数据，更新观察池评级'
    ]}
  ];
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
  const filepath = path.join(DATA_DIR, 'report_' + date + '.json');
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
  return filepath;
}

function calcMA(kline, period) {
  if (!kline || kline.length === 0) return null;
  const list = kline.slice(-period);
  const sum = list.reduce((s, k) => s + k.close, 0);
  return sum / list.length;
}

function calcAvgVolume(kline, days) {
  if (!kline || kline.length === 0) return 0;
  const list = kline.slice(-days);
  const sum = list.reduce((s, k) => s + (k.volume || 0), 0);
  return sum / list.length;
}

const MSG = {
  bullNoVol: '\u591a\u5934\u6392\u5217\u4f46\u6210\u4ea4\u91cf\u4e0d\u8db3\uff0c\u53ef\u8f7b\u4ed3\u8bd5\u63a2',
  buy: "\u4e70\u5165",
  lightBuy: "\u8f7b\u4ed3\u8bd5\u4e70",
  hold: "\u6301\u6709\u89c2\u671b",
  sell: "\u5356\u51fa/\u56de\u907f",
  noData: "\u6570\u636e\u4e0d\u8db3",
  strongTrend: "\u5f3a\u52bf",
  slightStrong: "\u504f\u5f3a",
  neutral: "\u4e2d\u6027",
  slightWeak: "\u504f\u5f31",
  weakTrend: "\u5f31\u52bf",
  bullAlign: "\u591a\u5934\u6392\u5217",
  bearAlign: "\u7a7a\u5934\u6392\u5217",
  maWeave: "\u5747\u7ebf\u4ea4\u7ec7",
  ma20Support: "MA20\u5747\u7ebf\u652f\u6491",
  lowSupport: "20\u65e5\u4f4e\u70b9\u652f\u6491",
  ma5Resist: "MA5\u5747\u7ebf\u963b\u529b",
  highResist: "20\u65e5\u9ad8\u70b9\u963b\u529b",
  shrinkVol: "\u7f29\u91cf",
  normalVol: "\u91cf\u80fd\u6b63\u5e38",
  mildVolUp: "\u6e29\u548c\u653e\u91cf",
  bigVolUp: "\u660e\u663e\u653e\u91cf",
  klineInsufficient: "K\u7ebf\u6570\u636e\u4e0d\u8db3",
  need5days: "\u9700\u8981\u81f3\u5c115\u4e2a\u4ea4\u6613\u65e5\u6570\u636e",
  bullVolUp: "\u591a\u5934\u6392\u5217 + \u653e\u91cf\u4e0a\u653b",
  nearSupportVolUp: "\u9760\u8fd1\u652f\u6491 + \u653e\u91cf\u53cd\u5f39",
  nearResistShrink: "\u9760\u8fd1\u963b\u529b + \u7f29\u91cf\uff0c\u53ef\u80fd\u56de\u8c03",
  bearShrink: "\u7a7a\u5934\u6392\u5217 + \u7f29\u91cf\uff0c\u504f\u5f31",
  bullNearResist: "\u591a\u5934\u4f46\u9760\u8fd1\u963b\u529b\uff0c\u89c2\u671b\u7a81\u7834",
  neutralNearSupport: "\u9707\u8361\u4f46\u9760\u8fd1\u652f\u6491\uff0c\u53ef\u8f7b\u4ed3",
  signalUnclear: "\u4fe1\u53f7\u4e0d\u660e\u786e\uff0c\u5efa\u8bae\u89c2\u671b",
  summaryBuy: "\u5f53\u524d\u89c2\u5bdf\u6c60\u6709 STOCKCOUNT \u53ea\u4e2a\u80a1\u5448\u4e70\u5165\u4fe1\u53f7\uff0c\u5efa\u8bae\u91cd\u70b9\u5173\u6ce8\u4e0a\u8ff0\u6807\u7684\u3002",
  summarySomeBuy: "\u89c2\u5bdf\u6c60\u6709 STOCKCOUNT \u53ea\u4e2a\u80a1\u5448\u4e70\u5165\u4fe1\u53f7\uff0c\u53ef\u9002\u5f53\u53c2\u4e0e\u3002",
  summarySell: "\u5927\u591a\u6570\u4e2a\u80a1\u5448\u5356\u51fa/\u56de\u907f\u4fe1\u53f7\uff0c\u5efa\u8bae\u964d\u4f4e\u4ed3\u4f4d\u3001\u89c2\u671b\u4e3a\u4e3b\u3002",
  summaryMixed: "\u4e70\u5356\u4fe1\u53f7\u6df7\u6742\uff0c\u5efa\u8bae\u6301\u4ed3\u89c2\u671b\u3001\u7b49\u5f85\u65b9\u5411\u660e\u786e\u3002"
};

function analyzeSingleStock(name, code, quote, klineData) {
  const result = {
    code, name,
    currentPrice: quote ? quote.price : 0,
    changePct: quote ? quote.changePct : 0,
    maValues: { ma5: null, ma10: null, ma20: null },
    volumeAnalysis: { todayVol: 0, avg5Vol: 0, volRatio: 0, description: "" },
    support: { level: 0, type: "", description: "" },
    resistance: { level: 0, type: "", description: "" },
    trend: { direction: "", strength: "", description: "" },
    recommendation: { action: "", confidence: 50, entryPrice: null, stopLoss: null, targetPrice: null, riskReward: "-", reason: "" }
  };

  if (!klineData || klineData.length < 5) {
    result.trend.description = MSG.klineInsufficient;
    result.recommendation.action = MSG.noData;
    result.recommendation.reason = MSG.need5days;
    return result;
  }

  result.maValues.ma5 = +calcMA(klineData, 5).toFixed(2);
  result.maValues.ma10 = +calcMA(klineData, 10).toFixed(2);
  result.maValues.ma20 = +calcMA(klineData, 20).toFixed(2);

  const latest = klineData[klineData.length - 1];
  const latestClose = latest.close;
  const todayVol = latest.volume || 0;
  const avg5Vol = calcAvgVolume(klineData, 5);

  result.volumeAnalysis.todayVol = todayVol;
  result.volumeAnalysis.avg5Vol = avg5Vol;
  result.volumeAnalysis.volRatio = avg5Vol > 0 ? +(todayVol / avg5Vol).toFixed(2) : 1;
  if (result.volumeAnalysis.volRatio < 0.5) result.volumeAnalysis.description = MSG.shrinkVol;
  else if (result.volumeAnalysis.volRatio < 1.2) result.volumeAnalysis.description = MSG.normalVol;
  else if (result.volumeAnalysis.volRatio < 2.0) result.volumeAnalysis.description = MSG.mildVolUp;
  else result.volumeAnalysis.description = MSG.bigVolUp;

  const closes = klineData.map(k => k.close);
  const highs = klineData.map(k => k.high);
  const lows = klineData.map(k => k.low);
  const recent20Low = lows.length >= 20 ? Math.min(...lows.slice(-20)) : Math.min(...lows);
  const recent20High = highs.length >= 20 ? Math.max(...highs.slice(-20)) : Math.max(...highs);
  const ma5 = result.maValues.ma5;
  const ma10 = result.maValues.ma10;
  const ma20 = result.maValues.ma20;

  const supportCandidates = [ma5, ma10, ma20, recent20Low].filter(v => v != null && v > 0 && v < latestClose);
  result.support.level = supportCandidates.length ? Math.max(...supportCandidates) : recent20Low;
  if (result.support.level === ma20) { result.support.type = MSG.ma20Support; }
  else { result.support.type = MSG.lowSupport; }
  result.support.description = result.support.type + " = " + result.support.level.toFixed(2);

  const resistCandidates = [ma5, ma10, ma20, recent20High].filter(v => v != null && v > 0 && v > latestClose);
  result.resistance.level = resistCandidates.length ? Math.min(...resistCandidates) : recent20High;
  if (result.resistance.level === ma5) { result.resistance.type = MSG.ma5Resist; }
  else { result.resistance.type = MSG.highResist; }
  result.resistance.description = result.resistance.type + " = " + result.resistance.level.toFixed(2);

  let trendScore = 0;
  if (ma5 != null && ma10 != null && ma20 != null) {
    if (ma5 > ma10 && ma10 > ma20) { result.trend.direction = MSG.bullAlign; trendScore = 2; }
    else if (ma5 < ma10 && ma10 < ma20) { result.trend.direction = MSG.bearAlign; trendScore = -2; }
    else { result.trend.direction = MSG.maWeave; trendScore = 0; }
  }
  if (latestClose > (ma5 || 0)) trendScore += 1;
  else if (latestClose < (ma20 || 0)) trendScore -= 1;

  if (trendScore >= 2) result.trend.strength = MSG.strongTrend;
  else if (trendScore === 1) result.trend.strength = MSG.slightStrong;
  else if (trendScore === 0) result.trend.strength = MSG.neutral;
  else if (trendScore === -1) result.trend.strength = MSG.slightWeak;
  else result.trend.strength = MSG.weakTrend;

  result.trend.description = result.trend.direction + " (" + result.trend.strength + ")";

  const rec = generateStockRecommendation(result);
  result.recommendation = rec;

  // AI-style 综合评语
  result.aiSummary = generateAISummary(result);

  return result;
}

function generateStockRecommendation(analysis) {
  const { currentPrice, maValues, volumeAnalysis, support, resistance, trend } = analysis;
  let action = MSG.hold, entryPrice = null, stopLoss = null, targetPrice = null, confidence = 50;
  const reasons = [];

  const priceAboveMA5 = currentPrice > (maValues.ma5 || 0);
  const priceAboveMA20 = currentPrice > (maValues.ma20 || 0);
  const volStrong = volumeAnalysis.volRatio > 0.8;
  const volWeak = volumeAnalysis.volRatio < 0.5;
  const nearSupport = support.level > 0 && currentPrice <= support.level * 1.03;
  const nearResistance = resistance.level > 0 && currentPrice >= resistance.level * 0.97;

  if (trend.strength === MSG.strongTrend && priceAboveMA5) {
    action = volStrong ? MSG.buy : MSG.lightBuy;
    confidence = volStrong ? 75 : 60;
    entryPrice = currentPrice;
    stopLoss = +(support.level * 0.97).toFixed(2);
    targetPrice = +(resistance.level * 1.05).toFixed(2);
    reasons.push(volStrong ? MSG.bullVolUp : MSG.bullNoVol);
  } else if (trend.strength === MSG.slightStrong && nearSupport) {
    action = volStrong ? MSG.buy : MSG.lightBuy;
    confidence = volStrong ? 65 : 55;
    entryPrice = currentPrice;
    stopLoss = +(support.level * 0.96).toFixed(2);
    targetPrice = +(resistance.level * 1.03).toFixed(2);
    reasons.push(MSG.nearSupportVolUp);
  } else if ((trend.strength === MSG.weakTrend || trend.strength === MSG.slightWeak) && volWeak) {
    action = MSG.sell;
    confidence = 70;
    reasons.push(MSG.bearShrink);
    if (support.level > 0) stopLoss = +(support.level * 0.95).toFixed(2);
  } else if (nearResistance && volWeak) {
    action = MSG.sell;
    confidence = 65;
    reasons.push(MSG.nearResistShrink);
  } else if (trend.strength === MSG.strongTrend && nearResistance) {
    action = MSG.hold;
    confidence = 55;
    targetPrice = +(resistance.level * 1.05).toFixed(2);
    stopLoss = +(support.level * 0.97).toFixed(2);
    reasons.push(MSG.bullNearResist);
  } else if (trend.strength === MSG.neutral && nearSupport) {
    action = MSG.lightBuy;
    confidence = 60;
    entryPrice = currentPrice;
    stopLoss = +(support.level * 0.95).toFixed(2);
    targetPrice = +(resistance.level).toFixed(2);
    reasons.push(MSG.neutralNearSupport);
  } else if (trend.strength === MSG.slightStrong && priceAboveMA5) {
    action = MSG.hold;
    confidence = 55;
    reasons.push(MSG.signalUnclear);
  } else {
    action = MSG.hold;
    confidence = 50;
    reasons.push(MSG.signalUnclear);
  }

  let riskReward = "-";
  if (entryPrice && stopLoss && targetPrice && stopLoss < entryPrice && targetPrice > entryPrice) {
    const risk = entryPrice - stopLoss;
    const reward = targetPrice - entryPrice;
    if (risk > 0) riskReward = "1:" + (reward / risk).toFixed(1);
  }

  return {
    action, confidence: Math.round(confidence),
    entryPrice: entryPrice ? +entryPrice.toFixed(2) : null,
    stopLoss: stopLoss ? +stopLoss.toFixed(2) : null,
    targetPrice: targetPrice ? +targetPrice.toFixed(2) : null,
    riskReward,
    reason: reasons.join("\u3001")
  };
}
function generateStockSummary(stocks) {
  if (!stocks || stocks.length === 0) return { total: 0, buyCount: 0, sellCount: 0, holdCount: 0, topPicks: [], overallAdvice: "" };

  const buyStocks = stocks.filter(s => s.recommendation.action === MSG.buy || s.recommendation.action === MSG.lightBuy);
  const sellStocks = stocks.filter(s => s.recommendation.action === MSG.sell);
  const holdStocks = stocks.filter(s => s.recommendation.action === MSG.hold || s.recommendation.action === MSG.noData);

  const byConfidence = [...stocks].filter(s => s.recommendation.confidence >= 50)
    .sort((a, b) => b.recommendation.confidence - a.recommendation.confidence);

  const topPicks = byConfidence.slice(0, 3).map(s => ({
    code: s.code,
    name: s.name,
    action: s.recommendation.action,
    confidence: s.recommendation.confidence,
    reason: s.recommendation.reason,
    entryPrice: s.recommendation.entryPrice,
    stopLoss: s.recommendation.stopLoss,
    targetPrice: s.recommendation.targetPrice
  }));

  let overallAdvice = "";
  if (buyStocks.length >= 3) {
    overallAdvice = MSG.summaryBuy.replace("STOCKCOUNT", buyStocks.length);
  } else if (buyStocks.length >= 1) {
    overallAdvice = MSG.summarySomeBuy.replace("STOCKCOUNT", buyStocks.length);
  } else if (sellStocks.length >= stocks.length * 0.6) {
    overallAdvice = MSG.summarySell;
  } else {
    overallAdvice = MSG.summaryMixed;
  }

  return {
    total: stocks.length,
    buyCount: buyStocks.length,
    sellCount: sellStocks.length,
    holdCount: holdStocks.length,
    topPicks,
    overallAdvice
  };
}

async function analyzeIndividualStocks(eastmoney, watchlist) {
  if (!watchlist || watchlist.length === 0) return [];
  const codes = watchlist.map(w => w.code).filter(Boolean);
  if (codes.length === 0) return [];

  const quotes = await eastmoney.getStockQuotes(codes).catch(() => []);
  const quoteMap = {};
  for (const q of (quotes || [])) quoteMap[q.code] = q;

  const results = [];
  for (const item of watchlist) {
    const quote = quoteMap[item.code] || null;
    let klineData = [];
    try {
      const market = item.code.startsWith("6") ? "1" : "0";
      klineData = await eastmoney.getStockKline(item.code, market, 30);
    } catch (e) { /* ignore */ }
    const analysis = analyzeSingleStock(item.name, item.code, quote, klineData);
    results.push(analysis);
  }
  return results;
}



function judgeOpenStrength(kline) {
  if (!kline || kline.length < 2) return { verdict: '\u6570\u636e\u4e0d\u8db3', confidence: 0 };
  const today = kline[kline.length - 1];
  const yesterday = kline[kline.length - 2];
  const openGap = ((today.open - yesterday.close) / yesterday.close) * 100;
  const closeVsOpen = ((today.close - today.open) / today.open) * 100;
  const volumeRatio = yesterday.volume > 0 ? today.volume / yesterday.volume : 1;
  let verdict, confidence;
  if (openGap > 2 && closeVsOpen > 1) {
    verdict = '\u9ad8\u5f00\u7ad9\u7a33\uff0c\u5f3a\u52bf\u786e\u8ba4';
    confidence = Math.min(volumeRatio * 30, 85);
  } else if (openGap > 2 && closeVsOpen < -0.5) {
    verdict = '\u9ad8\u5f00\u56de\u843d \u26a0\ufe0f \u9700\u8b66\u60d5';
    confidence = Math.min((Math.abs(closeVsOpen) + openGap) * 15, 90);
  } else if (openGap > 1 && closeVsOpen > 0) {
    verdict = '\u5c0f\u5e45\u9ad8\u5f00\uff0c\u504f\u591a';
    confidence = 55;
  } else { verdict = '\u5e73\u5f00\u6216\u4f4e\u5f00'; confidence = 70; }
  return { verdict, confidence: Math.round(confidence), openGap: openGap.toFixed(2) + '%', closeVsOpen: closeVsOpen.toFixed(2) + '%', volumeRatio: volumeRatio.toFixed(2) };
}

function analyzeWatchlist(eastmoney) {
  return [];
}

function generateAISummary(analysis) {
  const { name, code, currentPrice, changePct, maValues, volumeAnalysis, support, resistance, trend, recommendation } = analysis;
  const action = recommendation.action;
  const conf = recommendation.confidence;
  const vol = volumeAnalysis;
  const sup = support;
  const res = resistance;

  let summary = '\u3010' + name + ' ' + code + '\u3011' +
    '\u5f53\u524d\u4ef7\u003a\u00a5' + (currentPrice || 0).toFixed(2) +
    '\uff0c\u4eca\u65e5' + (changePct > 0 ? '\u002b' : '') + (changePct || 0).toFixed(2) + '\u0025' +
    '\u3002\u8d8b\u52bf\u003a' + trend.description + '\u3002' +
    '\u91cf\u80fd\u003a' + (vol ? vol.description : '\u65e0\u6570\u636e') + '\uff0c\u91cf\u6bd4\u003a' + (vol ? vol.volRatio.toFixed(2) + '\u0058' : '-') + '\u3002';

  summary += '\u652f\u6491\u4f4d\u003a' + sup.description + '\uff0c' +
    '\u963b\u529b\u4f4d\u003a' + res.description + '\u3002';

  if (action === '\u4e70\u5165' || action === '\u8f7b\u4ed3\u8bd5\u4e70') {
    summary += '\u2605 \u64cd\u4f5c\u5efa\u8bae\u003a' + action +
      '\uff08\u4fe1\u5fc3\u5ea6 ' + conf + '\u0025\uff09\u3002' +
      '\u7406\u7531\u003a' + recommendation.reason + '\u3002';
    if (recommendation.entryPrice) {
      summary += '\u5efa\u8bae\u5165\u573a\u003a\u00a5' + recommendation.entryPrice +
        '\uff0c\u6b62\u635f\u003a\u00a5' + (recommendation.stopLoss || '-') +
        '\uff0c\u76ee\u6807\u003a\u00a5' + (recommendation.targetPrice || '-');
    }
    if (recommendation.riskReward && recommendation.riskReward !== '-') {
      summary += '\uff0c\u98ce\u62a5\u6bd4 ' + recommendation.riskReward;
    }
    summary += '\u3002';
  } else if (action === '\u5356\u51fa/\u56de\u907f') {
    summary += '\u26a0\ufe0f \u64cd\u4f5c\u5efa\u8bae\u003a' + action +
      '\uff08\u4fe1\u5fc3\u5ea6 ' + conf + '\u0025\uff09\u3002' +
      '\u7406\u7531\u003a' + recommendation.reason + '\u3002' +
      '\u5efa\u8bae\u89c2\u671b\u6216\u51cf\u4ed3\uff0c\u7b49\u5f85\u66f4\u6e05\u6670\u7684\u5165\u573a\u4fe1\u53f7\u3002';
  } else {
    summary += '\u25cf \u64cd\u4f5c\u5efa\u8bae\u003a' + action +
      '\uff08\u4fe1\u5fc3\u5ea6 ' + conf + '\u0025\uff09\u3002' +
      '\u7406\u7531\u003a' + recommendation.reason + '\u3002' +
      '\u5efa\u8bae\u7b49\u5f85\u7a81\u7834\u4fe1\u53f7\u660e\u786e\u540e\u518d\u505a\u51b3\u7b56\u3002';
  }

  return summary;
}

module.exports = {
  loadConfig, saveConfig,
  identifyMainThemes, summarizeConsensus, findBandTradeTargets,
  generateOperationAdvice, judgeOpenStrength, analyzeWatchlist,
  generateReport, saveReport,
  analyzeSingleStock, analyzeIndividualStocks, calcMA, calcAvgVolume,
  generateStockRecommendation, generateStockSummary, generateAISummary
};
