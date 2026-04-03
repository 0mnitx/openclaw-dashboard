const express = require('express');
const { exec } = require('child_process');
const os = require('os');
const axios = require('axios');

const app = express();
const PORT = 3000;

app.use(express.static('public'));

// MiniMax Token Plan 配置
// API 文档: https://platform.minimaxi.com/docs/token-plan/intro
const TOKENPLAN_CONFIG = {
  enabled: true,
  apiUrl: 'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains',
  apiKey: 'sk-cp-H58PybR65Oz-Rv3wNgLjcXtRb_YZTjP-WbejPSsUMKsIDtolbjQb-172gEc9Bk6Tnl7xpuu24s-j4TKlBzlRozDcSe6E2WbuMfxBgnVFAFDFFpA0Y8Kgn0M'
};

// 获取 OpenClaw 状态
function getOpenClawStatus() {
  return new Promise((resolve) => {
    exec('openclaw status 2>/dev/null', { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: err.message, stdout: stdout, stderr: stderr });
      } else {
        resolve({ data: stdout, error: null });
      }
    });
  });
}

// 获取系统资源
function getSystemResources() {
  const cpu = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  let totalIdle = 0, totalTick = 0;
  cpu.forEach(c => {
    for (const type in c.times) {
      totalTick += c.times[type];
    }
    totalIdle += c.times.idle;
  });
  const cpuUsage = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  return {
    cpu: cpuUsage,
    cpuCores: cpu.length,
    memory: {
      total: formatBytes(totalMem),
      used: formatBytes(usedMem),
      free: formatBytes(freeMem),
      usedPercent: ((usedMem / totalMem) * 100).toFixed(1)
    },
    loadAvg: os.loadavg(),
    uptime: formatUptime(os.uptime()),
    hostname: os.hostname(),
    platform: os.platform() + ' ' + os.release()
  };
}

