'use client';
import { AlertTriangle, GitMerge, Server, GraduationCap, FileText, DollarSign, Terminal } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

const navItems = [
  { id: 0, label: 'Current Chaos', icon: AlertTriangle, badge: 'Diagnostic' },
  { id: 1, label: 'Dual-Pipeline Architecture', icon: GitMerge, badge: 'V11.0' },
  { id: 2, label: 'IT & Infrastructure Matrix', icon: Server, badge: 'Deployment' },
  { id: 3, label: 'Training & Cutover Gates', icon: GraduationCap, badge: 'Readiness' },
  { id: 4, label: 'Executive Operations Brief', icon: FileText, badge: 'SOP / Signoff' },
  { id: 5, label: 'True Margin Ledger', icon: DollarSign, badge: 'QBO Sync' },
  { id: 6, label: 'System Audit & DLQ', icon: Terminal, badge: 'Logs' },
];

export function Sidebar() {
  const activePhase = useAppStore((state) => state.activePhase);
  const setActivePhase = useAppStore((state) => state.setActivePhase);

  return (
    <aside className="w-72 bg-slate-950 border-r border-slate-800/80 flex flex-col justify-between p-6 shrink-0 select-none h-screen overflow-y-auto">
      <div>
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center font-black text-sky-400">CC</div>
          <div>
            <div className="font-extrabold text-sm tracking-tight text-slate-100 uppercase">CC Patio</div>
            <div className="text-[10px] font-mono tracking-wider text-slate-400 uppercase">Operations Hub V11.0</div>
          </div>
        </div>
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePhase === item.id;
            return (
              <button 
                key={item.id} 
                onClick={() => setActivePhase(item.id)} 
                className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${ isActive ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 shadow-[0_0_15px_rgba(14,165,233,0.15)]' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent' }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${ isActive ? 'bg-sky-400/20 text-sky-300 border border-sky-400/30' : 'bg-slate-900 text-slate-500' }`}>
                  {item.badge}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
      <div className="pt-6 border-t border-slate-800/80 mt-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-slate-400 uppercase">SYSTEM ARCHITECTURE</span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>ONLINE
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-300 font-medium truncate">Client: CCPATIO</div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
