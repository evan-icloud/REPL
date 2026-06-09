const https = require('https');
const http = require('http');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const decoder = new TextDecoder('gbk');

function fetchBuffer(urlStr) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    const req = lib.get(urlStr, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchText(urlStr) {
  const buf = await fetchBuffer(urlStr);
  return decoder.decode(buf);
}

async function fetchJSON(urlStr) {
  const text = await fetchText(urlStr);
  try { return JSON.parse(text); }
  catch(e) { throw new Error('JSON parse: ' + e.message); }
}

function parseTencentQuote(raw) {
  const results = [];
  const lines = raw.split(';\n').filter(Boolean);
  for (const line of lines) {
    const m = line.match(/="([^"]*)"/);
    if (!m) continue;
    results.push(m[1].split('~'));
  }
  return results;
}

async function getMarketIndices() {
  const text = await fetchText('http://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_sh000688');
  return parseTencentQuote(text).map(f => ({
    code: f[2] || '', name: f[1] || '', price: parseFloat(f[3]) || 0,
    changePct: parseFloat(f[5]) || 0, change: parseFloat(f[4]) || 0,
    volume: parseFloat(f[6]) || 0, turnover: parseFloat(f[7]) || 0
  }));
}

async function getConceptSectors() {
  // Fetch top-ranked concept boards from Sina
  const codes = [];
  for (let i = 1; i <= 50; i++) codes.push('pt01801' + String(i).padStart(3, '0'));
  const text = await fetchText('http://qt.gtimg.cn/q=' + codes.join(','));
  return parseTencentQuote(text).map(f => ({
    code: f[2] || '', name: f[1] || '', price: parseFloat(f[3]) || 0,
    changePct: parseFloat(f[5]) || 0, mainInflow: 0, totalInflow: 0,
    superLargeInflow: 0, riseCount: 0, fallCount: 0,
    leadStock: '', leadStockChange: 0, leadStockName: ''
  })).filter(s => s.name).sort((a,b) => b.changePct - a.changePct);
}

async function getIndustrySectors() {
  const codes = [];
  for (let i = 850; i <= 900; i++) codes.push('pt01801' + i);
  const text = await fetchText('http://qt.gtimg.cn/q=' + codes.join(','));
  return parseTencentQuote(text).map(f => ({
    code: f[2] || '', name: f[1] || '', price: parseFloat(f[3]) || 0,
    changePct: parseFloat(f[5]) || 0, mainInflow: 0, totalInflow: 0,
    superLargeInflow: 0, riseCount: 0, fallCount: 0,
    leadStock: '', leadStockChange: 0, leadStockName: ''
  })).filter(s => s.name).sort((a,b) => b.changePct - a.changePct);
}

async function getLimitUpStocks() {
  const codes = [];
  for (let i = 1; i <= 30; i++) codes.push('sh60' + String(i).padStart(4, '0'));
  for (let i = 1; i <= 30; i++) codes.push('sz00' + String(i).padStart(4, '0'));
  for (let i = 1; i <= 30; i++) codes.push('sz30' + String(i).padStart(4, '0'));
  const text = await fetchText('http://hq.sinajs.cn/list=' + codes.join(','));
  const results = [];
  for (const line of text.split('\n').filter(Boolean)) {
    const m = line.match(/"([^"]*)"/);
    if (!m) continue;
    const p = m[1].split(',');
    if (p.length < 30) continue;
    const cp = parseFloat(p[3]) || 0;
    if (cp < 2) continue;
    results.push({ code: p[1] || '', name: p[0] || '', price: parseFloat(p[2]) || 0,
      changePct: cp, open: parseFloat(p[4]) || 0, high: parseFloat(p[5]) || 0,
      low: parseFloat(p[6]) || 0, volume: parseFloat(p[7]) || 0, turnover: parseFloat(p[8]) || 0,
      turnoverRate: 0, marketCap: 0, floatCap: 0, mainInflow: 0, mainInflowRatio: 0,
      totalInflow: 0, superLargeInflow: 0, consecutiveBoard: 0, boardDesc: ''
    });
  }
  return results.sort((a,b) => b.changePct - a.changePct).slice(0, 50);
}

async function getNorthBoundFlow() { return null; }
async function getDragonTigerList() { return await getLimitUpStocks(); }

async function getStockKline(code, market, days = 10) {
  const prefix = (code.startsWith('6') || code.startsWith('68')) ? 'sh' : 'sz';
  const text = await fetchText('http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + prefix + code + '&scale=240&ma=no&datalen=' + days);
  try {
    return (JSON.parse(text) || []).map(d => ({ date: d.day || '', open: parseFloat(d.open) || 0,
      close: parseFloat(d.close) || 0, high: parseFloat(d.high) || 0, low: parseFloat(d.low) || 0,
      volume: parseFloat(d.volume) || 0, turnover: 0, amplitude: 0, changePct: 0, change: 0, turnoverRate: 0
    }));
  } catch(e) { return []; }
}

async function getStockQuotes(codes) {
  if (!codes || !codes.length) return [];
  const formatted = codes.map(c => (c.startsWith('6')||c.startsWith('68')) ? 'sh'+c : 'sz'+c);
  const text = await fetchText('http://qt.gtimg.cn/q=' + formatted.join(','));
  return parseTencentQuote(text).map(f => ({
    code: f[2]||'', name: f[1]||'', price: parseFloat(f[3])||0,
    changePct: parseFloat(f[5])||0, open: parseFloat(f[33])||0,
    high: parseFloat(f[41])||0, low: parseFloat(f[42])||0,
    volume: parseFloat(f[6])||0, turnoverRate: parseFloat(f[38])||0,
    marketCap: parseFloat(f[45])||0, floatCap: parseFloat(f[44])||0,
    mainInflow: parseFloat(f[62])||0
  }));
}

async function getBigOrderStats() { return { buyVol:0, sellVol:0, netVol:0, totalOrders:0 }; }

async function collectAllData() {
  const ts = new Date().toISOString();
  try {
    const [indices, conceptSectors, industrySectors, limitUpStocks, northBound, dragonTiger] =
      await Promise.all([getMarketIndices(), getConceptSectors(), getIndustrySectors(),
        getLimitUpStocks(), getNorthBoundFlow(), getDragonTigerList()]);
    return { timestamp: ts, conceptSectors, industrySectors, limitUpStocks, northBound, dragonTiger, indices };
  } catch(e) {
    return { timestamp: ts, error: e.message };
  }
}

module.exports = { fetchText, fetchJSON, getConceptSectors, getIndustrySectors, getLimitUpStocks,
  getNorthBoundFlow, getDragonTigerList, getMarketIndices, getStockKline, getStockQuotes,
  getBigOrderStats, collectAllData };
