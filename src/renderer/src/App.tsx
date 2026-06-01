import React, { useEffect, useMemo, useState, useCallback } from 'react';
import type { PortEntry, SystemInfo } from '../../shared/types';

type SortKey =
  | 'localPort'
  | 'protocol'
  | 'state'
  | 'pid'
  | 'processName'
  | 'processPath'
  | 'parentName';

interface SortSpec {
  key: SortKey;
  asc: boolean;
}

type ViewMode = 'flat' | 'grouped';

const App: React.FC = () => {
  const [tab, setTab] = useState<'ports' | 'folder'>('ports');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    window.closedport
      .getSystemInfo()
      .then(setSystemInfo)
      .catch(() => setSystemInfo(null));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">ClosedPort</span>
        <div className="tabs">
          <div
            className={`tab ${tab === 'ports' ? 'active' : ''}`}
            onClick={() => setTab('ports')}
          >
            Ports
          </div>
          <div
            className={`tab ${tab === 'folder' ? 'active' : ''}`}
            onClick={() => setTab('folder')}
          >
            Folder Locks {systemInfo?.platform !== 'win32' && '(Win only)'}
          </div>
        </div>
        <div className="spacer" />
        {systemInfo && (
          <>
            <span className="badge">{systemInfo.platform}</span>
            <span className={`badge ${systemInfo.isAdmin ? 'ok' : 'warn'}`}>
              {systemInfo.isAdmin ? 'Elevated' : 'Standard'}
            </span>
          </>
        )}
        <button onClick={() => window.closedport.toggleFloating()}>
          Floating
        </button>
      </header>

      {tab === 'ports' ? (
        <PortsView systemInfo={systemInfo} />
      ) : (
        <FolderView systemInfo={systemInfo} />
      )}
    </div>
  );
};

