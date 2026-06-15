<p align="center">
  <img src="build/icon.png" alt="ClosedPort" width="128" height="128" />
</p>

<h1 align="center">ClosedPort</h1>

<p align="center">
  <strong>跨平台桌面控制台 · 端口 / 进程 / 文件占用，一键 Kill</strong><br/>
  Windows · macOS · Linux · Electron + React + TypeScript
</p>

<p align="center">
  <a href="https://github.com/CarGuo/ClosedPort/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/CarGuo/ClosedPort?include_prereleases&display_name=tag&color=4f8cff" /></a>
  <a href="https://github.com/CarGuo/ClosedPort/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/CarGuo/ClosedPort/ci.yml?branch=main&label=CI" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-22c55e" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Win%20%7C%20macOS%20%7C%20Linux-aaa" />
</p>

---

> 占用 8080 / 5173 / 6379 的"那个家伙"是谁？谁吃光了我 24 GB 内存？谁锁着我 `node_modules`？
> **一个窗口看清，一个按钮搞定。**

## 三大能力 At a glance

| Tab | 解决什么 | 关键操作 |
| --- | --- | --- |
| **Ports** | 端口被谁占了，父进程是谁 | 过滤 / 正则高亮 / Group by App / 多选 Kill |
| **Processes** | 谁吃 CPU、谁吃内存，怎么**批量释放** | Flat·Group·Tree 三视图 + 行级 checkbox + 整组 Kill |
| **Folder Locks** *(Win)* | 谁锁着我目录里的文件 | 拖文件夹进窗口立即扫描 + 多选 Kill |

完整功能、列语义、平台后端实现 → **[docs/features.md](docs/features.md)**

## 截图 Screenshots

**Ports** · 平铺视图，显示父进程 (Started by)，多选 Kill：

![ports-flat](docs/screenshots/main-flat.png)

**Processes** · Group by name 视图，同名进程聚合 + 总 RSS / CPU% + `Kill Group (N)` 批量释放内存：

![processes-grouped](docs/screenshots/processes-grouped.png)

**Folder Locks** · 拖文件夹进窗口立即扫描占用：

![folder-locks](docs/screenshots/folder-locks.png)

> 更多截图（Group-by-App、Tree 视图、悬浮迷你面板）见 [docs/features.md](docs/features.md)。

## 下载 Download

到 [Releases](https://github.com/CarGuo/ClosedPort/releases/latest) 取最新包：

| 平台 | 推荐 | 备用 |
| --- | --- | --- |
| Windows | `ClosedPort Setup *.exe` (NSIS) | `ClosedPort *.exe` (Portable) |
| macOS   | `ClosedPort-*.dmg`              | `ClosedPort-*-mac.zip` |
| Linux   | `ClosedPort-*.AppImage`         | `closedport_*_amd64.deb` |

> 产物**未签名**，首次运行 SmartScreen / Gatekeeper 会拦截 → [docs/packaging.md](docs/packaging.md)

## 30 秒上手 Quick start

```bash
git clone https://github.com/CarGuo/ClosedPort.git
cd ClosedPort && npm install && npm start
```

热更新 / 改代码 → [docs/development.md](docs/development.md)

## 文档 Docs

| 我想… | 看这里 |
| --- | --- |
| 看完整功能 / UI 细节 | [docs/features.md](docs/features.md) |
| 改代码 / 开发模式 | [docs/development.md](docs/development.md) |
| 自己打包发版 | [docs/packaging.md](docs/packaging.md) |
| 跑测试 / 截图回归 | [docs/testing.md](docs/testing.md) |
| 看架构 / 后端实现表 | [docs/architecture.md](docs/architecture.md) |
| 常见问题（PID 0/4、handle.exe、权限） | [docs/faq.md](docs/faq.md) |

## License

MIT — see [LICENSE](LICENSE).

Credits: Sysinternals `handle.exe` (Mark Russinovich), Electron · React · Vite。
