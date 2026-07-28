import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  execFileCommand,
  POWERSHELL_UTF8_PREAMBLE
} from './utils/exec';
import type {
  StartupEntry,
  StartupListResult,
  StartupMutationResult,
  StartupSource
} from '../shared/types';

const PROTECTED_SERVICES = new Set(
  [
    'RpcSs',
    'RpcEptMapper',
    'DcomLaunch',
    'LSM',
    'eventlog',
    'Power',
    'PlugPlay',
    'SamSs',
    'Winmgmt',
    'Schedule',
    'ProfSvc',
    'UserManager',
    'CryptSvc',
    'BFE',
    'mpssvc',
    'Dhcp',
    'Dnscache',
    'NlaSvc',
    'nsi',
    'BrokerInfrastructure',
    'SystemEventsBroker',
    'StateRepository',
    'camsvc',
    'CoreMessagingRegistrar',
    'FontCache',
    'KeyIso',
    'LanmanServer',
    'LanmanWorkstation',
    'lmhosts',
    'Netman',
    'netprofm',
    'NcbService',
    'Wcmsvc',
    'WinHttpAutoProxySvc',
    'WlanSvc',
    'Audiosrv',
    'AudioEndpointBuilder',
    'Themes',
    'UxSms',
    'DWM',
    'Dwmapi',
    'gpsvc',
    'GroupPolicyClient',
    'WinDefend',
    'SecurityHealthService',
    'WdNisSvc',
    'Sense',
    'wscsvc'
  ].map((s) => s.toLowerCase())
);

function fail(message: string): StartupMutationResult {
  return { success: false, message };
}
function ok(message?: string): StartupMutationResult {
  return { success: true, message };
}

/**
 * Run a PowerShell script via a temp .ps1 file.
 * Embedding large scripts in `powershell -Command "..."` is unreliable on
 * Windows (cmd quoting / empty stdout with exit 0). -File avoids that.
 */
