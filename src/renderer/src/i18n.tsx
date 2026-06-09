import React from 'react';

export type Lang = 'en' | 'zh';

export interface Dict {
  [key: string]: string;
}

export const dicts: Record<Lang, Dict> = {
  en: {
    'tab.ports': 'Ports',
    'tab.processes': 'Processes',
    'tab.folder': 'Folder Locks',
    'tab.folder.winOnly': '(Win only)',

    'common.refresh': 'Refresh',
    'common.refreshing': 'Refreshing...',
    'common.loading': 'Loading',
    'common.filter': 'Filter',
    'common.regex': 'Regex',
    'common.off': 'Off',
    'common.auto': 'Auto',
    'common.kill': 'Kill',
    'common.clear': 'Clear',
    'common.cancel': 'Cancel',
    'common.apply': 'Apply',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.ok': 'OK',
    'common.open': 'Open',
    'common.browse': 'Browse',
    'common.elevated': 'Elevated',
    'common.standard': 'Standard',
    'common.floating': 'Floating',

    'proc.view.flat': 'Flat',
    'proc.view.grouped': 'Group by name',
    'proc.view.tree': 'Tree by parent',
    'proc.view.group': 'Group',
    'proc.selectMatched': 'Select matched',
    'proc.killSelected': 'Kill Selected',
    'proc.killGroup': 'Kill Group',
    'proc.expandAll': 'Expand all',
    'proc.collapseAll': 'Collapse all',
    'proc.rssHint': 'RSS = Resident / Working Set (physical RAM in use)',
    'proc.privateHint': 'Private = privately committed bytes',
    'proc.virtualHint': 'Virtual = address space reservation',
    'proc.memHintIntro': 'Memory columns:',
    'proc.memHintTail': 'Click any column header to sort.',
    'proc.col.pid': 'PID',
    'proc.col.name': 'Name',
    'proc.col.user': 'User',
    'proc.col.cpu': 'CPU%',
    'proc.col.rss': 'RSS',
    'proc.col.private': 'Private',
    'proc.col.virtual': 'Virtual',
    'proc.col.thr': 'Thr',
    'proc.col.uptime': 'Uptime',
    'proc.col.path': 'Path',
    'proc.col.action': 'Action',
    'proc.col.namePid': 'Name (PID)',
    'proc.filterPlaceholder': 'Filter by pid, name, user, path...',
    'proc.regexPlaceholder': 'Regex (highlights matches): chrome.*helper, ^node$, vite|webpack...',
    'proc.regexInvalid': 'Invalid regex',
    'proc.regexTitle': 'Matching rows are highlighted. Click "Select matched" to add them to the selection.',
    'proc.autoOff': 'Auto: Off',
    'proc.auto5s': 'Auto: 5s',
    'proc.auto10s': 'Auto: 10s',
    'proc.auto30s': 'Auto: 30s',
    'proc.entries': 'processes',
    'proc.backend': 'Backend',
    'proc.empty': 'No processes found.',
    'proc.loading.title': 'Loading processes…',
    'proc.loading.hint': 'First snapshot can take a few seconds on Windows (Get-CimInstance walks the full Win32_Process table).',
    'proc.treeHint': 'Tree built from parent PID. Roots are processes whose parent is not in this snapshot.',
    'proc.killSelectedConfirm': 'Kill {n} process(es)?\n\nThis cannot be undone.',
    'proc.killGroupConfirm': 'Kill all {n} process(es) in this group?',
    'proc.killOneConfirm': 'Kill PID {pid}?',
    'proc.procs': 'procs',
    'proc.totalRss': 'Total RSS',
    'proc.sumCpu': 'Sum of CPU%',

    'mem.title': 'Memory',
    'mem.total': 'Total',
    'mem.used': 'Used',
    'mem.available': 'Available',
    'mem.cached': 'Cached',
    'mem.compressed': 'Compressed',
    'mem.free': 'Free',
    'mem.swap': 'Swap',
    'mem.loading': 'Loading memory…',

    'ports.filterPlaceholder': 'Filter by port, pid, name, path, state, parent...',
    'ports.view.flat': 'Flat',
    'ports.view.groupExe': 'Group by EXE',
    'ports.col.proto': 'Protocol',
    'ports.col.local': 'Local',
    'ports.col.remote': 'Remote',
    'ports.col.state': 'State',
    'ports.col.pid': 'PID',
    'ports.col.process': 'Process',
    'ports.col.startedBy': 'Started by',
    'ports.col.path': 'Path',
    'ports.col.user': 'User',
    'ports.col.actions': 'Actions',
    'ports.col.action': 'Action',
    'ports.col.port': 'Port',
    'ports.empty': 'No ports found.',
    'ports.entries': 'entries',
    'ports.appsSlash': 'apps',
    'ports.sortBy': 'Sort by:',
    'ports.sort.name': 'Name',
    'ports.sort.ports': 'Ports',
    'ports.sort.pids': 'PIDs',
    'ports.killSelected': 'Kill Selected',
    'ports.spawnTest': 'Spawn test ports',
    'ports.spawnTestTitle': "Diagnostic helper (Windows): spawns 5 child processes that bind random TCP ports. Use the row Kill button or Kill Group to clean them up — they are NOT auto-cleaned until you quit the app.",
    'ports.clearTestMarkers': 'Clear test markers',
    'ports.clearTestMarkersTitle': 'Forget which rows were spawned by the test helper (does NOT kill the processes).',
    'ports.killGroup': 'Kill Group',
    'ports.killOneConfirm': 'Kill PID {pid}?',
    'ports.killManyConfirm': 'Kill {n} process(es)?',
    'ports.killGroupConfirm': 'Kill all {n} process(es) in this group?',
    'ports.testSpawnedNone': 'No test ports were spawned. (This action is Windows-only.)',
    'ports.testSpawnedFailed': 'Failed to spawn test ports:',
    'ports.failed': 'Failed:',
    'ports.openTitle': 'Reveal in folder',
    'ports.ports': 'ports',
    'ports.pids': 'pids',
    'ports.testTag': "Spawned by 'Spawn test ports'",

    'folder.dropTitle': 'Drop to scan',
    'folder.dropSub': 'Folder → scanned directly · File → its parent folder is scanned',
    'folder.placeholder.win': 'Pick, paste, or drag a folder onto this panel...',
    'folder.placeholder.other': 'Pick or paste a folder path...',
    'folder.pick': 'Pick folder',
    'folder.scan': 'Scan',
    'folder.scanning': 'Scanning...',
    'folder.killAll': 'Kill All',
    'folder.col.pid': 'PID',
    'folder.col.process': 'Process',
    'folder.col.path': 'Path',
    'folder.col.handleType': 'Handle',
    'folder.col.resource': 'Resource',
    'folder.col.actions': 'Actions',
    'folder.notWin': 'Folder lock detection is Windows-only. On macOS / Linux, use the Ports tab; file-handle holding is rarely a blocker outside Windows.',
    'folder.limited.intro': 'Limited mode:',
    'folder.limited.body': "handle.exe (Sysinternals) not detected, so we're using Windows RestartManager. RM only sees user-mode exclusive locks (Word/Excel saving, IDE write locks, msbuild output, etc.) — it will not show read-only handles, memory-mapped DLLs, directory handles, or a process's working directory.",
    'folder.emptyPick.win': 'Pick a folder, paste a path, or drag a folder onto this panel to scan.',
    'folder.emptyPick.other': 'Pick a folder to scan.',
    'folder.notExist': 'Folder does not exist or is not a directory:',
    'folder.rmScanned': 'Scanned',
    'folder.rmFiles': 'file(s) via RestartManager — no user-mode lock found.',
    'folder.rmCaveat': "This does not mean nothing has the folder open: RM can't see read-only handles, mmap'd DLLs, or processes whose cwd is this folder.",
    'folder.noneHandleExe': 'No process is holding any handle inside this folder.',
    'folder.noneGeneric': 'No locking processes found (or scan not run yet).',
    'folder.killOneConfirm': 'Kill PID {pid}?',
    'folder.killManyConfirm': 'Kill {n} process(es)?',
    'folder.dropResolveFail': 'Could not resolve the dropped item to a filesystem path.',

    'lang.en': 'EN',
    'lang.zh': '中',

    'floating.title': 'ClosedPort',
    'floating.pause': 'Pause',
    'floating.resume': 'Resume',
    'floating.refresh': 'Refresh',
    'floating.hide': 'Hide',
    'floating.placeholder': 'port / pid / name',
    'floating.empty': 'No matches',
    'floating.loading': 'Loading...'
  },
  zh: {
    'tab.ports': '端口',
    'tab.processes': '进程',
    'tab.folder': '文件夹占用',
    'tab.folder.winOnly': '（仅 Windows）',

    'common.refresh': '刷新',
    'common.refreshing': '刷新中...',
    'common.loading': '加载中',
    'common.filter': '筛选',
    'common.regex': '正则',
    'common.off': '关闭',
    'common.auto': '自动',
    'common.kill': '结束',
    'common.clear': '清除',
    'common.cancel': '取消',
    'common.apply': '应用',
    'common.yes': '是',
    'common.no': '否',
    'common.ok': '确定',
    'common.open': '打开',
    'common.browse': '浏览',
    'common.elevated': '管理员',
    'common.standard': '普通',
    'common.floating': '悬浮窗',

    'proc.view.flat': '平铺',
    'proc.view.grouped': '按名称分组',
    'proc.view.tree': '按父进程树',
    'proc.view.group': '分组',
    'proc.selectMatched': '选中匹配项',
    'proc.killSelected': '结束所选',
    'proc.killGroup': '结束分组',
    'proc.expandAll': '全部展开',
    'proc.collapseAll': '全部折叠',
    'proc.rssHint': 'RSS = 常驻 / 工作集（实际占用物理内存）',
    'proc.privateHint': 'Private = 进程独占已提交内存',
    'proc.virtualHint': 'Virtual = 虚拟地址空间预留',
    'proc.memHintIntro': '内存列说明：',
    'proc.memHintTail': '点击任意列头排序。',
    'proc.col.pid': 'PID',
    'proc.col.name': '名称',
    'proc.col.user': '用户',
    'proc.col.cpu': 'CPU%',
    'proc.col.rss': 'RSS',
    'proc.col.private': '独占',
    'proc.col.virtual': '虚拟',
    'proc.col.thr': '线程',
    'proc.col.uptime': '运行时长',
    'proc.col.path': '路径',
    'proc.col.action': '操作',
    'proc.col.namePid': '名称（PID）',
    'proc.filterPlaceholder': '按 PID、名称、用户、路径筛选...',
    'proc.regexPlaceholder': '正则（高亮匹配项）：chrome.*helper, ^node$, vite|webpack...',
    'proc.regexInvalid': '正则无效',
    'proc.regexTitle': '匹配行会高亮。点击“选中匹配项”可将它们加入选择。',
    'proc.autoOff': '自动：关',
    'proc.auto5s': '自动：5 秒',
    'proc.auto10s': '自动：10 秒',
    'proc.auto30s': '自动：30 秒',
    'proc.entries': '个进程',
    'proc.backend': '后端',
    'proc.empty': '未找到进程。',
    'proc.loading.title': '正在加载进程…',
    'proc.loading.hint': 'Windows 上首次拉取可能需几秒（Get-CimInstance 会遍历整个 Win32_Process 表）。',
    'proc.treeHint': '基于父 PID 构造树。根节点是父进程不在本次快照中的进程。',
    'proc.killSelectedConfirm': '结束 {n} 个进程？\n\n该操作不可撤销。',
    'proc.killGroupConfirm': '结束该分组中全部 {n} 个进程？',
    'proc.killOneConfirm': '结束 PID {pid}？',
    'proc.procs': '个进程',
    'proc.totalRss': 'RSS 合计',
    'proc.sumCpu': 'CPU% 合计',

    'mem.title': '内存',
    'mem.total': '总计',
    'mem.used': '已用',
    'mem.available': '可用',
    'mem.cached': '缓存',
    'mem.compressed': '已压缩',
    'mem.free': '空闲',
    'mem.swap': '交换',
    'mem.loading': '正在加载内存信息…',

    'ports.filterPlaceholder': '按端口、PID、名称、路径、状态、父进程筛选...',
    'ports.view.flat': '平铺',
    'ports.view.groupExe': '按程序分组',
    'ports.col.proto': '协议',
    'ports.col.local': '本地',
    'ports.col.remote': '远端',
    'ports.col.state': '状态',
    'ports.col.pid': 'PID',
    'ports.col.process': '进程',
    'ports.col.startedBy': '启动者',
    'ports.col.path': '路径',
    'ports.col.user': '用户',
    'ports.col.actions': '操作',
    'ports.col.action': '操作',
    'ports.col.port': '端口',
    'ports.empty': '未找到端口。',
    'ports.entries': '条记录',
    'ports.appsSlash': '个程序',
    'ports.sortBy': '排序：',
    'ports.sort.name': '名称',
    'ports.sort.ports': '端口数',
    'ports.sort.pids': 'PID 数',
    'ports.killSelected': '结束所选',
    'ports.spawnTest': '生成测试端口',
    'ports.spawnTestTitle': '诊断辅助（仅 Windows）：派生 5 个子进程，绑定随机 TCP 端口。请使用行内 Kill 或 Kill Group 清理 —— 退出应用前不会自动清理。',
    'ports.clearTestMarkers': '清除测试标记',
    'ports.clearTestMarkersTitle': '忽略测试辅助生成的行（不会结束进程）。',
    'ports.killGroup': '结束分组',
    'ports.killOneConfirm': '结束 PID {pid}？',
    'ports.killManyConfirm': '结束 {n} 个进程？',
    'ports.killGroupConfirm': '结束该分组中全部 {n} 个进程？',
    'ports.testSpawnedNone': '未生成测试端口。（仅 Windows 可用。）',
    'ports.testSpawnedFailed': '生成测试端口失败：',
    'ports.failed': '失败：',
    'ports.openTitle': '在文件夹中显示',
    'ports.ports': '端口',
    'ports.pids': 'PID',
    'ports.testTag': '由“生成测试端口”创建',

    'folder.dropTitle': '拖入以扫描',
    'folder.dropSub': '文件夹 → 直接扫描 · 文件 → 扫描所在父目录',
    'folder.placeholder.win': '选择、粘贴或拖拽文件夹到本面板...',
    'folder.placeholder.other': '选择或粘贴文件夹路径...',
    'folder.pick': '选择文件夹',
    'folder.scan': '扫描',
    'folder.scanning': '扫描中...',
    'folder.killAll': '全部结束',
    'folder.col.pid': 'PID',
    'folder.col.process': '进程',
    'folder.col.path': '路径',
    'folder.col.handleType': '句柄类型',
    'folder.col.resource': '资源',
    'folder.col.actions': '操作',
    'folder.notWin': '文件夹占用检测仅支持 Windows。macOS / Linux 上请使用端口页 —— 在这些系统上文件句柄通常不会成为阻塞。',
    'folder.limited.intro': '受限模式：',
    'folder.limited.body': '未检测到 handle.exe（Sysinternals），正在使用 Windows RestartManager。RM 仅能看到用户态独占锁（Word/Excel 保存、IDE 写锁、msbuild 输出等），不会显示只读句柄、内存映射 DLL、目录句柄或进程的工作目录。',
    'folder.emptyPick.win': '选择文件夹、粘贴路径，或将文件夹拖入本面板进行扫描。',
    'folder.emptyPick.other': '选择文件夹以扫描。',
    'folder.notExist': '文件夹不存在或不是目录：',
    'folder.rmScanned': '已扫描',
    'folder.rmFiles': '个文件（RestartManager）—— 未发现用户态占用。',
    'folder.rmCaveat': '这并不表示无人打开该文件夹：RM 无法看到只读句柄、mmap 的 DLL，或将该文件夹作为 cwd 的进程。',
    'folder.noneHandleExe': '没有进程持有该文件夹内任何句柄。',
    'folder.noneGeneric': '未找到占用进程（或尚未扫描）。',
    'folder.killOneConfirm': '结束 PID {pid}？',
    'folder.killManyConfirm': '结束 {n} 个进程？',
    'folder.dropResolveFail': '无法解析拖入项的文件系统路径。',

    'lang.en': 'EN',
    'lang.zh': '中',

    'floating.title': 'ClosedPort',
    'floating.pause': '暂停',
    'floating.resume': '继续',
    'floating.refresh': '刷新',
    'floating.hide': '隐藏',
    'floating.placeholder': '端口 / PID / 名称',
    'floating.empty': '无匹配',
    'floating.loading': '加载中...'
  }
};

export const LanguageContext = React.createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
}>({ lang: 'en', setLang: () => {} });

export function useT(): (key: string, fallback?: string) => string {
  const { lang } = React.useContext(LanguageContext);
  return (key: string, fallback?: string) =>
    dicts[lang][key] ?? fallback ?? key;
}

const STORAGE_KEY = 'closedport.lang';

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* ignore */
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }
  } catch {
    /* ignore */
  }
  return 'en';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [lang, setLangState] = React.useState<Lang>(() => detectInitialLang());
  const setLang = React.useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);
  const value = React.useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
