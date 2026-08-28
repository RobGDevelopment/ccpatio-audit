'use client';
import { useState } from 'react';
import { Terminal, ShieldAlert, CheckCircle, DatabaseZap, Search, RotateCw } from 'lucide-react';

type LogLevel = 'ALL' | 'CRITICAL' | 'WARNING' | 'SUCCESS';

interface SystemLog {
  id: string;
  time: string;
  system: string;
  level: LogLevel;
  message: string;
  data: string;
  resolved?: boolean;
}

const initialLogs: SystemLog[] = [
  { id: 'LOG-008', time: '14:52:10', system: 'KATANA_SYNC', level: 'SUCCESS', message: 'MO-1029: Cut List successfully nested. Drops re-allocated.', data: '{\n  "yield": 91.2,\n  "usableRemnants": [48, 62],\n  "scrap": 12\n}' },
  { id: 'LOG-007', time: '14:50:00', system: 'CX_ENGINE', level: 'CRITICAL', message: 'DLQ TRAP: SMS delivery failed (timeout).', data: '{\n  "error": "Upstream timeout at api.gohighlevel.com",\n  "status": 504\n}', resolved: false },
  { id: 'LOG-006', time: '14:48:33', system: 'QBO_QUEUE', level: 'WARNING', message: 'Rate limit approaching (450/500). Scaling backoff.', data: '{\n  "currentDelayMs": 3000,\n  "batchSize": 40\n}' },
  { id: 'LOG-005', time: '14:42:10', system: 'KATANA_WEBHOOK', level: 'SUCCESS', message: 'MO-1025 marked IN_PROGRESS (Powder Coating).', data: '{ "station": "Powder Coating" }' },
  { id: 'LOG-004', time: '14:41:05', system: 'GHL_INGEST', level: 'CRITICAL', message: 'DLQ TRAP: Invalid payload schema.', data: '{\n  "error": "Missing field: sketchupCutList",\n  "status": 422\n}', resolved: false },
  { id: 'LOG-003', time: '14:35:12', system: 'QBO_QUEUE', level: 'SUCCESS', message: 'Batch 40 items synced to QuickBooks.', data: '{\n  "status": "ACCEPTED",\n  "processingTimeMs": 1450\n}' },
  { id: 'LOG-002', time: '14:32:01', system: 'KATANA_SYNC', level: 'SUCCESS', message: 'MO-1024 Cut List generated & nested.', data: '{ "yield": 88.4, "scrap": 2 }' },
  { id: 'LOG-001', time: '14:30:00', system: 'SYSTEM', level: 'SUCCESS', message: 'Architecture V11.0 Initialized.', data: '{\n  "mode": "production",\n  "version": "11.0.0"\n}' }
];

