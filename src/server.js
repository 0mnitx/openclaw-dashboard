const express = require('express');
const { exec } = require('child_process');
const os = require('os');

const app = express();
const PORT = 3000;

app.use(express.static('public'));

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
  let state = 'search'; // search -> header -> data -> done
  let passedHeader = false;
  
  for (const line of lines) {
    // 寻找 Sessions 表格开始
    if (state === 'search') {
      if (line.trim() === 'Sessions') {
        state = 'found';
      }
      continue;
    }
    
    if (state === 'found') {
      // 等待表头行（├）
      if (line.includes('├')) {
        state = 'header';
        passedHeader = true;
      }
      continue;
    }
    
    // 表头行之后，等待数据行
    if (state === 'header') {
      // 跳过表头本身
      if (line.includes('│') && !line.includes('Key') && !line.includes('├')) {
        state = 'data';
      }
    }
    
    if (state !== 'data') continue;
    
    // 表格结束标志（└）
    if (line.includes('└')) {
      break;
    }
    
    // 跳过空行和不包含 │ 的行
    if (!line.includes('│') || line.trim() === '') continue;
    
    // 解析表格行 - 去除所有 Unicode box drawing 字符
    const cleaned = line.replace(/[┌┬┤┘┴└├┼─│]/g, ' ');
    const cells = cleaned.split(/\s{2,}/).filter(c => c.trim());
    
    if (cells.length >= 4) {
      const key = cells[0].trim();
      const kind = cells[1].trim();
      const age = cells[2].trim();
      const model = cells[3].trim();
      const tokens = cells[4] ? cells[4].trim() : '';
      
      // 跳过无效行
      if (!key || key === 'Key') continue;
      
      // 提取 session ID，简化显示
      const sessionId = key.replace('agent:', '').replace(/:/g, ' › ');
      const ageDisplay = age === 'just now' ? '刚刚' : 
                        age.includes('m ago') ? age.replace('m ago', '分钟前') :
                        age.includes('h ago') ? age.replace('h ago', '小时前') :
                        age.includes('d ago') ? age.replace('d ago', '天前') : age;
      
      // 解析 token 使用
      const tokenMatch = tokens.match(/(\d+)k\/(\d+)k\s*\((\d+)%\)/);
      const tokenPercent = tokenMatch ? parseInt(tokenMatch[3]) : 0;
      
      sessions.push({
        id: sessionId,
        kind: kind,
        age: ageDisplay,
        model: model,
        tokens: tokens,
        tokenPercent: tokenPercent,
        isActive: age === 'just now'
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

// API: OpenClaw 状态（增强版）
app.get('/api/openclaw', async (req, res) => {
  const status = await getOpenClawStatus();
  const sessions = parseSessions(status.data);
  
  // 提取 Gateway 状态
  let gatewayStatus = { running: false, detail: '' };
  if (status.data) {
    const lines = status.data.split('\n');
    lines.forEach(line => {
      if (line.includes('Gateway') && line.includes('running')) {
        gatewayStatus = { running: true, detail: '运行中' };
      }
    });
  }
  
  // 统计
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

// API: Token 用量（需配置）
// 请填写你的 TokenPlan API 地址和密钥
const TOKENPLAN_CONFIG = {
  enabled: false,
  apiUrl: '',  // 例如: https://api.tokenplan.cn/usage
  apiKey: ''   // 你的 API Key
};

app.get('/api/token', async (req, res) => {
  if (!TOKENPLAN_CONFIG.enabled || !TOKENPLAN_CONFIG.apiUrl) {
    res.json({
      configured: false,
      message: '请在 src/server.js 中配置 TokenPlan API'
    });
    return;
  }
  
  try {
    const response = await fetch(TOKENPLAN_CONFIG.apiUrl, {
      headers: { 'Authorization': `Bearer ${TOKENPLAN_CONFIG.apiKey}` }
    });
    const data = await response.json();
    res.json({
      configured: true,
      ...data
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