const PortsView: React.FC<{ systemInfo: SystemInfo | null }> = ({
  systemInfo
}) => {
  const [rows, setRows] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortSpec>({ key: 'localPort', asc: true });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('flat');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.closedport.listPorts();
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter((r) => {
        return (
          String(r.localPort).includes(q) ||
          String(r.pid).includes(q) ||
          (r.processName || '').toLowerCase().includes(q) ||
          (r.processPath || '').toLowerCase().includes(q) ||
          (r.protocol || '').toLowerCase().includes(q) ||
          (r.state || '').toLowerCase().includes(q) ||
          (r.parentName || '').toLowerCase().includes(q)
        );
      });
    }
    const { key, asc } = sort;
    list = [...list].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return asc ? va - vb : vb - va;
      }
      return asc
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return list;
  }, [rows, filter, sort]);

  // Aggregate filtered rows by processName (or "Unknown") for the grouped view.
  // Each group exposes the unique pids it owns and the count of port records.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        path?: string;
        pids: Set<number>;
        items: PortEntry[];
      }
    >();
    for (const r of filtered) {
      const key = r.processName || 'Unknown';
      let g = map.get(key);
      if (!g) {
        g = { key, name: key, path: r.processPath, pids: new Set(), items: [] };
        map.set(key, g);
      }
      if (!g.path && r.processPath) g.path = r.processPath;
      if (r.pid > 0) g.pids.add(r.pid);
      g.items.push(r);
    }
    return Array.from(map.values()).sort((a, b) => {
      // sort groups by entry count desc, then by name
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      return a.name.localeCompare(b.name);
    });
  }, [filtered]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, asc: !prev.asc } : { key, asc: true }
    );
  };

  const toggleSelect = (pid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const killOne = async (pid: number) => {
    if (!confirm(`Kill PID ${pid}?`)) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) {
      alert(`Failed to kill ${pid}: ${res.message}`);
    }
    await refresh();
  };

  const killSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Kill ${selected.size} process(es)?`)) return;
    const results = await window.closedport.killProcesses(
      Array.from(selected),
      true
    );
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `Failed: ${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    setSelected(new Set());
    await refresh();
  };

  const killGroup = async (pids: number[]) => {
    if (pids.length === 0) return;
    if (!confirm(`Kill all ${pids.length} process(es) in this group?`)) return;
    const results = await window.closedport.killProcesses(pids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `Failed: ${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    await refresh();
  };

  const spawnTestPorts = async () => {
    try {
      const spawned = await window.closedport.spawnTestPorts(5);
      if (spawned.length === 0) {
        alert('No test ports were spawned. (This action is Windows-only.)');
      } else {
        const list = spawned
          .map((s) => `pid=${s.pid} port=${s.port}`)
          .join('\n');
        alert(`Spawned ${spawned.length} test child process(es):\n${list}`);
      }
      await refresh();
    } catch (err) {
      alert(`Failed to spawn test ports: ${(err as Error)?.message ?? err}`);
    }
  };

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by port, pid, name, path, state, parent..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 380 }}
        />
        <div className="view-switch">
          <button
            className={viewMode === 'flat' ? 'primary' : 'ghost'}
            onClick={() => setViewMode('flat')}
          >
            Flat
          </button>
          <button
            className={viewMode === 'grouped' ? 'primary' : 'ghost'}
            onClick={() => setViewMode('grouped')}
          >
            Group by EXE
          </button>
        </div>
        <button onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button
          className="danger"
          onClick={killSelected}
          disabled={selected.size === 0}
        >
          Kill Selected ({selected.size})
        </button>
        {systemInfo?.devToolsEnabled && (
          <button
            className="ghost"
            onClick={spawnTestPorts}
            title="Spawn 5 child processes that bind random ports, for testing kill / release flows. Windows only."
          >
            Spawn test ports
          </button>
        )}
        <div className="spacer" />
        <span className="badge">
          {viewMode === 'flat'
            ? `${filtered.length} entries`
            : `${groups.length} apps / ${filtered.length} entries`}
        </span>
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="content">
        {filtered.length === 0 && !loading ? (
          <div className="empty">No ports found.</div>
        ) : viewMode === 'flat' ? (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th onClick={() => toggleSort('protocol')}>Proto</th>
                <th onClick={() => toggleSort('localPort')}>Local</th>
                <th>Remote</th>
                <th onClick={() => toggleSort('state')}>State</th>
                <th onClick={() => toggleSort('pid')}>PID</th>
                <th onClick={() => toggleSort('processName')}>Process</th>
                <th onClick={() => toggleSort('parentName')} title="Started by">
                  Started by
                </th>
                <th onClick={() => toggleSort('processPath')}>Path</th>
                <th>User</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr
                  key={`${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
                  className={selected.has(r.pid) ? 'selected' : ''}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.pid)}
                      onChange={() => toggleSelect(r.pid)}
                    />
                  </td>
                  <td>{r.protocol}</td>
                  <td className="mono">
                    {r.localAddress}:{r.localPort}
                  </td>
                  <td className="mono">
                    {r.remoteAddress
                      ? `${r.remoteAddress}:${r.remotePort ?? ''}`
                      : '—'}
                  </td>
                  <td>{r.state || '—'}</td>
                  <td className="mono">{r.pid || '—'}</td>
                  <td title={r.processName}>{r.processName || '—'}</td>
                  <td
                    className="mono"
                    title={
                      r.parentName
                        ? `${r.parentName} (pid ${r.parentPid})`
                        : r.parentPid
                          ? `pid ${r.parentPid}`
                          : ''
                    }
                  >
                    {r.parentName
                      ? `${r.parentName} (${r.parentPid})`
                      : r.parentPid
                        ? `pid ${r.parentPid}`
                        : '—'}
                  </td>
                  <td className="mono" title={r.processPath}>
                    {r.processPath || '—'}
                  </td>
                  <td>{r.user || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="ghost"
                        disabled={!r.processPath}
                        onClick={() =>
                          r.processPath &&
                          window.closedport.revealInFolder(r.processPath)
                        }
                        title="Reveal in folder"
                      >
                        Open
                      </button>
                      <button
                        className="danger"
                        disabled={!r.pid}
                        onClick={() => killOne(r.pid)}
                      >
                        Kill
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="group-list">
            {groups.map((g) => {
              const isOpen = expanded.has(g.key);
              return (
                <div className="group" key={g.key}>
                  <div
                    className="group-header"
                    onClick={() => toggleExpand(g.key)}
                  >
                    <span className="group-toggle">
                      {isOpen ? '−' : '+'}
                    </span>
                    <span className="group-name" title={g.path}>
                      {g.name}
                    </span>
                    <span className="badge">{g.items.length} ports</span>
                    <span className="badge">{g.pids.size} pids</span>
                    <span className="group-path mono" title={g.path}>
                      {g.path || ''}
                    </span>
                    <div className="spacer" />
                    <button
                      className="ghost"
                      disabled={!g.path}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (g.path) window.closedport.revealInFolder(g.path);
                      }}
                    >
                      Open
                    </button>
                    <button
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        killGroup(Array.from(g.pids));
                      }}
                    >
                      Kill Group
                    </button>
                  </div>
                  {isOpen && (
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>Proto</th>
                          <th>Local</th>
                          <th>State</th>
                          <th>PID</th>
                          <th>Started by</th>
                          <th style={{ width: 100 }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((r, i) => (
                          <tr
                            key={`${g.key}-${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
                          >
                            <td>{r.protocol}</td>
                            <td className="mono">
                              {r.localAddress}:{r.localPort}
                            </td>
                            <td>{r.state || '—'}</td>
                            <td className="mono">{r.pid || '—'}</td>
                            <td className="mono">
                              {r.parentName
                                ? `${r.parentName} (${r.parentPid})`
                                : r.parentPid
                                  ? `pid ${r.parentPid}`
                                  : '—'}
                            </td>
                            <td>
                              <button
                                className="danger"
                                disabled={!r.pid}
                                onClick={() => killOne(r.pid)}
                              >
                                Kill
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

const FolderView: React.FC<{ systemInfo: SystemInfo | null }> = ({
  systemInfo
}) => {
  const [folder, setFolder] = useState('');
  const [rows, setRows] = useState<
    Array<{
      pid: number;
      processName: string;
      processPath?: string;
      handleType: string;
      resourcePath: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWin = systemInfo?.platform === 'win32';

  const pick = async () => {
    const p = await window.closedport.pickFolder();
    if (p) setFolder(p);
  };

  const scan = async () => {
    if (!folder) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.closedport.scanFolder({ folderPath: folder });
      setRows(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const killOne = async (pid: number) => {
    if (!confirm(`Kill PID ${pid}?`)) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) alert(`Failed: ${res.message}`);
    await scan();
  };

  const uniquePids = Array.from(new Set(rows.map((r) => r.pid)));

  const killAll = async () => {
    if (uniquePids.length === 0) return;
    if (!confirm(`Kill ${uniquePids.length} process(es)?`)) return;
    const results = await window.closedport.killProcesses(uniquePids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `Failed: ${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    await scan();
  };

  return (
    <>
      <div className="toolbar">
        <div className="path-input">
          <input
            type="text"
            placeholder="Pick or paste a folder path..."
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <button onClick={pick}>Browse</button>
        </div>
        <button
          className="primary"
          disabled={!folder || loading || !isWin}
          onClick={scan}
        >
          {loading ? 'Scanning...' : 'Scan'}
        </button>
        <button
          className="danger"
          disabled={uniquePids.length === 0}
          onClick={killAll}
        >
          Kill All ({uniquePids.length})
        </button>
      </div>

      {!isWin && (
        <div className="banner">
          Folder lock detection is Windows-only. On macOS / Linux, use the
          Ports tab; file-handle holding is rarely a blocker outside Windows.
        </div>
      )}

      {isWin && systemInfo && !systemInfo.handleAvailable && (
        <div className="banner">
          handle.exe (Sysinternals) not detected. Falling back to RestartManager
          which only catches user-mode locks (Word, Excel, IDEs, etc).
          Drop <code>handle.exe</code> / <code>handle64.exe</code> into the
          app's <code>resources/</code> folder, or place it on PATH for full
          coverage.
        </div>
      )}

      {error && <div className="banner">{error}</div>}

      <div className="content">
        {rows.length === 0 && !loading ? (
          <div className="empty">
            {folder
              ? 'No locking processes found (or scan not run yet).'
              : 'Pick a folder to scan.'}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>PID</th>
                <th>Process</th>
                <th>Path</th>
                <th>Handle</th>
                <th>Resource</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.pid}-${r.resourcePath}-${i}`}>
                  <td className="mono">{r.pid}</td>
                  <td>{r.processName}</td>
                  <td className="mono" title={r.processPath}>
                    {r.processPath || '—'}
                  </td>
                  <td>{r.handleType}</td>
                  <td className="mono" title={r.resourcePath}>
                    {r.resourcePath}
                  </td>
                  <td>
                    <button className="danger" onClick={() => killOne(r.pid)}>
                      Kill
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

export default App;
