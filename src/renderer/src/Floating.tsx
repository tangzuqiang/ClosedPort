import React, { useEffect, useMemo, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import type { PortEntry } from '../../shared/types';

const FloatingPanel: React.FC = () => {
  const [rows, setRows] = useState<PortEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.closedport.listPorts();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
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
    <div className="floating">
      <div className="floating-header">
        ClosedPort
        <div className="actions">
          <button
            className="ghost"
            title="Auto refresh (5s)"
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {autoRefresh ? 'Pause' : 'Resume'}
          </button>
          <button className="ghost" onClick={refresh} title="Refresh">
            Refresh
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
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="floating-list">
        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            {loading ? 'Loading...' : 'No matches'}
          </div>
        ) : (
          filtered.map((r) => (
            <div
              className="floating-item"
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
              <button className="danger" onClick={() => killOne(r.pid)}>
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
