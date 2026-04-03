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
  
  // CPU 使用率（简化计算）
  let totalIdle = 0, totalTick = 0;
  cpu.forEach(c => {
    for (const type in c.times) {
      totalTick += c.times[type];
    }
    totalIdle += c.times.idle;
  });
  const cpuUsage = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  // 磁盘使用率
  exec('df -h / | tail -1 | awk \'{print $2,$3,$5}\'', (err, stdout) => {
    // 处理磁盘
  });

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

// 解析 openclaw status 输出
function parseOpenClawStatus(text) {
  if (!text || text.error) return { raw: text.data || text.error };
  
  const lines = text.data.split('\n');
  const result = {
    overview: {},
    gateway: {},
    sessions: [],
    channels: [],
    raw: text.data
  };

  let section = '';
  lines.forEach(line => {
    if (line.includes('┌─')) section = 'overview';
    if (line.includes('Gateway')) section = 'gateway';
    if (line.includes('Sessions')) section = 'sessions';
    if (line.includes('Channels')) section = 'channels';
  });

  return result;
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
  res.json(status);
});

// API: Token 用量（需配置）
app.get('/api/token', (req, res) => {
  // 这里留空，用户可以自行配置 tokenplan API
  res.json({
    configured: false,
    message: '请在 src/server.js 中配置 TokenPlan API'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 OpenClaw Dashboard 运行中: http://0.0.0.0:${PORT}`);
});