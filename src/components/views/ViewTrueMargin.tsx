'use client';
import { Fragment, useState, useMemo } from 'react';
import { DollarSign, CheckCircle2, ChevronDown, ChevronRight, Box, Users, Scissors } from 'lucide-react';

type PipelineFilter = 'ALL' | 'PATH_A' | 'PATH_B';

interface OrderItem {
  id: string;
  client: string;
  path: 'PATH_A' | 'PATH_B';
  revenue: number;
  cogs_materials: number;
  cogs_labor: number;
  overhead: number;
  status: string;
}

const mockOrders: OrderItem[] = [
  { id: 'PRJ-8012', client: 'Aero Resorts', path: 'PATH_B', revenue: 125000, cogs_materials: 45000, cogs_labor: 37000, overhead: 12000, status: 'Synced' },
  { id: 'PRJ-8013', client: 'Retail Online 1', path: 'PATH_A', revenue: 4500, cogs_materials: 1200, cogs_labor: 900, overhead: 0, status: 'Synced' },
  { id: 'PRJ-8014', client: 'Smith Estate', path: 'PATH_B', revenue: 38000, cogs_materials: 14000, cogs_labor: 10500, overhead: 4500, status: 'Synced' },
  { id: 'PRJ-8015', client: 'Retail Online 2', path: 'PATH_A', revenue: 12000, cogs_materials: 3500, cogs_labor: 2100, overhead: 0, status: 'Synced' },
  { id: 'PRJ-8016', client: 'Oasis Lounge', path: 'PATH_B', revenue: 95000, cogs_materials: 35000, cogs_labor: 28000, overhead: 8500, status: 'Pending' },
  { id: 'PRJ-8017', client: 'Retail Online 3', path: 'PATH_A', revenue: 8500, cogs_materials: 2200, cogs_labor: 1800, overhead: 0, status: 'Synced' },
  { id: 'PRJ-8018', client: 'Retail Online 4', path: 'PATH_A', revenue: 6200, cogs_materials: 1800, cogs_labor: 1100, overhead: 0, status: 'Synced' },
  { id: 'PRJ-8019', client: 'Villa Blanca', path: 'PATH_B', revenue: 185000, cogs_materials: 68000, cogs_labor: 45000, overhead: 15000, status: 'Synced' },
];