export function ViewAuditLogs() {
  const [logs, setLogs] = useState<SystemLog[]>(initialLogs);
  const [filterLevel, setFilterLevel] = useState<LogLevel>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const filteredLogs = logs.filter(log => {
    const matchesLevel = filterLevel === 'ALL' || log.level === filterLevel;
    const matchesSearch = log.message.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          log.system.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          log.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  const handleReprocess = (id: string) => {
    setProcessingId(id);
    // Simulate re-processing delay
    setTimeout(() => {
      setLogs(prev => prev.map(log => 
        log.id === id 
          ? { ...log, level: 'SUCCESS', resolved: true, message: `[RESOLVED] ${log.message}` } 
          : log
      ));
      setProcessingId(null);
    }, 1500);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 w-full h-full overflow-y-auto bg-black font-mono">
      <div className="border-b border-green-900/50 pb-6 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black text-green-500 flex items-center gap-3">
            <Terminal className="text-green-400 w-8 h-8" />
            System Audit & DLQ Terminal
          </h2>
          <p className="text-xs text-green-700 mt-1 uppercase tracking-widest">Authorized Access Only // Root Admin</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-green-500 bg-green-950/30 px-3 py-1.5 rounded-sm border border-green-900/50 shadow-[0_0_10px_rgba(34,197,94,0.1)]">
          <DatabaseZap className="w-4 h-4 animate-pulse" />
          <span>LISTENING</span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-green-950/10 p-4 rounded-md border border-green-900/30">
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          {(['ALL', 'CRITICAL', 'WARNING', 'SUCCESS'] as LogLevel[]).map(level => (
            <button
              key={level}
              onClick={() => setFilterLevel(level)}
              className={`px-3 py-1.5 rounded-sm text-[10px] font-bold transition-colors whitespace-nowrap border ${
                filterLevel === level
                  ? 'bg-green-500/20 border-green-500/50 text-green-400'
                  : 'bg-transparent border-green-900/50 text-green-700 hover:bg-green-950/50 hover:text-green-500'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-700" />
          <input 
            type="text" 
            placeholder="Search logs..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-black border border-green-900/50 rounded-sm py-1.5 pl-9 pr-3 text-xs text-green-500 outline-none transition-colors"
          />
        </div>
      </div>

      <div className="space-y-4 pt-4">
        {filteredLogs.map((log) => (
          <div key={log.id} className={`border p-4 rounded-md transition-colors ${
            log.level === 'CRITICAL' && !log.resolved ? 'border-red-900/50 bg-red-950/10' : 
            log.level === 'WARNING' ? 'border-amber-900/50 bg-amber-950/10' : 
            'border-green-900/30 bg-green-950/10'
          }`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-3 border-b border-green-900/30 pb-2 gap-2">
              <div className="flex items-center gap-3">
                <span className="text-green-700 text-xs shrink-0">[{log.time}]</span>
                <span className="text-green-400 font-bold text-sm tracking-wider">{log.system}</span>
                {log.level === 'SUCCESS' && (
                  <span className="flex items-center gap-1 text-emerald-500 text-[10px] bg-emerald-950/50 px-2 py-0.5 rounded-sm">
                    <CheckCircle className="w-3 h-3" /> OK
                  </span>
                )}
                {log.level === 'WARNING' && (
                  <span className="flex items-center gap-1 text-amber-500 text-[10px] bg-amber-950/50 px-2 py-0.5 rounded-sm">
                    <ShieldAlert className="w-3 h-3" /> WARN
                  </span>
                )}
                {log.level === 'CRITICAL' && !log.resolved && (
                  <span className="flex items-center gap-1 text-red-500 text-[10px] bg-red-950/50 px-2 py-0.5 rounded-sm">
                    <ShieldAlert className="w-3 h-3" /> DLQ TRAP
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                {log.level === 'CRITICAL' && !log.resolved && (
                  <button 
                    onClick={() => handleReprocess(log.id)}
                    disabled={processingId === log.id}
                    className="flex items-center gap-1 text-[10px] bg-red-900/30 hover:bg-red-900/50 text-red-400 px-2 py-1 rounded border border-red-900/50 transition-colors disabled:opacity-50"
                  >
                    <RotateCw className={`w-3 h-3 ${processingId === log.id ? 'animate-spin' : ''}`} />
                    {processingId === log.id ? 'PROCESSING...' : 'RE-PROCESS'}
                  </button>
                )}
                <span className="text-green-800 text-xs uppercase shrink-0">{log.id}</span>
              </div>
            </div>
            
            <p className={`text-sm mb-3 ${
              log.level === 'CRITICAL' && !log.resolved ? 'text-red-400' : 
              log.level === 'WARNING' ? 'text-amber-400' : 
              'text-green-300'
            }`}>
              &gt; {log.message}
            </p>
            
            <div className="bg-black/80 p-3 rounded text-[11px] text-green-600 border border-green-900/20 overflow-x-auto whitespace-pre">
              {log.data}
            </div>
          </div>
        ))}
        {filteredLogs.length === 0 && (
          <div className="text-center py-12 text-green-800 font-mono text-sm">No logs match the current filter/search.</div>
        )}
        <div className="animate-pulse text-green-700 text-sm py-4">_</div>
      </div>
    </div>
  );
}

export default ViewAuditLogs;
