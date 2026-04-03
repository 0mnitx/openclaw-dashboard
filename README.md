# OpenClaw Dashboard

局域网内监控 OpenClaw 运行状态、系统资源占用和 Token 用量的 Web 面板。

![Dashboard](https://img.shields.io/badge/OpenClaw-Dashboard-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/License-MIT-green)

## 功能

- 🖥️ **系统资源监控** - CPU、内存、磁盘使用率
- 🦞 **OpenClaw 状态** - Gateway 运行状态、活跃会话数
- 💳 **Token 用量** - API 套餐使用情况（需配置）
- 🌐 **Web 界面** - 局域网内任意设备浏览器访问
- 🔄 **自动刷新** - 每 30 秒自动更新数据

## 快速开始

### 安装

```bash
git clone https://github.com/0mnitx/openclaw-dashboard.git
cd openclaw-dashboard
npm install
```

### 运行

```bash
npm start
```

然后浏览器打开 `http://<你的服务器IP>:3000`

## 配置

### TokenPlan API（可选）

如果需要监控 Token 用量，编辑 `src/server.js` 中的 `/api/token` 路由，添加你的 TokenPlan API 调用逻辑。

## 技术栈

- Node.js + Express（后端）
- 原生 HTML/CSS/JS（前端，无需构建）

## 许可证

MIT