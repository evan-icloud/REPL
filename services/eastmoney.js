const https = require("https");
const http = require("http");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const gbkDecoder = new TextDecoder("gbk");
const utf8Decoder = new TextDecoder("utf-8");

function fetchBuffer(urlStr, referer) {
  referer = referer || "";
  return new Promise(function(resolve, reject) {
    var lib = urlStr.startsWith("https") ? https : http;
    var headers = { "User-Agent": UA, "Accept": "*/*" };
    if (referer) headers["Referer"] = referer;
    var req = lib.get(urlStr, { headers: headers }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, referer).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() { resolve(Buffer.concat(chunks)); });
    });
    req.on("error", reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error("timeout")); });
  });
}

async function fetchText(urlStr, encoding) {
  encoding = encoding || "gbk";
  var buf = await fetchBuffer(urlStr);
  return (encoding === "utf8" ? utf8Decoder : gbkDecoder).decode(buf);
}

function parseTencentQuote(raw) {
  var results = [];
  var lines = raw.split(";").filter(Boolean);
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/="([^"]*)"/);
    if (!m) continue;
    results.push(m[1].split("~"));
  }
  return results;
}

// Sina concept/industry board list: returns board codes + metadata
async function fetchSinaBoardList(param) {
  var url = "http://money.finance.sina.com.cn/q/view/newFLJK.php?param=" + param;
  var text = await fetchText(url);

  var jsonMatch = text.match(/=\s*(\{[\s\S]*\})/);
  if (!jsonMatch) return {};
  try { return JSON.parse(jsonMatch[1]); }
  catch (e) { return {}; }
}

function parseSinaBoard(sinaData) {
  var boards = [];
  var keys = Object.keys(sinaData);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var parts = sinaData[k].split(",");
    if (parts.length < 10) continue;
    boards.push({
      code: parts[0] || "",
      name: parts[1] || "",
      stockCount: parseInt(parts[2]) || 0,
      avgPrice: parseFloat(parts[3]) || 0,
      changePct: parseFloat(parts[4]) || 0,
      avgTurnover: parseFloat(parts[5]) || 0,
      volume: parseFloat(parts[6]) || 0,
      turnover: parseFloat(parts[7]) || 0,
      leadStockCode: parts[8] || "",
      leadStockChangePct: parseFloat(parts[9]) || 0,
      leadStockPrice: parseFloat(parts[10]) || 0,
      leadStockChange: parseFloat(parts[11]) || 0,
      leadStockName: parts[12] || "",
      mainInflow: 0,
      totalInflow: 0,
      superLargeInflow: 0,
      riseCount: 0,
      fallCount: 0
    });
  }
  return boards.sort(function(a, b) { return b.changePct - a.changePct; });
}

// Concept sectors via Sina API
async function getConceptSectors() {
  var data = await fetchSinaBoardList("class");
  return parseSinaBoard(data);
}

// Industry sectors: use Tencent API which works
async function getIndustrySectors() {
  var data = await fetchSinaBoardList("industry");
  return parseSinaBoard(data);
}

// Limit-up stocks via Sina real-time quotes of A-share top movers
async function getLimitUpStocks() {
  try {
    var url = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=80&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=init";
    var text = await fetchText(url);
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data)) return [];
    return data.map(function(item) {
      return {
        code: item.symbol || "",
        name: item.name || "",
        price: parseFloat(item.trade) || 0,
        changePct: parseFloat(item.changepercent) || 0,
        change: parseFloat(item.pricechange) || 0,
        open: parseFloat(item.open) || 0,
        high: parseFloat(item.high) || 0,
        low: parseFloat(item.low) || 0,
        prevClose: parseFloat(item.settlement) || 0,
        volume: parseFloat(item.volume) || 0,
        turnover: parseFloat(item.amount) || 0,
        turnoverRate: parseFloat(item.turnoverratio) || 0,
        pe: parseFloat(item.per) || 0,
        marketCap: 0,
        floatCap: 0,
        mainInflow: 0,
        mainInflowRatio: 0,
        totalInflow: 0,
        superLargeInflow: 0,
        consecutiveBoard: 0,
        boardDesc: ""
      };
    }).filter(function(s) { return s.changePct >= 5; });
  } catch (e) { return []; }
}

async function getMarketIndices() {
  var text = await fetchText("http://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_sh000688");
  return parseTencentQuote(text).map(function(f) {
    return {
      code: f[2] || "", name: f[1] || "", price: parseFloat(f[3]) || 0,
      changePct: parseFloat(f[5]) || 0, change: parseFloat(f[4]) || 0,
      volume: parseFloat(f[6]) || 0, turnover: parseFloat(f[7]) || 0
    };
  });
}

async function getNorthBoundFlow() { return []; }

async function getDragonTigerList() { return []; }

async function getStockQuotes(codes) {
  if (!codes || !codes.length) return [];
  var formatted = codes.map(function(c) {
    return (c.startsWith("6") || c.startsWith("68")) ? "sh" + c : "sz" + c;
  });
  var text = await fetchText("http://qt.gtimg.cn/q=" + formatted.join(","));
  return parseTencentQuote(text).map(function(f) {
    return {
      code: f[2] || "", name: f[1] || "", price: parseFloat(f[3]) || 0,
      changePct: parseFloat(f[5]) || 0, open: parseFloat(f[33]) || 0,
      high: parseFloat(f[41]) || 0, low: parseFloat(f[42]) || 0,
      volume: parseFloat(f[6]) || 0, turnoverRate: parseFloat(f[38]) || 0,
      marketCap: parseFloat(f[45]) || 0, floatCap: parseFloat(f[44]) || 0,
      mainInflow: parseFloat(f[62]) || 0
    };
  });
}

async function getStockKline(code, market, days) {
  days = days || 10;
  var prefix = (code.startsWith("6") || code.startsWith("68")) ? "sh" : "sz";
  var url = "http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=" + prefix + code + "&scale=240&ma=no&datalen=" + days;
  var text = await fetchText(url);
  try {
    return (JSON.parse(text) || []).map(function(d) {
      return {
        date: d.day || "", open: parseFloat(d.open) || 0,
        close: parseFloat(d.close) || 0, high: parseFloat(d.high) || 0,
        low: parseFloat(d.low) || 0, volume: parseFloat(d.volume) || 0,
        turnover: 0, amplitude: 0, changePct: 0, change: 0, turnoverRate: 0
      };
    });
  } catch(e) { return []; }
}

async function getBigOrderStats() {
  return { buyVol: 0, sellVol: 0, netVol: 0, totalOrders: 0 };
}

async function collectAllData() {
  var ts = new Date().toISOString();
  try {
    var results = await Promise.all([
      getMarketIndices(), getConceptSectors(), getIndustrySectors(),
      getLimitUpStocks(), getNorthBoundFlow(), getDragonTigerList()
    ]);
    return {
      collectedAt: ts,
      indices: results[0],
      conceptSectors: results[1],
      industrySectors: results[2],
      limitUpStocks: results[3],
      northBound: results[4],
      dragonTiger: results[5]
    };
  } catch(e) {
    return { collectedAt: ts, error: e.message };
  }
}

module.exports = {
  getMarketIndices, getConceptSectors, getIndustrySectors,
  getLimitUpStocks, getNorthBoundFlow, getDragonTigerList,
  getStockKline, getStockQuotes, getBigOrderStats, collectAllData
};