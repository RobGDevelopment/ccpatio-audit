'use client';
import React, { useState, useMemo } from 'react';
import { GraduationCap, CheckCircle2, Circle, Lock, Unlock } from 'lucide-react';

type DeptCategory = 'ALL' | 'SALES' | 'CAD' | 'FACTORY' | 'LOGISTICS' | 'FINANCE';

interface TrainingGate {
  id: string;
  dept: DeptCategory;
  role: string;
  task: string;
  cleared: boolean;
}

const initialGates: TrainingGate[] = [
  { id: 'TRN-01', dept: 'SALES', role: 'Showroom Sales (In-Store Reps)', task: 'VividWorks 3D visualizer parametric configuration & staging checkout execution.', cleared: false },
  { id: 'TRN-02', dept: 'CAD', role: 'Architectural CAD (Paula / Alejandra)', task: 'SketchUp-to-Blender export pipeline, pivot coordinate validation, and .glTF packaging.', cleared: false },
  { id: 'TRN-03', dept: 'FACTORY', role: 'Factory Saw Station (Saw Operator)', task: 'Katana Shop Floor tablet login, barcode scanning, and 240" extrusion cut list execution.', cleared: false },
  { id: 'TRN-04', dept: 'FACTORY', role: 'Fabrication Cell (Fitter / Welder / Grinder)', task: '3-man cell traveler barcode scanning and synchronized group labor clocking.', cleared: false },
  { id: 'TRN-05', dept: 'FACTORY', role: 'As-Built Quality Control (Upholstery Manager)', task: 'Physical frame measurement, weld tolerance gate, and dynamic Katana BOM fabric adjustment.', cleared: false },
  { id: 'TRN-06', dept: 'LOGISTICS', role: 'Logistics & Delivery (Dispatch Manager)', task: 'QBO final payment clearance verification before unlocking delivery truck dispatch.', cleared: false },
  { id: 'TRN-07', dept: 'FINANCE', role: 'Executive / Finance (CFO / Owner)', task: 'QBO COGS reconciliation and True Margin dashboard audit sign-off.', cleared: false }
];

export function ViewTrainingGates() {
  const [gates, setGates] = useState<TrainingGate[]>(initialGates);
  const [activeTab, setActiveTab] = useState<DeptCategory>('ALL');

  const filteredGates = gates.filter(g => activeTab === 'ALL' || g.dept === activeTab);
  
  const clearedCount = gates.filter(g => g.cleared).length;
  const totalCount = gates.length;
  const progressPercentage = Math.round((clearedCount / totalCount) * 100);
  const isUnlocked = progressPercentage === 100;

  const toggleGate = (id: string) => {
    setGates(prev => prev.map(g => g.id === id ? { ...g, cleared: !g.cleared } : g));
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 w-full h-full overflow-y-auto bg-slate-950 font-sans">
      <div className="border-b border-slate-800 pb-6">
        <h2 className="text-2xl font-black text-slate-100 flex items-center gap-3">
          <GraduationCap className="text-fuchsia-400 w-8 h-8" />
          Departmental Training Matrix
        </h2>
        <p className="text-xs text-slate-400 mt-2 uppercase tracking-widest">Workforce Clearance & Cutover Readiness</p>
      </div>

      {/* Production Cutover Lock Banner */}
      <div className={`p-6 rounded-xl border flex flex-col md:flex-row items-center justify-between transition-all duration-500 shadow-xl ${
        isUnlocked 
          ? 'bg-emerald-950/20 border-emerald-500/50 shadow-emerald-500/10' 
          : 'bg-rose-950/20 border-rose-500/50 shadow-rose-500/10'
      }`}>
        <div className="flex items-center gap-4 mb-4 md:mb-0">
          <div className={`p-4 rounded-full ${isUnlocked ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
            {isUnlocked ? <Unlock className="w-8 h-8 text-emerald-400" /> : <Lock className="w-8 h-8 text-rose-400" />}
          </div>
          <div>
            <h3 className={`text-xl font-black tracking-tight ${isUnlocked ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isUnlocked ? 'SYSTEM UNLOCKED' : 'SYSTEM LOCKED'}
            </h3>
            <p className="text-sm text-slate-400">
              {isUnlocked ? 'All departments are cleared for production cutover.' : 'Production cutover is locked until 100% of departments are cleared.'}
            </p>
          </div>
        </div>
        
        <div className="w-full md:w-64">
          <div className="flex justify-between text-xs font-mono mb-2">
            <span className={isUnlocked ? 'text-emerald-400' : 'text-rose-400'}>READINESS</span>
            <span className={isUnlocked ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{progressPercentage}%</span>
          </div>
          <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div 
              className={`h-full transition-all duration-1000 ease-out ${isUnlocked ? 'bg-emerald-500' : 'bg-rose-500'}`}
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 my-6 border-b border-slate-800 pb-4 overflow-x-auto">
        {(['ALL', 'SALES', 'CAD', 'FACTORY', 'LOGISTICS', 'FINANCE'] as DeptCategory[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === tab 
                ? 'bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20' 
                : 'bg-slate-900/50 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredGates.map((gate) => (
          <div 
            key={gate.id} 
            onClick={() => toggleGate(gate.id)}
            className={`p-5 rounded-xl border flex gap-4 cursor-pointer transition-all duration-200 group ${
              gate.cleared 
                ? 'bg-emerald-950/10 border-emerald-900/40 hover:bg-emerald-950/20' 
                : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/80'
            }`}
          >
            <div className="pt-1 shrink-0">
              {gate.cleared ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              ) : (
                <Circle className="w-6 h-6 text-slate-600 group-hover:text-fuchsia-400 transition-colors" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                  {gate.dept}
                </span>
                <span className="text-[10px] font-mono text-slate-500">{gate.id}</span>
              </div>
              <h4 className={`text-sm font-bold mb-1 ${gate.cleared ? 'text-emerald-100' : 'text-slate-200'}`}>
                {gate.role}
              </h4>
              <p className={`text-xs ${gate.cleared ? 'text-emerald-400/70' : 'text-slate-400'}`}>
                {gate.task}
              </p>
            </div>
          </div>
        ))}
        {filteredGates.length === 0 && (
          <div className="col-span-1 md:col-span-2 text-center py-12 text-slate-500 font-mono text-sm">No departments found for this filter.</div>
        )}
      </div>
    </div>
  );
}

export default ViewTrainingGates;