export function ViewTrueMargin() {
  const [filter, setFilter] = useState<PipelineFilter>('ALL');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const filteredOrders = useMemo(() => {
    if (filter === 'ALL') return mockOrders;
    return mockOrders.filter(o => o.path === filter);
  }, [filter]);

  const stats = useMemo(() => {
    let gross = 0;
    let totalCogs = 0;
    let totalOverhead = 0;
    
    filteredOrders.forEach(o => {
      gross += o.revenue;
      totalCogs += (o.cogs_materials + o.cogs_labor);
      totalOverhead += o.overhead;
    });

    const netProfit = gross - totalCogs - totalOverhead;
    const netMargin = gross > 0 ? (netProfit / gross) * 100 : 0;

    return { gross, totalCogs, netProfit, netMargin, count: filteredOrders.length };
  }, [filteredOrders]);

  const toggleRow = (id: string) => {
    setExpandedRow(prev => prev === id ? null : id);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 w-full h-full overflow-y-auto bg-slate-950 font-sans">
      <div className="border-b border-slate-800 pb-6 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black text-slate-100 flex items-center gap-2">
            <DollarSign className="text-sky-400" />
            True Margin Ledger
          </h2>
          <p className="text-xs font-mono text-slate-400 mt-1 uppercase">Live QBO Integration Diagnostics</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFilter('ALL')} className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${filter === 'ALL' ? 'bg-sky-500 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}>All Orders</button>
          <button onClick={() => setFilter('PATH_A')} className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${filter === 'PATH_A' ? 'bg-indigo-500 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}>Path A (Parametric)</button>
          <button onClick={() => setFilter('PATH_B')} className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${filter === 'PATH_B' ? 'bg-fuchsia-500 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}>Path B (Bespoke)</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <p className="text-[10px] text-slate-400 font-mono uppercase mb-1 tracking-wider">Gross Revenue</p>
          <div className="text-2xl font-black text-slate-100">${stats.gross.toLocaleString()}</div>
          <div className="text-[10px] text-emerald-400 font-bold mt-1 uppercase">{stats.count} Projects</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <p className="text-[10px] text-slate-400 font-mono uppercase mb-1 tracking-wider">Total COGS (Mat+Lab)</p>
          <div className="text-2xl font-black text-rose-400">${stats.totalCogs.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500 font-bold mt-1 uppercase">Sourced from Katana MRP</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-lg">
          <p className="text-[10px] text-slate-400 font-mono uppercase mb-1 tracking-wider">Net Profit</p>
          <div className="text-2xl font-black text-emerald-400">${stats.netProfit.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500 font-bold mt-1 uppercase">After Overhead Deductions</div>
        </div>
        <div className="bg-slate-900 border border-sky-500/30 p-5 rounded-xl shadow-[0_0_20px_rgba(14,165,233,0.1)] relative overflow-hidden flex flex-col justify-center">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-sky-500/10 rounded-full blur-2xl"></div>
          <p className="text-[10px] text-sky-400 font-mono uppercase mb-1 tracking-wider font-bold">Average Net Margin</p>
          <div className="text-3xl font-black text-sky-100">{stats.netMargin.toFixed(1)}%</div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-2xl mt-8">
        <div className="p-4 bg-slate-950/80 border-b border-slate-800">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide">Financial Ledger Detail</h3>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/40 border-b border-slate-800/60 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              <th className="py-3 px-4 w-10"></th>
              <th className="py-3 px-4 font-bold">Project ID</th>
              <th className="py-3 px-4 font-bold">Client</th>
              <th className="py-3 px-4 font-bold">Pipeline Path</th>
              <th className="py-3 px-4 font-bold text-right">Revenue</th>
              <th className="py-3 px-4 font-bold text-right">Net Profit</th>
              <th className="py-3 px-4 font-bold text-right">Margin %</th>
              <th className="py-3 px-4 font-bold text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40 text-xs font-medium">
            {filteredOrders.map((item) => {
              const itemProfit = item.revenue - item.cogs_materials - item.cogs_labor - item.overhead;
              const itemMargin = ((itemProfit / item.revenue) * 100).toFixed(1);
              const isExpanded = expandedRow === item.id;

              return (
                <Fragment key={item.id}>
                  <tr 
                    onClick={() => toggleRow(item.id)}
                    className="hover:bg-slate-800/50 transition-colors text-slate-300 cursor-pointer group"
                  >
                    <td className="py-4 px-4 text-slate-500 group-hover:text-sky-400 transition-colors">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="py-4 px-4 font-mono text-sky-400">{item.id}</td>
                    <td className="py-4 px-4 font-bold text-slate-200">{item.client}</td>
                    <td className="py-4 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] border ${item.path === 'PATH_A' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300'}`}>
                        {item.path === 'PATH_A' ? 'Parametric' : 'Bespoke'}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">${item.revenue.toLocaleString()}</td>
                    <td className="py-4 px-4 text-right text-emerald-400 font-bold">${itemProfit.toLocaleString()}</td>
                    <td className="py-4 px-4 text-right text-sky-300 font-bold">{itemMargin}%</td>
                    <td className="py-4 px-4">
                      <div className="flex justify-center">
                        {item.status === 'Synced' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border-2 border-slate-600 border-t-slate-400 animate-spin"></div>
                        )}
                      </div>
                    </td>
                  </tr>
                  
                  {isExpanded && (
                    <tr className="bg-slate-950 border-b border-slate-800">
                      <td colSpan={8} className="p-0">
                        <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6 border-l-2 border-sky-500 ml-4 my-4 bg-slate-900/50 rounded-r-lg">
                          <div>
                            <div className="flex items-center gap-2 text-slate-400 mb-2">
                              <Box className="w-4 h-4" />
                              <span className="text-[10px] font-mono uppercase tracking-wider">Materials COGS</span>
                            </div>
                            <div className="text-lg font-mono text-rose-300">${item.cogs_materials.toLocaleString()}</div>
                            <p className="text-[10px] text-slate-500 mt-1">Extrusions, Fabric, Hardware</p>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 text-slate-400 mb-2">
                              <Users className="w-4 h-4" />
                              <span className="text-[10px] font-mono uppercase tracking-wider">Labor COGS</span>
                            </div>
                            <div className="text-lg font-mono text-rose-300">${item.cogs_labor.toLocaleString()}</div>
                            <p className="text-[10px] text-slate-500 mt-1">Saw, Fab Cell, Upholstery</p>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 text-slate-400 mb-2">
                              <Scissors className="w-4 h-4" />
                              <span className="text-[10px] font-mono uppercase tracking-wider">GHL Overhead</span>
                            </div>
                            <div className="text-lg font-mono text-amber-300">${item.overhead.toLocaleString()}</div>
                            <p className="text-[10px] text-slate-500 mt-1">Design & Sales Commission</p>
                          </div>
                          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col justify-center">
                            <span className="text-[10px] font-mono text-slate-500 mb-1 uppercase">Katana MRP Link</span>
                            <a href="#" className="text-xs text-sky-400 hover:underline">View BOM / Traveler</a>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filteredOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 font-mono text-sm">No orders found for this pipeline.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ViewTrueMargin;
