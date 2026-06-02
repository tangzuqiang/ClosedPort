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

主窗口 · 平铺视图（Flat），每条记录都能看到 **Started by**（父进程）：

![main-flat](docs/screenshots/main-flat.png)

主窗口 · 按 EXE 归类视图（Group by EXE），一个进程占的多个端口聚合，可整组 Kill：

![main-grouped](docs/screenshots/main-grouped.png)

文件夹占用扫描（Windows）。支持**拖拽文件夹直接扫描**：

![folder-locks](docs/screenshots/folder-locks.png)

悬浮迷你面板（Always-on-top, all workspaces）：

![floating](docs/screenshots/floating.png)

---

## 功能 Features

- 🔌 **端口占用一览** — TCP / UDP / TCP6 / UDP6 监听与连接，附 PID、进程名、可执行文件路径、用户、命令行
- 👪 **启动者 / 父进程** — 每条记录显示父进程名 + PPID，定位"这个端口到底是哪个家伙拉起来的子进程占住的"
- 📦 **按 EXE 归类视图** — 一个进程占多个端口时聚合显示，整组一键 Kill；支持 Name / Ports / PIDs 升降序
- 🗂️ **Tab 状态保留** — Ports / Folder Locks 切换不会清空过滤、排序、展开的分组、扫描结果
- 🔎 **文件夹占用扫描（Windows）** — 谁锁着我工作目录里的文件？拖文件夹进面板即可扫描；优先 Sysinternals `handle.exe`，缺失时自动回退 RestartManager
- ☠️ **一键 Kill** — 单条 / 多选 / 整组三粒度。Windows `taskkill /F /T`，macOS / Linux `SIGKILL`
- 🪟 **悬浮迷你面板** — 常驻置顶 + 所有桌面可见 + 跳过任务栏，可暂停自动刷新
- 🛎️ **托盘集成** — 单实例锁、托盘菜单切换主窗口 / 悬浮窗 / 退出
- 🧠 **System Idle / Kernel 智能命名** — Windows PID 0 / PID 4 单独归类，不会再混在 "Unknown"
- 🪶 **零原生依赖** — 纯 Node + 平台原生命令行，无 native 模块编译

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