async function psCommand(
  script: string,
  timeoutMs = 20000
): Promise<{ stdout: string; stderr: string; code: number }> {
  const tmp = path.join(
    os.tmpdir(),
    `closedport-startup-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`
  );
  fs.writeFileSync(tmp, POWERSHELL_UTF8_PREAMBLE + '\n' + script, 'utf8');
  try {
    return await execFileCommand(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        tmp
      ],
      { timeoutMs, maxBuffer: 1024 * 1024 * 64 }
    );
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function psJson<T>(script: string, timeoutMs = 20000): Promise<T | null> {
  const res = await psCommand(script, timeoutMs);
  const text = (res.stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Pull an absolute exe/path from a command line for revealInFolder. */
export function extractRevealPath(command: string): string | undefined {
  if (!command) return undefined;
  const quoted = command.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  const bare = command.trim().split(/\s+/)[0];
  if (bare && /^[a-zA-Z]:[\\/]/.test(bare)) return bare;
  return undefined;
}

function parseId(id: string): { kind: string; rest: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { kind: id.slice(0, i), rest: id.slice(i + 1) };
}

// ---------------- list ----------------

export async function listStartups(): Promise<StartupListResult> {
  if (os.platform() !== 'win32') {
    return {
      entries: [],
      capturedAt: Date.now(),
      warnings: ['Startup management is only available on Windows.']
    };
  }

  const warnings: string[] = [];
  const parts = await Promise.all([
    listRegistry().catch((e) => {
      warnings.push(`Registry: ${(e as Error).message}`);
      return [] as StartupEntry[];
    }),
    listStartupFolders().catch((e) => {
      warnings.push(`Startup folder: ${(e as Error).message}`);
      return [] as StartupEntry[];
    }),
    listLogonTasks().catch((e) => {
      warnings.push(`Scheduled tasks: ${(e as Error).message}`);
      return [] as StartupEntry[];
    }),
    listServices().catch((e) => {
      warnings.push(`Services: ${(e as Error).message}`);
      return [] as StartupEntry[];
    }),
    listBrowserExtensions().catch((e) => {
      warnings.push(`Browser extensions: ${(e as Error).message}`);
      return [] as StartupEntry[];
    })
  ]);

  const entries = parts.flat().sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.name.localeCompare(b.name);
  });

  return { entries, capturedAt: Date.now(), warnings };
}

async function listRegistry(): Promise<StartupEntry[]> {
  const script = `
$ErrorActionPreference='SilentlyContinue';
$keys = @(
  @{ Hive='HKCU'; Path='Software\\Microsoft\\Windows\\CurrentVersion\\Run'; Approved='Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'; Admin=$false },
  @{ Hive='HKCU'; Path='Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'; Approved=$null; Admin=$false },
  @{ Hive='HKLM'; Path='Software\\Microsoft\\Windows\\CurrentVersion\\Run'; Approved='Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'; Admin=$true },
  @{ Hive='HKLM'; Path='Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'; Approved=$null; Admin=$true },
  @{ Hive='HKLM'; Path='Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; Approved='Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32'; Admin=$true }
);
$out = @();
foreach ($k in $keys) {
  $rp = $k.Hive + ':\\' + $k.Path;
  if (-not (Test-Path $rp)) { continue }
  $props = Get-ItemProperty -Path $rp;
  $names = $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $_.Name };
  $approved = @{};
  if ($k.Approved) {
    $ap = $k.Hive + ':\\' + $k.Approved;
    if (Test-Path $ap) {
      $apItem = Get-Item -Path $ap;
      foreach ($vn in $apItem.GetValueNames()) {
        $bytes = $apItem.GetValue($vn);
        if ($bytes -is [byte[]] -and $bytes.Length -ge 1) { $approved[$vn] = [int]$bytes[0] }
      }
    }
  }
  foreach ($n in $names) {
    $cmd = [string]$props.$n;
    if (-not $cmd) { continue }
    $enabled = $true;
    if ($approved.ContainsKey($n)) { $enabled = ($approved[$n] -ne 3) }
    $out += [pscustomobject]@{
      Hive=$k.Hive; RegPath=$k.Path; Name=$n; Command=$cmd; Enabled=$enabled; NeedsAdmin=$k.Admin; RunOnce=($k.Path -match 'RunOnce')
    }
  }
}
$out | ConvertTo-Json -Compress -Depth 3
`;
  type Row = {
    Hive: string;
    RegPath: string;
    Name: string;
    Command: string;
    Enabled: boolean;
    NeedsAdmin: boolean;
    RunOnce: boolean;
  };
  const parsed = await psJson<Row[] | Row>(script);
  if (!parsed) return [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((r) => {
    const loc = `${r.Hive}\\${r.RegPath}`;
    const id = `registry:${r.Hive}|${r.RegPath}|${r.Name}`;
    return {
      id,
      name: r.Name,
      source: 'registry' as StartupSource,
      location: loc,
      command: r.Command,
      enabled: !!r.Enabled,
      revealPath: extractRevealPath(r.Command),
      publisher: r.RunOnce ? 'RunOnce' : 'Run',
      canEdit: true,
      canDelete: true,
      needsAdmin: !!r.NeedsAdmin
    };
  });
}

async function listStartupFolders(): Promise<StartupEntry[]> {
  const script = `
$ErrorActionPreference='SilentlyContinue';
$shell = New-Object -ComObject WScript.Shell;
$dirs = @(
  @{ Path=[Environment]::GetFolderPath('Startup'); Admin=$false; Label='User Startup' },
  @{ Path=[Environment]::GetFolderPath('CommonStartup'); Admin=$true; Label='Common Startup' }
);
$out = @();
foreach ($d in $dirs) {
  if (-not $d.Path -or -not (Test-Path $d.Path)) { continue }
  Get-ChildItem -LiteralPath $d.Path -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*.lnk' -or $_.Name -like '*.lnk.disabled' } |
    ForEach-Object {
      $enabled = -not ($_.Name -like '*.lnk.disabled');
      $target = '';
      $args = '';
      try {
        if ($_.Name -like '*.lnk' -and -not ($_.Name -like '*.lnk.disabled')) {
          $sc = $shell.CreateShortcut($_.FullName);
          $target = [string]$sc.TargetPath;
          $args = [string]$sc.Arguments;
        }
      } catch {}
      $cmd = if ($args) { '"' + $target + '" ' + $args } else { $target };
      $display = $_.Name -replace '\\.lnk(\\.disabled)?$','';
      $out += [pscustomobject]@{
        Name=$display;
        Path=$_.FullName; Command=$cmd; Target=$target; Enabled=$enabled; NeedsAdmin=$d.Admin; Label=$d.Label
      }
    }
}
$out | ConvertTo-Json -Compress -Depth 3
`;
  type Row = {
    Name: string;
    Path: string;
    Command: string;
    Target: string;
    Enabled: boolean;
    NeedsAdmin: boolean;
    Label: string;
  };
  const parsed = await psJson<Row[] | Row>(script);
  if (!parsed) return [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((r) => ({
    id: `folder:${r.Path}`,
    name: r.Name || path.basename(r.Path),
    source: 'folder' as StartupSource,
    location: r.Label,
    command: r.Command || r.Target || r.Path,
    enabled: !!r.Enabled,
    revealPath: r.Path,
    canEdit: !!r.Enabled, // only edit enabled .lnk (COM needs real shortcut)
    canDelete: true,
    needsAdmin: !!r.NeedsAdmin
  }));
}

async function listLogonTasks(): Promise<StartupEntry[]> {
  const script = `
$ErrorActionPreference='SilentlyContinue';
$out = @();
Get-ScheduledTask | Where-Object {
  $_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'LogonTrigger' }
} | ForEach-Object {
  $t = $_;
  $info = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction SilentlyContinue;
  $actions = @($t.Actions | ForEach-Object {
    $a = $_;
    $exe = [string]$a.Execute;
    $arg = [string]$a.Arguments;
    if ($arg) { '"' + $exe + '" ' + $arg } else { $exe }
  });
  $cmd = ($actions -join ' | ');
  $principal = [string]$t.Principal.UserId;
  $needsAdmin = ($t.Principal.RunLevel -eq 'Highest') -or ($principal -match 'SYSTEM|SERVICE');
  $out += [pscustomobject]@{
    Name=$t.TaskName; Path=$t.TaskPath; Command=$cmd; Enabled=($t.Settings.Enabled -eq $true);
    NeedsAdmin=$needsAdmin; State=[string]$t.State; Author=[string]$t.Author
  }
};
$out | ConvertTo-Json -Compress -Depth 3
`;
  type Row = {
    Name: string;
    Path: string;
    Command: string;
    Enabled: boolean;
    NeedsAdmin: boolean;
    State: string;
    Author: string;
  };
  const parsed = await psJson<Row[] | Row>(script, 45000);
  if (!parsed) return [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((r) => ({
    id: `task:${r.Path}${r.Name}`,
    name: r.Name,
    source: 'task' as StartupSource,
    location: `${r.Path}${r.Name}`,
    command: r.Command || '',
    enabled: !!r.Enabled,
    revealPath: extractRevealPath(r.Command || ''),
    publisher: r.Author || undefined,
    canEdit: true,
    canDelete: true,
    needsAdmin: !!r.NeedsAdmin
  }));
}

async function listServices(): Promise<StartupEntry[]> {
  const script = `
$ErrorActionPreference='SilentlyContinue';
Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,PathName,StartName |
  ConvertTo-Json -Compress -Depth 2
`;
  type Row = {
    Name: string;
    DisplayName: string;
    State: string;
    StartMode: string;
    PathName: string;
    StartName: string;
  };
  const parsed = await psJson<Row[] | Row>(script, 30000);
  if (!parsed) return [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((r) => {
    const mode = (r.StartMode || '').toLowerCase();
    const enabled = mode === 'auto' || mode === 'automatic';
    const prot = PROTECTED_SERVICES.has((r.Name || '').toLowerCase());
    return {
      id: `service:${r.Name}`,
      name: r.DisplayName || r.Name,
      source: 'service' as StartupSource,
      location: r.Name,
      command: r.PathName || '',
      enabled,
      revealPath: extractRevealPath(r.PathName || ''),
      publisher: r.StartName || undefined,
      canEdit: false,
      canDelete: false,
      needsAdmin: true,
      protected: prot
    };
  });
}

async function listBrowserExtensions(): Promise<StartupEntry[]> {
  const local = process.env.LOCALAPPDATA || '';
  if (!local) return [];
  const browsers: Array<{ id: string; label: string; root: string }> = [
    {
      id: 'chrome',
      label: 'Chrome',
      root: path.join(local, 'Google', 'Chrome', 'User Data')
    },
    {
      id: 'edge',
      label: 'Edge',
      root: path.join(local, 'Microsoft', 'Edge', 'User Data')
    }
  ];
  const out: StartupEntry[] = [];
  for (const b of browsers) {
    if (!fs.existsSync(b.root)) continue;
    let profiles: string[] = [];
    try {
      profiles = fs
        .readdirSync(b.root, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            (d.name === 'Default' || /^Profile \d+$/i.test(d.name))
        )
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const profile of profiles) {
      const prefPath = path.join(b.root, profile, 'Preferences');
      if (!fs.existsSync(prefPath)) continue;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
      } catch {
        continue;
      }
      const extRoot = (json.extensions || {}) as Record<string, unknown>;
      const settings = (extRoot.settings || {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [extId, meta] of Object.entries(settings)) {
        if (!meta || typeof meta !== 'object') continue;
        // Skip component / default / location 5 (external component) noise lightly
        const location = Number(meta.location ?? 0);
        if (location === 5 || location === 8) continue;
        const manifest = (meta.manifest || {}) as Record<string, unknown>;
        const name =
          (typeof manifest.name === 'string' && !manifest.name.startsWith('__')
            ? manifest.name
            : null) ||
          (typeof meta.path === 'string' ? path.basename(meta.path) : extId);
        const state = Number(meta.state ?? 1);
        // Chrome: 1=enabled, 0=disabled, 2=terminated, 3=BLOCKLISTED...
        const enabled = state === 1;
        const extPath =
          typeof meta.path === 'string'
            ? meta.path
            : path.join(b.root, profile, 'Extensions', extId);
        out.push({
          id: `browser:${b.id}|${profile}|${extId}`,
          name: String(name),
          source: 'browser',
          location: `${b.label} / ${profile}`,
          command: extId,
          enabled,
          revealPath: fs.existsSync(extPath) ? extPath : undefined,
          publisher:
            typeof manifest.author === 'string' ? manifest.author : b.label,
          canEdit: false,
          canDelete: true,
          needsAdmin: false
        });
      }
    }
  }
  return out;
}

// ---------------- mutations ----------------

export async function setStartupEnabled(
  id: string,
  enabled: boolean
): Promise<StartupMutationResult> {
  if (os.platform() !== 'win32') return fail('Windows only');
  const parsed = parseId(id);
  if (!parsed) return fail('Invalid id');

  switch (parsed.kind) {
    case 'registry':
      return setRegistryEnabled(parsed.rest, enabled);
    case 'folder':
      return setFolderEnabled(parsed.rest, enabled);
    case 'task':
      return setTaskEnabled(parsed.rest, enabled);
    case 'service':
      return setServiceEnabled(parsed.rest, enabled);
    case 'browser':
      return setBrowserEnabled(parsed.rest, enabled);
    default:
      return fail('Unknown source');
  }
}

async function setRegistryEnabled(
  rest: string,
  enabled: boolean
): Promise<StartupMutationResult> {
  // rest = Hive|RegPath|Name
  const parts = rest.split('|');
  if (parts.length < 3) return fail('Bad registry id');
  const [hive, regPath, ...nameParts] = parts;
  const name = nameParts.join('|');
  const approvedPath =
    hive === 'HKLM' && /WOW6432Node/i.test(regPath)
      ? 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32'
      : 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
  // byte0: 2=enabled, 3=disabled (Autoruns-compatible)
  const flag = enabled ? 2 : 3;
  const script = `
$ErrorActionPreference='Stop';
$ap = '${hive}:\\${approvedPath}';
if (-not (Test-Path $ap)) { New-Item -Path $ap -Force | Out-Null }
$bytes = New-Object byte[] 12;
$bytes[0] = ${flag};
Set-ItemProperty -Path $ap -Name '${name.replace(/'/g, "''")}' -Value $bytes -Type Binary;
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to update StartupApproved');
  }
  return ok();
}

async function setFolderEnabled(
  filePath: string,
  enabled: boolean
): Promise<StartupMutationResult> {
  try {
    if (enabled) {
      if (filePath.endsWith('.disabled')) {
        const target = filePath.replace(/\.disabled$/i, '');
        if (fs.existsSync(target)) return fail('Target shortcut already exists');
        fs.renameSync(filePath, target);
      }
    } else {
      if (!filePath.toLowerCase().endsWith('.disabled')) {
        const target = filePath + '.disabled';
        if (fs.existsSync(target)) return fail('Disabled shortcut already exists');
        fs.renameSync(filePath, target);
      }
    }
    return ok();
  } catch (e) {
    return fail((e as Error).message);
  }
}

async function setTaskEnabled(
  taskKey: string,
  enabled: boolean
): Promise<StartupMutationResult> {
  // taskKey = TaskPath + TaskName, TaskPath always starts with \
  const m = taskKey.match(/^(\\.*)([^\\]+)$/);
  if (!m) return fail('Bad task id');
  const taskPath = m[1];
  const taskName = m[2];
  const cmd = enabled ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask';
  const script = `
$ErrorActionPreference='Stop';
${cmd} -TaskName '${taskName.replace(/'/g, "''")}' -TaskPath '${taskPath.replace(/'/g, "''")}' | Out-Null;
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to toggle task');
  }
  return ok();
}

async function setServiceEnabled(
  serviceName: string,
  enabled: boolean
): Promise<StartupMutationResult> {
  if (PROTECTED_SERVICES.has(serviceName.toLowerCase())) {
    return fail('This service is protected and cannot be disabled.');
  }
  const mode = enabled ? 'Automatic' : 'Disabled';
  const script = `
$ErrorActionPreference='Stop';
Set-Service -Name '${serviceName.replace(/'/g, "''")}' -StartupType ${mode};
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to change service start type');
  }
  return ok();
}

async function setBrowserEnabled(
  rest: string,
  enabled: boolean
): Promise<StartupMutationResult> {
  const parts = rest.split('|');
  if (parts.length < 3) return fail('Bad browser id');
  const [browser, profile, extId] = parts;
  const prefPath = browserPrefsPath(browser, profile);
  if (!prefPath) return fail('Unknown browser');
  return mutatePreferences(prefPath, (json) => {
    const settings = ensureExtSettings(json);
    if (!settings[extId]) throw new Error('Extension not found in Preferences');
    settings[extId].state = enabled ? 1 : 0;
  });
}

function browserPrefsPath(browser: string, profile: string): string | null {
  const local = process.env.LOCALAPPDATA || '';
  if (browser === 'chrome') {
    return path.join(local, 'Google', 'Chrome', 'User Data', profile, 'Preferences');
  }
  if (browser === 'edge') {
    return path.join(
      local,
      'Microsoft',
      'Edge',
      'User Data',
      profile,
      'Preferences'
    );
  }
  return null;
}

function ensureExtSettings(
  json: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  if (!json.extensions || typeof json.extensions !== 'object') {
    json.extensions = {};
  }
  const ext = json.extensions as Record<string, unknown>;
  if (!ext.settings || typeof ext.settings !== 'object') {
    ext.settings = {};
  }
  return ext.settings as Record<string, Record<string, unknown>>;
}

function mutatePreferences(
  prefPath: string,
  mutator: (json: Record<string, unknown>) => void
): StartupMutationResult {
  try {
    if (!fs.existsSync(prefPath)) return fail('Preferences not found');
    const raw = fs.readFileSync(prefPath, 'utf8');
    const bak = prefPath + '.closedport.bak';
    if (!fs.existsSync(bak)) {
      fs.writeFileSync(bak, raw, 'utf8');
    }
    const json = JSON.parse(raw) as Record<string, unknown>;
    mutator(json);
    const tmp = prefPath + '.closedport.tmp';
    fs.writeFileSync(tmp, JSON.stringify(json), 'utf8');
    fs.renameSync(tmp, prefPath);
    return ok();
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function updateStartup(
  id: string,
  command: string
): Promise<StartupMutationResult> {
  if (os.platform() !== 'win32') return fail('Windows only');
  if (typeof command !== 'string' || !command.trim()) {
    return fail('Command is empty');
  }
  const parsed = parseId(id);
  if (!parsed) return fail('Invalid id');

  switch (parsed.kind) {
    case 'registry':
      return updateRegistryCommand(parsed.rest, command);
    case 'folder':
      return updateFolderShortcut(parsed.rest, command);
    case 'task':
      return updateTaskAction(parsed.rest, command);
    case 'service':
      return fail('Service image path cannot be edited here');
    case 'browser':
      return fail('Browser extension commands cannot be edited');
    default:
      return fail('Unknown source');
  }
}

async function updateRegistryCommand(
  rest: string,
  command: string
): Promise<StartupMutationResult> {
  const parts = rest.split('|');
  if (parts.length < 3) return fail('Bad registry id');
  const [hive, regPath, ...nameParts] = parts;
  const name = nameParts.join('|');
  const script = `
$ErrorActionPreference='Stop';
Set-ItemProperty -Path '${hive}:\\${regPath}' -Name '${name.replace(/'/g, "''")}' -Value '${command.replace(/'/g, "''")}';
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to update registry value');
  }
  return ok();
}

async function updateFolderShortcut(
  filePath: string,
  command: string
): Promise<StartupMutationResult> {
  if (filePath.toLowerCase().endsWith('.disabled')) {
    return fail('Re-enable the shortcut before editing');
  }
  const reveal = extractRevealPath(command);
  const target = reveal || command.trim();
  let args = '';
  if (command.startsWith('"')) {
    const m = command.match(/^"[^"]+"\s*(.*)$/);
    args = m ? m[1] : '';
  } else {
    const sp = command.trim().split(/\s+/);
    args = sp.slice(1).join(' ');
  }
  const script = `
$ErrorActionPreference='Stop';
$shell = New-Object -ComObject WScript.Shell;
$sc = $shell.CreateShortcut('${filePath.replace(/'/g, "''")}');
$sc.TargetPath = '${target.replace(/'/g, "''")}';
$sc.Arguments = '${args.replace(/'/g, "''")}';
$sc.Save();
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to update shortcut');
  }
  return ok();
}

async function updateTaskAction(
  taskKey: string,
  command: string
): Promise<StartupMutationResult> {
  const m = taskKey.match(/^(\\.*)([^\\]+)$/);
  if (!m) return fail('Bad task id');
  const taskPath = m[1];
  const taskName = m[2];
  const exe = extractRevealPath(command) || command.trim().split(/\s+/)[0];
  let args = '';
  if (command.startsWith('"')) {
    const mm = command.match(/^"[^"]+"\s*(.*)$/);
    args = mm ? mm[1] : '';
  } else {
    args = command.trim().split(/\s+/).slice(1).join(' ');
  }
  const script = `
$ErrorActionPreference='Stop';
$task = Get-ScheduledTask -TaskName '${taskName.replace(/'/g, "''")}' -TaskPath '${taskPath.replace(/'/g, "''")}';
$action = New-ScheduledTaskAction -Execute '${exe.replace(/'/g, "''")}' -Argument '${args.replace(/'/g, "''")}';
Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $action | Out-Null;
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to update task action');
  }
  return ok();
}

export async function deleteStartup(id: string): Promise<StartupMutationResult> {
  if (os.platform() !== 'win32') return fail('Windows only');
  const parsed = parseId(id);
  if (!parsed) return fail('Invalid id');

  switch (parsed.kind) {
    case 'registry':
      return deleteRegistry(parsed.rest);
    case 'folder':
      return deleteFolder(parsed.rest);
    case 'task':
      return deleteTask(parsed.rest);
    case 'service':
      return fail('Services cannot be uninstalled here; disable instead');
    case 'browser':
      return deleteBrowserExt(parsed.rest);
    default:
      return fail('Unknown source');
  }
}

async function deleteRegistry(rest: string): Promise<StartupMutationResult> {
  const parts = rest.split('|');
  if (parts.length < 3) return fail('Bad registry id');
  const [hive, regPath, ...nameParts] = parts;
  const name = nameParts.join('|');
  const script = `
$ErrorActionPreference='Stop';
Remove-ItemProperty -Path '${hive}:\\${regPath}' -Name '${name.replace(/'/g, "''")}' -Force;
$apCandidates = @(
  '${hive}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  '${hive}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32'
);
foreach ($ap in $apCandidates) {
  if (Test-Path $ap) {
    Remove-ItemProperty -Path $ap -Name '${name.replace(/'/g, "''")}' -Force -ErrorAction SilentlyContinue;
  }
}
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to delete registry value');
  }
  return ok();
}

async function deleteFolder(filePath: string): Promise<StartupMutationResult> {
  try {
    fs.unlinkSync(filePath);
    return ok();
  } catch (e) {
    return fail((e as Error).message);
  }
}

async function deleteTask(taskKey: string): Promise<StartupMutationResult> {
  const m = taskKey.match(/^(\\.*)([^\\]+)$/);
  if (!m) return fail('Bad task id');
  const taskPath = m[1];
  const taskName = m[2];
  const script = `
$ErrorActionPreference='Stop';
Unregister-ScheduledTask -TaskName '${taskName.replace(/'/g, "''")}' -TaskPath '${taskPath.replace(/'/g, "''")}' -Confirm:$false;
'OK'
`;
  const res = await psCommand(script);
  if (res.code !== 0 || !/OK/.test(res.stdout)) {
    return fail(res.stderr.slice(0, 300) || 'Failed to unregister task');
  }
  return ok();
}

async function deleteBrowserExt(rest: string): Promise<StartupMutationResult> {
  const parts = rest.split('|');
  if (parts.length < 3) return fail('Bad browser id');
  const [browser, profile, extId] = parts;
  const prefPath = browserPrefsPath(browser, profile);
  if (!prefPath) return fail('Unknown browser');
  const result = mutatePreferences(prefPath, (json) => {
    const settings = ensureExtSettings(json);
    delete settings[extId];
  });
  if (!result.success) return result;
  // Best-effort remove on-disk extension folder
  try {
    const local = process.env.LOCALAPPDATA || '';
    const root =
      browser === 'chrome'
        ? path.join(local, 'Google', 'Chrome', 'User Data', profile, 'Extensions', extId)
        : path.join(
            local,
            'Microsoft',
            'Edge',
            'User Data',
            profile,
            'Extensions',
            extId
          );
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  return ok('Extension removed from Preferences. Restart the browser to apply.');
}