function formatBytes(bytes) {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb.toFixed(1) + ' GB';
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

// 解析 Sessions 表格
function parseSessions(text) {
  const sessions = [];
  if (!text) return sessions;
  
  const lines = text.split('\n');
  let state = 'search';
  let prevLine = '';
  
  for (const line of lines) {
    if (state === 'search') {
      if (line.trim() === 'Sessions') {
        state = 'found';
      }
      continue;
    }
    
    if (state === 'found') {
      if (line.includes('├')) {
        // Check if the PREVIOUS line was the header row (│ Key │ Kind │...)
        if (prevLine.includes('│') && prevLine.includes('Key')) {
          state = 'data';
        }
        // If not, keep searching
      }
      prevLine = line;
      continue;
    }
    
    if (state !== 'data') continue;
    
    if (line.includes('└')) {
      break;
    }
    
    if (!line.includes('│') || line.trim() === '') continue;
    
    const cleaned = line.replace(/[┌┬┤┘┴└├┼─│]/g, ' ');
    const cells = cleaned.split(/\s{2,}/).filter(c => c.trim());
    
    if (cells.length >= 4) {
      const key = cells[0].trim();
      const kind = cells[1].trim();
      const age = cells[2].trim();
      const model = cells[3].trim();
      const tokens = cells[4] ? cells[4].trim() : '';
      
      if (!key || key === 'Key') continue;
      
      const sessionId = key.replace('agent:', '').replace(/:/g, ' › ');
      
      // age 可能被拆成两个 cell，需要合并
      // 情况1: "1m" + "ago" = "1m ago"（分钟前）
      // 情况2: "just" + "now" = "just now"（活跃）
      let fullAge = age;
      if (cells[3] === 'ago' && (age.endsWith('m') || age.match(/^\d+h$/))) {
        fullAge = age + ' ' + cells[3];
      } else if (cells[3] === 'now' && age === 'just') {
        fullAge = 'just now';
      }
      
      const finalAgeDisplay = fullAge === 'just now' ? '刚刚' : 
                        fullAge.endsWith('m ago') ? fullAge.replace('m ago', '分钟前') :
                        fullAge.endsWith('h ago') ? fullAge.replace('h ago', '小时前') :
                        fullAge.endsWith('d ago') ? fullAge.replace('d ago', '天前') : fullAge;
      
      const tokenMatch = tokens.match(/(\d+)k\/(\d+)k\s*\((\d+)%\)/);
      const tokenPercent = tokenMatch ? parseInt(tokenMatch[3]) : 0;
      
      const isReallyActive = fullAge === 'just now';
      
      sessions.push({
        id: sessionId,
        kind: kind,
        age: finalAgeDisplay,
        model: model,
        tokens: tokens,
        tokenPercent: tokenPercent,
        isActive: isReallyActive
      });
    }
  }
  
  return sessions;
}

// API: 系统资源
app.get('/api/system', (req, res) => {
  const resources = getSystemResources();
  exec('df -h / | tail -1 | awk \'{print $2,$3,$5}\'', (err, stdout) => {
    if (!err && stdout) {
      const parts = stdout.trim().split(/\s+/);
      resources.disk = {
        total: parts[0],
        used: parts[1],
        percent: parts[2]
      };
    }
    res.json(resources);
  });
});

// API: OpenClaw 状态
app.get('/api/openclaw', async (req, res) => {
  const status = await getOpenClawStatus();
  const sessions = parseSessions(status.data);
  
  let gatewayStatus = { running: false, detail: '' };
  if (status.data) {
    const lines = status.data.split('\n');
    lines.forEach(line => {
      if (line.includes('Gateway') && line.includes('running')) {
        gatewayStatus = { running: true, detail: '运行中' };
      }
    });
  }
  
  const activeCount = sessions.filter(s => s.isActive).length;
  const totalSessions = sessions.length;
  
  res.json({
    error: status.error,
    data: status.data,
    sessions: sessions,
    gateway: gatewayStatus,
    summary: {
      totalSessions: totalSessions,
      activeSessions: activeCount,
      activeModels: [...new Set(sessions.map(s => s.model))]
    }
  });
});

// API: Token 用量（MiniMax Token Plan）
app.get('/api/token', async (req, res) => {
  if (!TOKENPLAN_CONFIG.enabled || !TOKENPLAN_CONFIG.apiUrl) {
    res.json({
      configured: false,
      message: '请在 src/server.js 中配置 TOKENPLAN_CONFIG'
    });
    return;
  }
  
  try {
    const response = await axios.get(TOKENPLAN_CONFIG.apiUrl, {
      headers: {
        'Authorization': `Bearer ${TOKENPLAN_CONFIG.apiKey}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    const rawData = response.data;
    const modelRemains = rawData.model_remains || [];
    
    // 提取主要模型
    const mainModel = modelRemains.find(m => m.model_name && m.model_name.includes('MiniMax-M'));
    const speechModel = modelRemains.find(m => m.model_name && m.model_name.includes('speech'));
    const imageModel = modelRemains.find(m => m.model_name && m.model_name.includes('image'));
    
    // 计算5小时窗口重置时间
    let resetIn = '未知';
    if (mainModel && mainModel.end_time) {
      const now = Date.now();
      const remainingMs = Math.max(0, mainModel.end_time - now);
      const hours = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      resetIn = hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
    }
    
    // 计算周额度重置时间
    let weeklyResetIn = '未知';
    if (mainModel && mainModel.weekly_end_time) {
      const now = Date.now();
      const remainingMs = Math.max(0, mainModel.weekly_end_time - now);
      const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      weeklyResetIn = `${days}天${hours}小时`;
    }
    
    res.json({
      configured: true,
      error: null,
      models: {
        main: mainModel ? {
          name: 'MiniMax-M*',
          used: mainModel.current_interval_total_count - mainModel.current_interval_usage_count,
          total: mainModel.current_interval_total_count,
          remaining: mainModel.current_interval_usage_count,
          percent: Math.round(((mainModel.current_interval_total_count - mainModel.current_interval_usage_count) / mainModel.current_interval_total_count) * 100),
          resetIn: resetIn
        } : null,
        speech: speechModel && speechModel.current_interval_total_count > 0 ? {
          name: 'Speech-HD',
          used: speechModel.current_interval_total_count - speechModel.current_interval_usage_count,
          total: speechModel.current_interval_total_count,
          remaining: speechModel.current_interval_usage_count,
          percent: Math.round(((speechModel.current_interval_total_count - speechModel.current_interval_usage_count) / speechModel.current_interval_total_count) * 100)
        } : null,
        image: imageModel && imageModel.current_interval_total_count > 0 ? {
          name: 'Image-01',
          used: imageModel.current_interval_total_count - imageModel.current_interval_usage_count,
          total: imageModel.current_interval_total_count,
          remaining: imageModel.current_interval_usage_count,
          percent: Math.round(((imageModel.current_interval_total_count - imageModel.current_interval_usage_count) / imageModel.current_interval_total_count) * 100)
        } : null
      },
      weekly: mainModel ? {
        used: mainModel.current_weekly_total_count - mainModel.current_weekly_usage_count,
        total: mainModel.current_weekly_total_count,
        remaining: mainModel.current_weekly_usage_count,
        resetIn: weeklyResetIn
      } : null
    });
  } catch (e) {
    res.json({
      configured: true,
      error: e.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 OpenClaw Dashboard 运行中: http://0.0.0.0:${PORT}`);
});