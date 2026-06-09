const cron = require('node-cron');
const eastmoney = require('./eastmoney');
const analysis = require('./analysis');

let serverInstance = null;
let latestReport = null;

// 盘前采集: 工作日9:10执行
// 盘中采集: 工作日11:35执行
// 盘后复盘: 工作日15:30执行

const PRE_MARKET_CRON = '10 9 * * 1-5';
const MID_DAY_CRON = '35 11 * * 1-5';
const AFTER_MARKET_CRON = '30 15 * * 1-5';
const AFTERNOON_CRON = '0 16 * * 1-5';

let tasks = {};

async function runCollection(label) {
  console.log(`[${new Date().toLocaleString()}] 开始采集: ${label}`);
  try {
    const data = await eastmoney.collectAllData();
    if (!data.error) {
      const report = analysis.generateReport(data);
      const savedPath = analysis.saveReport(report);
      latestReport = report;
      console.log(`[${new Date().toLocaleString()}] ${label} 完成, 报告保存至 ${savedPath}`);
    } else {
      console.error(`[${new Date().toLocaleString()}] ${label} 失败: ${data.error}`);
    }
    return data;
  } catch (e) {
    console.error(`[${new Date().toLocaleString()}] ${label} 异常:`, e.message);
    return { error: e.message };
  }
}

function start() {
  console.log('=== 定时调度器启动 ===');

  tasks.preMarket = cron.schedule(PRE_MARKET_CRON, () => runCollection('盘前采集'), { timezone: 'Asia/Shanghai' });
  tasks.midDay = cron.schedule(MID_DAY_CRON, () => runCollection('盘中采集'), { timezone: 'Asia/Shanghai' });
  tasks.afterMarket = cron.schedule(AFTER_MARKET_CRON, () => runCollection('盘后复盘'), { timezone: 'Asia/Shanghai' });
  tasks.afternoon = cron.schedule(AFTERNOON_CRON, () => runCollection('尾盘整理'), { timezone: 'Asia/Shanghai' });

  console.log('调度规则:');
  console.log('  盘前采集: 每个工作日 09:10');
  console.log('  盘中采集: 每个工作日 11:35');
  console.log('  盘后复盘: 每个工作日 15:30');
  console.log('  尾盘整理: 每个工作日 16:00');
}

function stop() {
  for (const [key, task] of Object.entries(tasks)) {
    if (task && task.stop) task.stop();
  }
  tasks = {};
  console.log('调度器已停止');
}

function getLatestReport() {
  return latestReport;
}

function getStatus() {
  const nextRuns = {};
  for (const [key, task] of Object.entries(tasks)) {
    if (task && task.nextDate) {
      nextRuns[key] = task.nextDate().toJSDate().toLocaleString('zh-CN');
    } else {
      nextRuns[key] = '无';
    }
  }
  return {
    running: Object.keys(tasks).length > 0,
    lastReport: latestReport ? latestReport.generatedAt : null,
    nextRuns
  };
}

module.exports = { start, stop, runCollection, getLatestReport, getStatus };
