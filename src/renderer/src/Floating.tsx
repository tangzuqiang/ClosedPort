import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import type { PortEntry } from '../../shared/types';

const FloatingPanel: React.FC = () => {
  const [rows, setRows] = useState<PortEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Track mount state + in-flight listPorts so 5s auto-refresh ticks that
  // arrive while a slow query is still running don't pile up (Windows on
  // low-end machines can take >5s for the netstat + tasklist + powershell
  // pipeline). Also guards against StrictMode's mount/unmount/mount cycle
  // calling setState after unmount.
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const data = await window.closedport.listPorts();
      if (mountedRef.current) setRows(data);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    // Use a self-rescheduling timer instead of setInterval so we always
    // wait for the previous refresh to settle before queuing the next.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 5000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoRefresh, refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(
        (r) =>
          String(r.localPort).includes(q) ||
          (r.processName || '').toLowerCase().includes(q) ||
          String(r.pid).includes(q)
      );
    }
    return [...list].sort((a, b) => a.localPort - b.localPort);
  }, [rows, filter]);

  const killOne = async (pid: number) => {
    if (!confirm(`Kill PID ${pid}?`)) return;
    const res = await window.closedport.killProcess(pid, true);
    if (!res.success) alert(`Failed: ${res.message}`);
    await refresh();
  };

  return (
    <div className="floating" role="region" aria-label="ClosedPort floating panel">
      <div className="floating-header">
        ClosedPort
        <div className="actions">
          <button
            className="ghost"
            title="Auto refresh (5s)"
            aria-pressed={autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {autoRefresh ? 'Pause' : 'Resume'}
          </button>
          <button
            className="ghost"
            onClick={refresh}
            title="Refresh"
            aria-busy={loading}
            disabled={loading}
          >
            {loading ? '…' : 'Refresh'}
          </button>
          <button
            className="ghost"
            onClick={() => window.closedport.toggleFloating()}
            title="Hide"
          >
            Hide
          </button>
        </div>
      </div>
      <div className="floating-search">
        <input
          type="search"
          placeholder="port / pid / name"
          aria-label="Filter ports"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="floating-list" role="list">
        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            {loading ? 'Loading...' : 'No matches'}
          </div>
        ) : (
          filtered.map((r) => (
            <div
              className="floating-item"
              role="listitem"
              key={`${r.protocol}-${r.localAddress}-${r.localPort}-${r.pid}`}
            >
              <div className="info">
                <div className="top">
                  <span className="badge">{r.protocol}</span>
                  <span className="name">:{r.localPort}</span>
                </div>
                <div className="sub" title={r.processPath}>
                  {r.processName || '—'} · pid {r.pid}
                  {r.parentName ? ` · by ${r.parentName}` : ''}
                </div>
              </div>
              <button
                className="danger"
                onClick={() => killOne(r.pid)}
                aria-label={`Kill ${r.processName || 'process'} pid ${r.pid} on port ${r.localPort}`}
              >
                Kill
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FloatingPanel />
  </React.StrictMode>
);
