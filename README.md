# ClosedPort

> Cross-platform desktop tool to inspect and reclaim listening ports & file locks, with one-click kill, an always-on-top floating panel, and per-EXE grouping.

跨平台桌面小工具：列出系统所有占用的端口与对应进程、查看 Windows 文件夹中谁在占用文件、一键 kill 释放，附带常驻悬浮窗与按 EXE 归类视图。Windows / macOS / Linux 三端通吃。

---

## 截图 / Screenshots

> 截图来自真实运行的 ClosedPort（Windows，real `listPorts()` 数据，由 `BrowserWindow.capturePage` 自动采集，非 mock）。位于 [docs/screenshots/](docs/screenshots)。

主窗口 · 平铺视图（Flat），右侧多了 `Started by` 列显示每个进程的父级：
![main-flat](docs/screenshots/main-flat.png)

主窗口 · 按 EXE 归类视图（Group by EXE），同一进程的多个端口聚合在一起，可整组 Kill。例图里 `sing-box.exe` 占了 99 个端口，Started by `v2rayN.exe`：
![main-grouped](docs/screenshots/main-grouped.png)

文件夹占用扫描（Windows 专属）。截图中机器没装 `handle.exe`，UI 顶部明确给出降级提示与解决办法；安装后即可扫到内核态锁：
![folder-locks](docs/screenshots/folder-locks.png)

悬浮迷你面板（Always-on-top），子行也显示 `by <parent>`：
![floating](docs/screenshots/floating.png)

---

## 功能 Features

- **端口占用一览**：列出全部 TCP / UDP / TCP6 / UDP6 监听与连接，附带 PID、进程名、可执行文件路径、用户、命令行。
- **启动者 / 父进程**：每条记录都能看到是谁启动了它（父进程名 + PPID），方便定位「这个 yt-dlp / svchost 是谁拉起来的」之类的问题。
- **按 EXE 归类视图**：一个进程占多个端口时，把它们折叠在一起，整组一键 Kill。
- **文件夹占用扫描（Windows 专属）**：定位到底是谁锁住了你 IDE 的文件 / 工作目录。优先调用 Sysinternals `handle.exe`，缺失时自动回退到 Windows Restart Manager API（覆盖 Word/Excel/JetBrains/VSCode 等用户态锁）。
- **一键 Kill**：单条 / 多选 / 整组三种粒度。Windows 用 `taskkill /F /T` 顺带杀子进程；macOS/Linux 用 `SIGKILL`。
- **悬浮迷你面板**：常驻置顶窗口，在所有桌面（虚拟桌面 / Spaces）可见，5 秒自动刷新可暂停，IDE 旁边挂一个不占地。
- **托盘集成**：单实例锁、托盘菜单切换主窗口 / 悬浮窗 / 退出。
- **零依赖跨平台**：纯 Node 系命令调用 + 平台原生工具，无 native 模块编译需求。

---

## 快速开始 Quick start

```bash
# 1. 安装依赖
npm install

# 2. 一键构建并启动（生产模式：渲染层走本地文件）
npm start

# —— 或者开发模式（推荐，渲染层热更新）——
npm run dev                 # 启动 vite dev server :5173
# 另开一个终端
$env:CLOSEDPORT_DEV_SERVER="1"   # PowerShell；其他 shell 自行 export
npm run build:main
npx electron .
```

启动后默认显示主窗口。点工具栏右上角 **Floating** 可弹出悬浮迷你面板，再点一次会隐藏。也可以从托盘菜单切换。

---

## 打包 Packaging

```bash
npm run dist:win     # Windows: NSIS 安装包 + 便携版
npm run dist:mac     # macOS:   dmg + zip
npm run dist:linux   # Linux:   AppImage + deb
```

