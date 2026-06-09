import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { PortEntry, ProcessEntry, SystemInfo } from '../../shared/types';

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
type GroupSortKey = 'name' | 'ports' | 'pids';

const App: React.FC = () => {
  const [tab, setTab] = useState<'ports' | 'folder' | 'processes'>('ports');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    window.closedport
      .getSystemInfo()
      .then(setSystemInfo)
      .catch(() => setSystemInfo(null));
  }, []);

  // Block the browser default for any dragover/drop that escapes the
  // folder drop-zone. Without this, dropping a file outside the
  // designated panel would cause Electron to navigate the renderer
  // away to file:///... — visually identical to the app crashing.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      // Only suppress when the payload looks like files; leave plain
      // text drags (selection, etc.) alone.
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
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
          <div
            className={`tab ${tab === 'processes' ? 'active' : ''}`}
            onClick={() => setTab('processes')}
          >
            Processes
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

      {/* Both views are kept mounted so toggling tabs doesn't reset
          filters / sort / expanded groups / scan results. We just hide
          the inactive one with display:none. */}
      <div
        className="tab-pane"
        style={{
          display: tab === 'ports' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}
      >
        <PortsView systemInfo={systemInfo} />
      </div>
      <div
        className="tab-pane"
        style={{
          display: tab === 'folder' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}
      >
        <FolderView systemInfo={systemInfo} />
      </div>
      <div
        className="tab-pane"
        style={{
          display: tab === 'processes' ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}
      >
        <ProcessesView />
      </div>
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
  const [groupSort, setGroupSort] = useState<{
    key: GroupSortKey;
    asc: boolean;
  }>({ key: 'name', asc: true });
  // Track PIDs we created via the "Spawn test ports" diagnostic so we can
  // visually highlight them in the list (orange badge / striped row). The
  // set persists across refreshes and is only cleared when the user clicks
  // "Clear test markers" or successfully kills them.
  const [spawnedPids, setSpawnedPids] = useState<Set<number>>(new Set());
  const [spawnedPorts, setSpawnedPorts] = useState<Set<number>>(new Set());
  // Authoritative pid -> port map for spawned test holders. Used by
  // dropSpawnedFor so we don't have to reverse-lookup against `rows`,
  // which could already be stale after a manual refresh between confirm
  // and kill.
  const [spawnedPidToPort, setSpawnedPidToPort] = useState<Map<number, number>>(
    new Map()
  );

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

  // PID-recycle guard: after each refresh, verify that every spawned
  // (pid, port) pair we still believe in is actually present in `rows`.
  // If a holder has died and Windows has handed its PID to an unrelated
  // process, that unrelated process will not also be sitting on our
  // recorded port, so we drop the marker. This means a recycled PID
  // can no longer inherit the orange TEST highlight (or, more
  // critically, the renderer's "this is one of our throw-away children"
  // semantics that downstream Kill / Kill Group rely on).
  useEffect(() => {
    if (spawnedPidToPort.size === 0) return;
    const stillValid = new Map<number, number>();
    for (const [pid, port] of spawnedPidToPort) {
      const matched = rows.some((r) => r.pid === pid && r.localPort === port);
      if (matched) stillValid.set(pid, port);
    }
    if (stillValid.size === spawnedPidToPort.size) return;
    setSpawnedPidToPort(stillValid);
    setSpawnedPids(new Set(stillValid.keys()));
    setSpawnedPorts(new Set(stillValid.values()));
  }, [rows, spawnedPidToPort]);

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
      // Always float spawned-test rows to the top so the user can see and
      // verify the kill flow without scrolling. This wins over any column
      // sort.
      const aTest =
        spawnedPids.has(a.pid) || spawnedPorts.has(a.localPort) ? 1 : 0;
      const bTest =
        spawnedPids.has(b.pid) || spawnedPorts.has(b.localPort) ? 1 : 0;
      if (aTest !== bTest) return bTest - aTest;
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
  }, [rows, filter, sort, spawnedPids, spawnedPorts]);

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
    const all = Array.from(map.values());
    // Pull "Unknown" bucket aside so it always renders at the bottom,
    // regardless of how many ports/pids it aggregates.
    const unknown = all.filter((g) => g.name === 'Unknown');
    const named = all.filter((g) => g.name !== 'Unknown');
    named.sort((a, b) => {
      const dir = groupSort.asc ? 1 : -1;
      if (groupSort.key === 'ports') {
        if (a.items.length !== b.items.length) {
          return (a.items.length - b.items.length) * dir;
        }
        return a.name.localeCompare(b.name) * dir;
      }
      if (groupSort.key === 'pids') {
        if (a.pids.size !== b.pids.size) {
          return (a.pids.size - b.pids.size) * dir;
        }
        return a.name.localeCompare(b.name) * dir;
      }
      // name (case-insensitive)
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
    });
    return [...named, ...unknown];
  }, [filtered, groupSort]);

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

  const dropSpawnedFor = (pids: number[]) => {
    if (pids.length === 0) return;
    const pidSet = new Set(pids);
    // Resolve ports via the authoritative spawn-time map (avoids reverse
    // lookup against possibly-stale `rows`).
    const portsBeingKilled = new Set<number>();
    for (const pid of pids) {
      const port = spawnedPidToPort.get(pid);
      if (typeof port === 'number') portsBeingKilled.add(port);
    }
    setSpawnedPids((prev) => {
      const next = new Set(prev);
      for (const p of pids) next.delete(p);
      return next;
    });
    setSpawnedPorts((prev) => {
      const next = new Set(prev);
      for (const port of portsBeingKilled) next.delete(port);
      return next;
    });
    setSpawnedPidToPort((prev) => {
      const next = new Map(prev);
      for (const p of pidSet) next.delete(p);
      return next;
    });
  };

  const killOne = async (pid: number) => {
    if (!confirm(`Kill PID ${pid}?`)) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) {
      alert(`Failed to kill ${pid}: ${res.message}`);
    } else {
      dropSpawnedFor([pid]);
    }
    await refresh();
  };

  const killSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Kill ${selected.size} process(es)?`)) return;
    const pids = Array.from(selected);
    const results = await window.closedport.killProcesses(pids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `Failed: ${failed.map((f) => `${f.pid}: ${f.message}`).join('\n')}`
      );
    }
    const succeededPids = results.filter((r) => r.success).map((r) => r.pid);
    dropSpawnedFor(succeededPids);
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
    const succeededPids = results.filter((r) => r.success).map((r) => r.pid);
    dropSpawnedFor(succeededPids);
    await refresh();
  };

  const clearTestMarkers = () => {
    setSpawnedPids(new Set());
    setSpawnedPorts(new Set());
    setSpawnedPidToPort(new Map());
  };

  const spawnTestPorts = async () => {
    try {
      const spawned = await window.closedport.spawnTestPorts(5);
      if (spawned.length === 0) {
        alert('No test ports were spawned. (This action is Windows-only.)');
      } else {
        setSpawnedPids((prev) => {
          const next = new Set(prev);
          spawned.forEach((s) => next.add(s.pid));
          return next;
        });
        setSpawnedPorts((prev) => {
          const next = new Set(prev);
          spawned.forEach((s) => next.add(s.port));
          return next;
        });
        setSpawnedPidToPort((prev) => {
          const next = new Map(prev);
          spawned.forEach((s) => next.set(s.pid, s.port));
          return next;
        });
        // Auto-switch to Flat and clear filter so the highlighted rows
        // are immediately visible without being filtered out.
        setViewMode('flat');
        setFilter('');
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
            className="test"
            onClick={spawnTestPorts}
            title="Diagnostic helper (Windows): spawns 5 child processes that bind random TCP ports. Use the row Kill button or Kill Group to clean them up — they are NOT auto-cleaned until you quit the app."
          >
            Spawn test ports
          </button>
        )}
        {(spawnedPids.size > 0 || spawnedPorts.size > 0) && (
          <button
            className="ghost"
            onClick={clearTestMarkers}
            title="Forget which rows were spawned by the test helper (does NOT kill the processes)."
          >
            Clear test markers ({spawnedPids.size})
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
              {filtered.map((r) => {
                const isTest =
                  spawnedPids.has(r.pid) || spawnedPorts.has(r.localPort);
                const cls = [
                  selected.has(r.pid) ? 'selected' : '',
                  isTest ? 'test-port' : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr
                    key={`${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
                    className={cls}
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
                      {isTest && (
                        <span className="test-tag" title="Spawned by 'Spawn test ports'">
                          TEST
                        </span>
                      )}
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
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="group-list">
            <div className="group-sort-bar">
              <span className="group-sort-label">Sort by:</span>
              {(['name', 'ports', 'pids'] as GroupSortKey[]).map((k) => {
                const active = groupSort.key === k;
                const arrow = active ? (groupSort.asc ? ' ↑' : ' ↓') : '';
                return (
                  <button
                    key={k}
                    className={active ? 'primary' : 'ghost'}
                    onClick={() =>
                      setGroupSort((prev) =>
                        prev.key === k
                          ? { key: k, asc: !prev.asc }
                          : { key: k, asc: k === 'name' }
                      )
                    }
                  >
                    {k === 'name' ? 'Name' : k === 'ports' ? 'Ports' : 'PIDs'}
                    {arrow}
                  </button>
                );
              })}
            </div>
            {groups.map((g) => {
              const isOpen = expanded.has(g.key);
              const groupHasTest =
                g.items.some(
                  (r) =>
                    spawnedPids.has(r.pid) || spawnedPorts.has(r.localPort)
                );
              return (
                <div
                  className={`group${groupHasTest ? ' test-group' : ''}`}
                  key={g.key}
                >
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
                        {g.items.map((r) => {
                          const isTest =
                            spawnedPids.has(r.pid) ||
                            spawnedPorts.has(r.localPort);
                          return (
                            <tr
                              key={`${g.key}-${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
                              className={isTest ? 'test-port' : ''}
                            >
                              <td>{r.protocol}</td>
                              <td className="mono">
                                {r.localAddress}:{r.localPort}
                                {isTest && (
                                  <span
                                    className="test-tag"
                                    title="Spawned by 'Spawn test ports'"
                                  >
                                    TEST
                                  </span>
                                )}
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
                          );
                        })}
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
  const [lastMeta, setLastMeta] = useState<{
    backend: 'handle.exe' | 'restart-manager' | 'unsupported';
    scannedFileCount?: number;
    folderExists: boolean;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const isWin = systemInfo?.platform === 'win32';

  const pick = async () => {
    const p = await window.closedport.pickFolder();
    if (p) setFolder(p);
  };

  const scan = useCallback(
    async (target?: string) => {
      const folderPath = (target ?? folder).trim();
      if (!folderPath) return;
      setLoading(true);
      setError(null);
      try {
        const res = await window.closedport.scanFolderEx({ folderPath });
        setRows(res.entries);
        setLastMeta(res.meta);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLastMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [folder]
  );

  // Drag-and-drop: accept exactly one folder (or one file -- we'll
  // resolve to its parent directory) and trigger an immediate scan.
  //
  // Drag events fire on every nested child element (table cells, buttons,
  // even text nodes), and any time the cursor crosses a child boundary
  // the browser fires dragleave on the parent followed by dragenter on
  // the new child. A naive depth-counter approach is fragile: combined
  // with `pointer-events: none` toggling on children, the counter and
  // the class state get out of sync and the UI flickers. Instead we look
  // at `relatedTarget` -- the element the cursor is moving TO. If it's
  // still inside our wrapper, the leave is bogus and we ignore it.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const onDragEnter = (e: React.DragEvent) => {
    if (!isWin) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!isWin) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    // Both preventDefault AND a non-'none' dropEffect are required for
    // the cursor to show the copy/accept icon AND for `drop` to fire at
    // all on Chromium. Setting it on every dragover is intentional --
    // some platforms reset it between events.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!isWin) return;
    // Ignore leaves that are really "the cursor moved from one child to
    // another inside this wrapper". Only react when relatedTarget is null
    // (left the window entirely) or sits outside our wrapper.
    const next = e.relatedTarget as Node | null;
    if (next && wrapperRef.current?.contains(next)) return;
    setIsDragOver(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!isWin) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const resolved = window.closedport.resolveDroppedPath(file);
    if (!resolved) {
      setError('Could not resolve the dropped item to a filesystem path.');
      return;
    }
    // If the user dropped a file, scan its parent directory; the user's
    // intent is almost always "who's holding things in this folder?".
    let target = resolved;
    try {
      // We can't statSync from the renderer; rely on File.type/empty
      // string heuristic: directories come through with empty `type`
      // AND some browsers report size 0. Safer: ask main via a quick
      // existsSync proxy -- but we don't have one. Use a simple rule:
      // if the path has an extension, treat as file; else folder.
      const looksLikeFile = /\.[^\\/]+$/.test(resolved);
      if (looksLikeFile) {
        const sep = resolved.includes('\\') ? '\\' : '/';
        const idx = resolved.lastIndexOf(sep);
        if (idx > 0) target = resolved.slice(0, idx);
      }
    } catch {
      /* fall back to resolved */
    }
    setFolder(target);
    await scan(target);
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
    <div
      ref={wrapperRef}
      className={`folder-view${isDragOver ? ' is-dragover' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="toolbar">
        <div className="path-input">
          <input
            type="text"
            placeholder={
              isWin
                ? 'Pick, paste, or drag a folder onto this panel...'
                : 'Pick or paste a folder path...'
            }
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <button onClick={pick}>Browse</button>
        </div>
        <button
          className="primary"
          disabled={!folder || loading || !isWin}
          onClick={() => scan()}
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
          <strong>Limited mode:</strong> handle.exe (Sysinternals) not
          detected, so we&apos;re using Windows RestartManager. RM only sees{' '}
          <em>user-mode exclusive locks</em> (Word/Excel saving, IDE write
          locks, msbuild output, etc.) — it will <strong>not</strong> show
          read-only handles, memory-mapped DLLs, directory handles, or a
          process&apos;s working directory. If you expect a result and get
          none, drop <code>handle.exe</code> / <code>handle64.exe</code> into
          the app&apos;s <code>resources/</code> folder (or anywhere on PATH)
          for full coverage.
        </div>
      )}

      {error && <div className="banner">{error}</div>}

      <div className="content">
        {rows.length === 0 && !loading ? (
          <div className="empty">
            {!folder ? (
              isWin
                ? 'Pick a folder, paste a path, or drag a folder onto this panel to scan.'
                : 'Pick a folder to scan.'
            ) : lastMeta && !lastMeta.folderExists ? (
              <>
                <div>Folder does not exist or is not a directory:</div>
                <div className="mono" style={{ marginTop: 6 }}>{folder}</div>
              </>
            ) : lastMeta && lastMeta.backend === 'restart-manager' ? (
              <>
                <div>
                  Scanned{' '}
                  <strong>{lastMeta.scannedFileCount ?? 0}</strong> file(s) via
                  RestartManager — no user-mode lock found.
                </div>
                <div style={{ marginTop: 8, opacity: 0.75 }}>
                  This does <strong>not</strong> mean nothing has the folder
                  open: RM can&apos;t see read-only handles, mmap&apos;d DLLs,
                  or processes whose <em>cwd</em> is this folder. Install{' '}
                  <code>handle.exe</code> for full visibility.
                </div>
              </>
            ) : lastMeta && lastMeta.backend === 'handle.exe' ? (
              <>No process is holding any handle inside this folder.</>
            ) : (
              'No locking processes found (or scan not run yet).'
            )}
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

      {isDragOver && isWin && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <div className="drop-overlay-title">Drop to scan</div>
            <div className="drop-overlay-sub">
              Folder → scanned directly · File → its parent folder is scanned
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------- Processes Tab ----------------

type ProcSortKey =
  | 'pid'
  | 'name'
  | 'user'
  | 'cpuPercent'
  | 'rssBytes'
  | 'privateBytes'
  | 'virtualBytes'
  | 'uptimeSeconds'
  | 'threadCount';

type RefreshInterval = 'off' | '5s' | '10s' | '30s';
const REFRESH_MS: Record<RefreshInterval, number> = {
  off: 0,
  '5s': 5000,
  '10s': 10000,
  '30s': 30000
};

/**
 * Processes tab. Three independent surface areas, all wired off one
 * pure-function `listProcesses()` call returned from the main process:
 *
 *   1. A sortable, filterable table.
 *   2. A regex match field that highlights matching rows live but does
 *      not commit a kill until the user explicitly opts in.
 *   3. A "Selection panel" that opens when the user clicks the floating
 *      "Use as selection" action. Inside the panel every matched row is
 *      pre-checked; the user can uncheck false positives and then hit
 *      "Kill Selected" for one confirm + one IPC.
 *
 * Design notes:
 *  - The regex is evaluated in the renderer (never sent to main). We
 *    swallow parse errors and show an inline "invalid regex" hint so the
 *    user can keep typing without the table going blank.
 *  - PIDs 0 (System Idle) / 4 (Windows kernel) and the current Electron
 *    pid are filtered out of kill candidates server-side by killer.ts,
 *    but we also dim them in the panel and pre-uncheck them so the count
 *    is honest.
 */
const ProcessesView: React.FC = () => {
  const [rows, setRows] = useState<ProcessEntry[]>([]);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [backend, setBackend] = useState<string>('');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [regexText, setRegexText] = useState('');
  const [sort, setSort] = useState<{ key: ProcSortKey; asc: boolean }>({
    key: 'rssBytes',
    asc: false
  });
  const [interval, setIntervalKey] = useState<RefreshInterval>('off');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelChecked, setPanelChecked] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.closedport.listProcesses();
      setRows(res.entries);
      setCapturedAt(res.capturedAt);
      setBackend(res.backend);
      setWarning(res.warning || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh when the user picks an interval. We deliberately use a
  // chained setTimeout instead of setInterval so a slow listProcesses()
  // call (Windows can spike to ~800ms under load) doesn't stack queued
  // refreshes.
  useEffect(() => {
    const ms = REFRESH_MS[interval];
    if (ms === 0) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      await refresh();
      if (cancelled) return;
      t = setTimeout(tick, ms);
    };
    t = setTimeout(tick, ms);
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [interval, refresh]);

  // Compile the regex once per keystroke. Empty input means "no
  // highlight". Invalid input is flagged but doesn't blow up the view.
  const { regex, regexInvalid } = useMemo(() => {
    const s = regexText.trim();
    if (!s) return { regex: null as RegExp | null, regexInvalid: false };
    try {
      return { regex: new RegExp(s, 'i'), regexInvalid: false };
    } catch {
      return { regex: null as RegExp | null, regexInvalid: true };
    }
  }, [regexText]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(
        (r) =>
          String(r.pid).includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.user || '').toLowerCase().includes(q) ||
          (r.path || '').toLowerCase().includes(q)
      );
    }
    const { key, asc } = sort;
    list = [...list].sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[key];
      const vb = (b as unknown as Record<string, unknown>)[key];
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

  const matchedPids = useMemo(() => {
    if (!regex) return new Set<number>();
    const out = new Set<number>();
    for (const r of filtered) {
      // Match against name + path + command line, since users routinely
      // hunt for things like "node.*vite" that span name + args.
      const hay = `${r.name} ${r.path || ''} ${r.commandLine || ''}`;
      if (regex.test(hay)) out.add(r.pid);
    }
    return out;
  }, [filtered, regex]);

  const toggleSort = (key: ProcSortKey) => {
    setSort((prev) =>
      // Numeric columns default to descending (largest-first) on first
      // click — that's what the user wants 99% of the time.
      prev.key === key
        ? { key, asc: !prev.asc }
        : {
            key,
            asc: !(
              key === 'cpuPercent' ||
              key === 'rssBytes' ||
              key === 'privateBytes' ||
              key === 'virtualBytes' ||
              key === 'uptimeSeconds' ||
              key === 'threadCount'
            )
          }
    );
  };

  const openPanel = () => {
    if (matchedPids.size === 0) return;
    // Pre-check everything that matched the regex. The user uses the
    // panel to remove false positives, not to add things.
    setPanelChecked(new Set(matchedPids));
    setPanelOpen(true);
  };

  const togglePanelPid = (pid: number) => {
    setPanelChecked((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const killOne = async (pid: number) => {
    if (!confirm(`Kill PID ${pid}?`)) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) alert(`Failed to kill ${pid}: ${res.message}`);
    await refresh();
  };

  const killChecked = async () => {
    const pids = Array.from(panelChecked);
    if (pids.length === 0) return;
    if (!confirm(`Kill ${pids.length} process(es)?\n\nThis cannot be undone.`))
      return;
    const results = await window.closedport.killProcesses(pids, true);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      alert(
        `Failed:\n${failed
          .slice(0, 10)
          .map((f) => `${f.pid}: ${f.message}`)
          .join('\n')}${failed.length > 10 ? `\n(+${failed.length - 10} more)` : ''}`
      );
    }
    setPanelOpen(false);
    setPanelChecked(new Set());
    await refresh();
  };

  // Pre-resolved arrays for the panel — same order as the visible
  // (filtered) table so the user's mental model is preserved when they
  // look from one to the other.
  const panelRows = useMemo(
    () => filtered.filter((r) => matchedPids.has(r.pid)),
    [filtered, matchedPids]
  );

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by pid, name, user, path..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <input
          type="text"
          placeholder="Regex: chrome.*helper, ^node$, vite|webpack..."
          value={regexText}
          onChange={(e) => setRegexText(e.target.value)}
          className={`proc-regex${regexInvalid ? ' invalid' : ''}`}
          title={
            regexInvalid
              ? 'Invalid regex'
              : 'Matching rows are highlighted. Click "Use as selection" to open the kill panel.'
          }
          style={{ maxWidth: 320 }}
        />
        <button onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <select
          value={interval}
          onChange={(e) => setIntervalKey(e.target.value as RefreshInterval)}
          title="Auto-refresh interval"
        >
          <option value="off">Auto: Off</option>
          <option value="5s">Auto: 5s</option>
          <option value="10s">Auto: 10s</option>
          <option value="30s">Auto: 30s</option>
        </select>
        <button
          className="danger"
          onClick={openPanel}
          disabled={matchedPids.size === 0}
          title="Open a kill panel with every matched row pre-checked. You can uncheck false positives before confirming."
        >
          Use as selection ({matchedPids.size})
        </button>
        <div className="spacer" />
        <span className="badge">{filtered.length} processes</span>
        {backend && <span className="badge" title="Backend">{backend}</span>}
        {capturedAt && (
          <span className="badge" title={new Date(capturedAt).toISOString()}>
            {new Date(capturedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {warning && <div className="banner">{warning}</div>}
      {error && <div className="banner">{error}</div>}

      <div className="content">
        {filtered.length === 0 && !loading ? (
          <div className="empty">No processes found.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('pid')}>PID</th>
                <th onClick={() => toggleSort('name')}>Name</th>
                <th onClick={() => toggleSort('user')}>User</th>
                <th
                  onClick={() => toggleSort('cpuPercent')}
                  title="Average CPU% since the process started (single-core scale; >100% means multi-core load)."
                >
                  CPU%
                </th>
                <th
                  onClick={() => toggleSort('rssBytes')}
                  title="Resident / Working Set. Physical RAM the process is currently using."
                >
                  RSS
                </th>
                <th
                  onClick={() => toggleSort('privateBytes')}
                  title="Private bytes. Memory privately committed by this process (Win) or RSS (Unix)."
                >
                  Private
                </th>
                <th
                  onClick={() => toggleSort('virtualBytes')}
                  title="Virtual address space size. Usually much larger than RSS."
                >
                  Virtual
                </th>
                <th
                  onClick={() => toggleSort('threadCount')}
                  title="Number of threads."
                >
                  Thr
                </th>
                <th onClick={() => toggleSort('uptimeSeconds')}>Uptime</th>
                <th style={{ width: 100 }}>Path</th>
                <th style={{ width: 80 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isMatch = matchedPids.has(r.pid);
                return (
                  <tr
                    key={r.pid}
                    className={isMatch ? 'proc-match' : undefined}
                  >
                    <td className="mono">{r.pid}</td>
                    <td title={r.commandLine || r.name}>{r.name}</td>
                    <td>{r.user || '—'}</td>
                    <td className="mono">{r.cpuPercent.toFixed(1)}</td>
                    <td className="mono" title={`${r.rssBytes} bytes`}>
                      {formatBytes(r.rssBytes)}
                    </td>
                    <td className="mono" title={`${r.privateBytes} bytes`}>
                      {formatBytes(r.privateBytes)}
                    </td>
                    <td className="mono" title={`${r.virtualBytes} bytes`}>
                      {formatBytes(r.virtualBytes)}
                    </td>
                    <td className="mono">
                      {r.threadCount >= 0 ? r.threadCount : '—'}
                    </td>
                    <td className="mono">
                      {r.uptimeSeconds >= 0 ? formatDuration(r.uptimeSeconds) : '—'}
                    </td>
                    <td className="mono" title={r.path}>
                      {r.path ? truncatePath(r.path) : '—'}
                    </td>
                    <td>
                      <button className="danger" onClick={() => killOne(r.pid)}>
                        Kill
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {panelOpen && (
        <div className="proc-panel-backdrop" onClick={() => setPanelOpen(false)}>
          <div
            className="proc-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="proc-panel-header">
              <div className="proc-panel-title">
                Confirm kill — {panelChecked.size} of {panelRows.length} selected
              </div>
              <button
                className="ghost"
                onClick={() => setPanelOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="proc-panel-toolbar">
              <span className="badge">Regex: {regexText}</span>
              <button
                className="ghost"
                onClick={() =>
                  setPanelChecked(new Set(panelRows.map((r) => r.pid)))
                }
              >
                Check all
              </button>
              <button
                className="ghost"
                onClick={() => setPanelChecked(new Set())}
              >
                Uncheck all
              </button>
              <div className="spacer" />
              <button
                className="danger"
                disabled={panelChecked.size === 0}
                onClick={killChecked}
              >
                Kill Selected ({panelChecked.size})
              </button>
            </div>
            <div className="proc-panel-body">
              <table className="table compact">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th>PID</th>
                    <th>Name</th>
                    <th>User</th>
                    <th>CPU%</th>
                    <th>RSS</th>
                    <th>Path</th>
                  </tr>
                </thead>
                <tbody>
                  {panelRows.map((r) => (
                    <tr
                      key={r.pid}
                      className={
                        panelChecked.has(r.pid) ? 'selected' : undefined
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={panelChecked.has(r.pid)}
                          onChange={() => togglePanelPid(r.pid)}
                        />
                      </td>
                      <td className="mono">{r.pid}</td>
                      <td title={r.commandLine || r.name}>{r.name}</td>
                      <td>{r.user || '—'}</td>
                      <td className="mono">{r.cpuPercent.toFixed(1)}</td>
                      <td className="mono">{formatBytes(r.rssBytes)}</td>
                      <td className="mono" title={r.path}>
                        {r.path ? truncatePath(r.path) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function truncatePath(p: string): string {
  if (p.length <= 48) return p;
  return `…${p.slice(p.length - 47)}`;
}

export default App;
