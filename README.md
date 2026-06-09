<p align="center">
  <img src="build/icon.png" alt="ClosedPort" width="128" height="128" />
</p>

<h1 align="center">ClosedPort</h1>

<p align="center">
  <strong>跨平台桌面端口 & 文件占用查看 / Kill 工具</strong><br/>
  Windows · macOS · Linux · Electron + React + TypeScript
</p>

<p align="center">
  <a href="https://github.com/CarGuo/ClosedPort/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/CarGuo/ClosedPort?include_prereleases&display_name=tag&color=4f8cff" /></a>
  <a href="https://github.com/CarGuo/ClosedPort/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/CarGuo/ClosedPort/ci.yml?branch=main&label=CI" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-22c55e" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Win%20%7C%20macOS%20%7C%20Linux-aaa" />
</p>

---

> 一句话：占用 8080 / 5173 / 6379 / 任何端口的"那个家伙"是谁？谁锁着我 `node_modules`？一键找出来，一键 Kill。

## 截图 Screenshots

**Ports · 平铺视图（Flat）** — 每条记录都能看到 **Started by**（父进程），点列头排序，支持正则高亮 + 多选 Kill：

![main-flat](docs/screenshots/main-flat.png)

**Ports · 按 EXE 归类（Group by EXE）** — 一个进程占多个端口时聚合，整组一键 Kill；支持 Name / Ports / PIDs 升降序：

![main-grouped](docs/screenshots/main-grouped.png)

**Folder Locks（Windows）** — 谁锁着我目录里的文件？把文件夹拖进窗口立即扫描：

![folder-locks](docs/screenshots/folder-locks.png)

**悬浮迷你面板** — Always-on-top、可见于所有桌面、跳过任务栏，常用 PID 一眼可见：

![floating](docs/screenshots/floating.png)

> Processes Tab 截图待补；功能上提供 Flat / Group by name / Tree by parent 三视图 + 行级 checkbox + 三态组选 + RSS / Private / Virtual 列原地解释，详见下文。

---

## 功能 Features

### Ports（端口占用）
- **TCP / UDP / TCP6 / UDP6** 监听与连接，附 PID、进程名、可执行文件路径、用户、命令行
- **Started by（父进程）** — 每条记录显示父进程名 + PPID，定位"这个端口到底是哪个家伙拉起来的子进程占住的"
- **Group by EXE** — 一个进程占多个端口时聚合显示，整组一键 Kill；支持 Name / Ports / PIDs 升降序
- **正则高亮 + 多选 Kill** — 正则匹配的行高亮，可继续手动 checkbox 增减选择
- **快速过滤** — 任何关键字（PID / 名 / 用户 / 命令行）即时筛选

### Processes（进程总览，新）
跨平台列举所有运行中的进程，三种视图共享同一选中集合，切换视图勾选不丢：

| 视图 | 用途 | 关键特性 |
| --- | --- | --- |
| **Flat** | 平铺浏览，按指标排序 | 行级 checkbox、表头全选、点 PID / Name / CPU% / RSS / Private / Virtual / Threads / Uptime 排序 |
| **Group by name** | 找内存大户（如 `chrome.exe` × 30） | 组按总 RSS 降序、组级三态 checkbox、`Kill Group` 一键端整族 |
| **Tree by parent** | 看清父子拉起链 | 按 `parentPid` 递归、子节点缩进、Expand all / Collapse all、子树匹配保留父链 |

工具栏功能：
- **Filter** 任意关键字过滤；**Regex** 高亮 + `Select matched` 把匹配 PID **加入**（非杀）当前选中
- **Auto-refresh**：Off / 5s / 10s / 30s（链式 setTimeout，慢机器不会堆队列）
- **Loading 态**：首次加载显示 spinner + 骨架占位行；刷新中顶部显示 2px 进度条，不再"点过来一片空白"
- 列原地说明：**RSS** = Resident / Working Set（物理 RAM 常驻）、**Private** = 私有提交字节、**Virtual** = 虚拟地址空间
- Windows 通过 `Get-CimInstance Win32_Process` + PowerShell 哈希表合并 `Get-Process`，单次 round-trip 同时拿到 `ParentProcessId` / `ExecutablePath` / `CommandLine`

### Folder Locks（文件夹占用，Windows）
- 谁锁着我 `node_modules` / 工作目录里的文件？拖文件夹进面板即可扫描
- 优先 Sysinternals `handle.exe`，缺失时自动回退 RestartManager API
- 每行可看 PID + 进程名 + 句柄类型，按 PID 多选 Kill

### 通用
- **一键 Kill** — 单条 / 多选 / 整组三粒度。Windows `taskkill /F /T`，macOS / Linux `SIGKILL`
- **Tab 状态保留** — Ports / Processes / Folder Locks 切换不会清空过滤、排序、展开的分组、扫描结果、勾选
- **悬浮迷你面板** — 常驻置顶 + 所有桌面可见 + 跳过任务栏，可暂停自动刷新
- **托盘集成** — 单实例锁、托盘菜单切换主窗口 / 悬浮窗 / 退出
- **System Idle / Kernel 智能命名** — Windows PID 0 / PID 4 单独归类，不会再混在 "Unknown"
- **零原生依赖** — 纯 Node + 平台原生命令行，无 native 模块编译

---

## 下载 Download

直接到 [Releases](https://github.com/CarGuo/ClosedPort/releases/latest) 下：

| 平台 | 推荐 | 备用 |
| --- | --- | --- |
| Windows | `ClosedPort Setup *.exe`（NSIS 安装版） | `ClosedPort *.exe`（Portable 免安装） |
| macOS   | `ClosedPort-*.dmg`                       | `ClosedPort-*-mac.zip` |
| Linux   | `ClosedPort-*.AppImage`                  | `closedport_*_amd64.deb` |

> macOS / Windows 产物当前**未签名 / 未公证**，首次运行会被 Gatekeeper / SmartScreen 拦截，参见 [docs/packaging.md](docs/packaging.md)。

---

## 30 秒上手 Quick start

从源码跑：

```bash
git clone https://github.com/CarGuo/ClosedPort.git
cd ClosedPort
npm install
npm start
```

启动后默认显示主窗口。点工具栏右上角 **Floating** 弹出悬浮迷你面板，再点一次隐藏。也可以从托盘菜单切换。

需要热更新 / 改代码 → [docs/development.md](docs/development.md)。

---

## 文档 Docs

更深入的内容都在 [docs/](docs/)，按需取用：

- [docs/development.md](docs/development.md) — 开发模式 / Spawn test ports 诊断
- [docs/packaging.md](docs/packaging.md) — 打包、签名、Release CI
- [docs/testing.md](docs/testing.md) — E2E / Smoke / 截图回归
- [docs/architecture.md](docs/architecture.md) — 平台后端实现表 + 项目结构 + 设计决策
- [docs/faq.md](docs/faq.md) — 常见问题（PID 0/4、handle.exe、悬浮窗、权限⋯）

---

## 贡献 Contributing

欢迎 issue 与 PR。提交前请保证：

```bash
npm run test:e2e   # 必须通过
npm run build      # tsc + vite build 全绿
```

代码风格：TypeScript strict，UI 文案以英文为主、必要处补充中文。

---

## License

MIT — see [LICENSE](LICENSE).

## 鸣谢 Credits

- Sysinternals `handle.exe` — Mark Russinovich
- Electron / React / Vite 社区
