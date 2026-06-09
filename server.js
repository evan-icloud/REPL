const express = require('express');
const path = require('path');
const fs = require('fs');
const eastmoney = require('./services/eastmoney');
const analysis = require('./services/analysis');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: 手动触发数据采集
app.get('/api/collect', async (req, res) => {
  try {
    const data = await eastmoney.collectAllData();
    if (!data.error) {
      const report = analysis.generateReport(data);
      analysis.saveReport(report);
      res.json({ success: true, report });
    } else {
      res.json({ success: false, error: data.error });
    }
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 获取最新报告
app.get('/api/report', (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const filepath = path.join(__dirname, 'data', 'daily', `report_${date}.json`);

  if (fs.existsSync(filepath)) {
    const report = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return res.json({ success: true, report, source: 'file' });
  }

  const liveReport = scheduler.getLatestReport();
  if (liveReport) {
    return res.json({ success: true, report: liveReport, source: 'memory' });
  }

  res.json({ success: false, error: '暂无报告,请先采集数据' });
});

// API: 获取历史报告列表
app.get('/api/reports', (req, res) => {
  const dir = path.join(__dirname, 'data', 'daily');
  if (!fs.existsSync(dir)) return res.json({ success: true, reports: [] });

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 10);

  res.json({ success: true, reports: files });
});

// API: 获取指定日期的报告
app.get('/api/report/:date', (req, res) => {
  const filepath = path.join(__dirname, 'data', 'daily', `report_${req.params.date}.json`);
  if (fs.existsSync(filepath)) {
    const report = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return res.json({ success: true, report });
  }
  res.json({ success: false, error: '报告不存在' });
});

// API: 实时大盘指数
app.get('/api/indices', async (req, res) => {
  try {
    const indices = await eastmoney.getMarketIndices();
    res.json({ success: true, indices });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 实时概念板块
app.get('/api/sectors/concept', async (req, res) => {
  try {
    const sectors = await eastmoney.getConceptSectors();
    res.json({ success: true, sectors });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 实时行业板块
app.get('/api/sectors/industry', async (req, res) => {
  try {
    const sectors = await eastmoney.getIndustrySectors();
    res.json({ success: true, sectors });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 涨停板
app.get('/api/limitup', async (req, res) => {
  try {
    const stocks = await eastmoney.getLimitUpStocks();
    res.json({ success: true, stocks });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 龙虎榜
app.get('/api/dragontiger', async (req, res) => {
  try {
    const list = await eastmoney.getDragonTigerList();
    res.json({ success: true, list });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 北向资金
app.get('/api/northbound', async (req, res) => {
  try {
    const flow = await eastmoney.getNorthBoundFlow();
    res.json({ success: true, flow });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 个股K线
app.get('/api/kline/:code', async (req, res) => {
  try {
    const market = req.query.market || (req.params.code.startsWith('6') ? '1' : '0');
    const days = parseInt(req.query.days) || 10;
    const kline = await eastmoney.getStockKline(req.params.code, market, days);
    res.json({ success: true, kline });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 高开/冲高回落判断
app.get('/api/judge/:code', async (req, res) => {
  try {
    const market = req.query.market || (req.params.code.startsWith('6') ? '1' : '0');
    const kline = await eastmoney.getStockKline(req.params.code, market, 5);
    const result = analysis.judgeOpenStrength(kline);
    res.json({ success: true, result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// API: 观察池配置
app.get('/api/watchlist', (req, res) => {
  const config = analysis.loadConfig();
  res.json({ success: true, watchlist: config.watchlist || [] });
});

app.post('/api/watchlist', (req, res) => {
  const config = analysis.loadConfig();
  config.watchlist = req.body.watchlist || [];
  analysis.saveConfig(config);
  res.json({ success: true });
});

// API: 调度器状态
app.get('/api/scheduler', (req, res) => {
  res.json({ success: true, status: scheduler.getStatus() });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  股票交易日线看板服务已启动`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  数据源: 东方财富免费API`);
  console.log(`========================================\n`);

  scheduler.start();

  console.log('按 Ctrl+C 停止服务\n');
});