打包前如果想让 Windows 文件夹扫描更全面，把 [handle.exe / handle64.exe](https://learn.microsoft.com/en-us/sysinternals/downloads/handle) 拷到仓库根目录的 `resources/`。`.gitignore` 已经把它们忽略了，不会污染版本库，但 electron-builder 会把这个目录打进发布包。

---

## 测试 Testing

工具自带两套测试：

```bash
# E2E：Node 直接跑 backend 模块（不依赖 Electron 启动 GUI）
npm run test:e2e
# 检查项：
#   - 当前进程 PID 反查名称 / 路径
#   - 自己开 listener，端口能在结果里被找到，含 processName + parentPid
#   - 起一个子进程绑端口，killer 杀完端口被释放
#   - 非法 PID 走错误分支不抛
#   - 文件夹扫描调用不抛

# Smoke：spawn 真实 Electron 二进制，主进程内跑一次 listPorts
npm run test:smoke
```

测试用例固定无网络依赖。CI 友好。

### 截图回归 Screenshot regen

Electron 主进程内置一个截图模式（real React UI + real ports data + `BrowserWindow.capturePage`）：

```powershell
# Windows
$env:CLOSEDPORT_SMOKE = $null
$env:CLOSEDPORT_SCREENSHOT_DIR = "$PWD\docs\screenshots"
npm run build; npx electron .
```

它会自动跑遍 Flat / Group by EXE / Folder / Floating 四个 UI 状态并写出 PNG，然后退出。

---

## 平台后端实现 Backends per platform

| 能力              | Windows                                                  | macOS               | Linux                                |
| ----------------- | -------------------------------------------------------- | ------------------- | ------------------------------------ |
| 端口列表          | `netstat -ano -p TCP/UDP/TCPv6/UDPv6`                    | `lsof -nP -i -F`    | `lsof` → 缺则 `ss -tunlpH`           |
| 进程基本信息      | `tasklist /FO CSV /NH`                                   | `ps -p ... -o ...`  | `ps -p ... -o ...`                   |
| 进程路径 / 父进程 | **单次** `Get-CimInstance Win32_Process`（PowerShell）   | 同 ps               | `/proc/<pid>/exe` + `/proc/<pid>/cmdline` |
| 文件夹占用        | `handle.exe` → Restart Manager API                       | n/a                 | n/a                                  |
| 进程终止          | `taskkill /F /T`                                         | `SIGKILL`           | `SIGKILL`                            |

> Windows 端**故意**没用 `tasklist /V`：在某些环境下会因为 SeDebugPrivilege 的细节导致输出在 5 行左右被截断并 hang 8s。看 [`src/main/utils/processInfo.ts`](src/main/utils/processInfo.ts) 注释。

---

## FAQ

### Q：跑这个工具会让 WMI Provider Host (`WmiPrvSE.exe`) 占很高 CPU 吗？
**不会**。早期开发版用过 `wmic` 多次调用做进程富化，会触发 WmiPrvSE 飙高，已修复为**单次** `Get-CimInstance Win32_Process -Filter "ProcessId=A OR ProcessId=B OR ..."`，N 个 PID 也只发起一次 WMI 查询。如果你升级老版本看到 WmiPrvSE CPU 涨，请确认已经更新到最新版。

### Q：怎么看一个 exe 是被谁启动的？
端口表里的 **Started by** 列就是父进程（`parentName (PPID)`）。比如截图里看到的 `yt-dlp.exe`，父进程会显示成 `cmd.exe (12345)` 或 `python.exe (...)`，这通常就够了。要看完整祖先链可以再点该 PID 在表中过滤其 `parentPid` 看上一级。

### Q：杀不掉怎么办？
绝大多数情况是权限不够。Windows 杀系统进程需要管理员；macOS / Linux 杀 root 进程需要 sudo。运行 ClosedPort 时用提升权限的方式启动即可。系统关键进程（System / smss / csrss / 等）即使有权限也建议**别杀**。

### Q：没有 `handle.exe` 也能扫文件夹吗？
能。会自动走 Windows Restart Manager API（PowerShell 内联 C#）。RM 覆盖 IDE / Office / 大多数用户态进程，但**不**覆盖驱动 / 内核句柄。要全覆盖请放 `handle.exe` 到 `resources/`。

### Q：macOS / Linux 上文件夹占用 Tab 一直空？
这是预期行为。Unix 没有"文件夹被锁"这个概念（删除目录里被打开的文件不会失败，而是延迟回收），所以不实现这个功能。要查谁打开了某个文件，用 `lsof <path>`。

### Q：悬浮窗在某些虚拟桌面看不到？
确保系统没禁用「跨桌面置顶」。我们调用了 `setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces(true)` + `skipTaskbar`。

---

## 项目结构 Project layout

```
src/
  main/                 Electron 主进程
    index.ts            应用启动 / 窗口 / 托盘 / IPC
    portScanner.ts      端口扫描（netstat / lsof / ss）
    folderScanner.ts    文件夹句柄扫描（Windows）
    killer.ts           跨平台进程终止
    utils/
      exec.ts           child_process.exec 封装 + 超时
      processInfo.ts    进程详情批量预热（单次 PowerShell / wmic 后备）
  preload/
    index.ts            contextBridge 暴露 API
  renderer/             Vite + React UI
    index.html          主窗口入口
    floating.html       悬浮窗入口
    src/                React 组件 + 样式
  shared/
    types.ts            PortEntry / FolderHandleEntry / SystemInfo / ApiSurface
    ipc.ts              IPC 通道常量

tests/
  e2e.js                Backend E2E（不启动 GUI）
  smoke.js              真 Electron 启动 + IPC 路径冒烟

resources/              可选的 handle.exe / handle64.exe
```

---

## 贡献 Contributing

欢迎 issue 与 PR。提交前请保证：

```bash
npm run test:e2e       # 必须通过
npm run build          # tsc + vite build 全绿
```

代码风格：TypeScript strict，无 emoji，UI 文案优先英文（控件名）+ 必要中文（FAQ / 文档）。

---

## License

MIT — see [LICENSE](LICENSE) if present, otherwise the [package.json](package.json) license field.

---

## 鸣谢 Credits

- Sysinternals `handle.exe` — Mark Russinovich
- Electron / React / Vite 社区
