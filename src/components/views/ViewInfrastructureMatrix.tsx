'use client';
import React, { useState, useMemo } from 'react';
import { Server, AlertTriangle, ShieldCheck, XCircle } from 'lucide-react';

type AuditCategory = 'ALL' | 'GOVERNANCE' | 'INFRASTRUCTURE' | 'DATABASE' | 'API';

interface MatrixItem {
  id: string;
  category: AuditCategory;
  name: string;
  description: string;
  status: 'PENDING' | 'ACTION_REQUIRED' | 'VERIFIED';
}

const initialMatrix: MatrixItem[] = [
  { id: 'GOV-1', category: 'GOVERNANCE', name: 'Domain & DNS Registrar Access', description: 'Root access to Cloudflare/Route53 for subdomains.', status: 'VERIFIED' },
  { id: 'GOV-2', category: 'GOVERNANCE', name: 'Master Super Admin Credentials', description: 'Katana, QBO, GHL, VividWorks global admin seats.', status: 'ACTION_REQUIRED' },
  { id: 'GOV-3', category: 'GOVERNANCE', name: 'IAM Role Delegation', description: 'Role-based access control configured for production.', status: 'PENDING' },
  { id: 'INF-1', category: 'INFRASTRUCTURE', name: 'Current Hosting Environment', description: 'Migration from Shared to Dedicated Cloud/VPS.', status: 'ACTION_REQUIRED' },
  { id: 'INF-2', category: 'INFRASTRUCTURE', name: 'Active PHP Engine', description: 'Upgrade from PHP 7.4 to PHP 8.3+.', status: 'ACTION_REQUIRED' },
  { id: 'INF-3', category: 'INFRASTRUCTURE', name: '1:1 Isolated Staging Environment', description: 'Provisioning of staging.ccpatio.com.', status: 'VERIFIED' },
  { id: 'DB-1', category: 'DATABASE', name: 'WooCommerce HPOS', description: 'High-Performance Order Storage (HPOS) active.', status: 'PENDING' },
  { id: 'DB-2', category: 'DATABASE', name: 'Object Caching Layer', description: 'Redis or Memcached implementation.', status: 'ACTION_REQUIRED' },
  { id: 'API-1', category: 'API', name: 'Web Application Firewall (WAF)', description: 'REST API Gateway protection and rate limiting.', status: 'PENDING' },
  { id: 'API-2', category: 'API', name: 'SSL / HSTS Strict Transport', description: 'Strict Transport Security (HSTS) headers enforced.', status: 'VERIFIED' }
];

export function ViewInfrastructureMatrix() {
  const [matrix, setMatrix] = useState<MatrixItem[]>(initialMatrix);
  const [activeTab, setActiveTab] = useState<AuditCategory>('ALL');

  const filteredMatrix = matrix.filter(item => activeTab === 'ALL' || item.category === activeTab);

  const stats = useMemo(() => ({
    criticalStops: matrix.filter(i => i.status === 'ACTION_REQUIRED').length,
    verified: matrix.filter(i => i.status === 'VERIFIED').length,
    pending: matrix.filter(i => i.status === 'PENDING').length
  }), [matrix]);

  const updateStatus = (id: string, newStatus: MatrixItem['status']) => {
    setMatrix(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 w-full h-full overflow-y-auto bg-slate-950 font-sans">
      <div className="border-b border-slate-800 pb-6">
        <h2 className="text-2xl font-black text-slate-100 flex items-center gap-3">
          <Server className="text-indigo-400 w-8 h-8" />
          IT & Infrastructure Matrix
        </h2>
        <p className="text-xs text-slate-400 mt-2 uppercase tracking-widest">Full-Scope 10-Point Technical Audit</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-red-950/20 border border-red-900/50 p-6 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-red-900/30 rounded-lg"><AlertTriangle className="text-red-500 w-6 h-6" /></div>
          <div>
            <div className="text-3xl font-black text-red-500">{stats.criticalStops}</div>
            <div className="text-xs text-red-400 font-mono uppercase tracking-wider">Critical Stops</div>
          </div>
        </div>
        <div className="bg-amber-950/20 border border-amber-900/50 p-6 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-amber-900/30 rounded-lg"><XCircle className="text-amber-500 w-6 h-6" /></div>
          <div>
            <div className="text-3xl font-black text-amber-500">{stats.pending}</div>
            <div className="text-xs text-amber-400 font-mono uppercase tracking-wider">Pending Config</div>
          </div>
        </div>
        <div className="bg-emerald-950/20 border border-emerald-900/50 p-6 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-emerald-900/30 rounded-lg"><ShieldCheck className="text-emerald-500 w-6 h-6" /></div>
          <div>
            <div className="text-3xl font-black text-emerald-500">{stats.verified}</div>
            <div className="text-xs text-emerald-400 font-mono uppercase tracking-wider">Systems Verified</div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b border-slate-800 pb-4 overflow-x-auto">
        {(['ALL', 'GOVERNANCE', 'INFRASTRUCTURE', 'DATABASE', 'API'] as AuditCategory[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              activeTab === tab 
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                : 'bg-slate-900/50 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filteredMatrix.map((item) => (
          <div key={item.id} className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-xl flex items-center justify-between group hover:bg-slate-800/50 transition-colors">
            <div className="flex-1 pr-8">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                  {item.category}
                </span>
                <span className="text-[10px] font-mono text-slate-500">{item.id}</span>
              </div>
              <h3 className="text-base font-bold text-slate-200 mb-1">{item.name}</h3>
              <p className="text-xs text-slate-400">{item.description}</p>
            </div>
            
            <div className="w-48 shrink-0">
              <select
                value={item.status}
                onChange={(e) => updateStatus(item.id, e.target.value as MatrixItem['status'])}
                className={`w-full text-xs font-bold rounded-lg px-3 py-2 border outline-none cursor-pointer transition-colors appearance-none text-center ${
                  item.status === 'VERIFIED' ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-400' :
                  item.status === 'ACTION_REQUIRED' ? 'bg-red-950/30 border-red-900/50 text-red-400' :
                  'bg-amber-950/30 border-amber-900/50 text-amber-400'
                }`}
              >
                <option value="VERIFIED">VERIFIED</option>
                <option value="ACTION_REQUIRED">ACTION REQUIRED</option>
                <option value="PENDING">PENDING</option>
              </select>
            </div>
          </div>
        ))}
        {filteredMatrix.length === 0 && (
          <div className="text-center py-12 text-slate-500 font-mono text-sm">No systems found for this category.</div>
        )}
      </div>
    </div>
  );
}

export default ViewInfrastructureMatrix;
