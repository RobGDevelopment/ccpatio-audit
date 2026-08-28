'use client';
import React, { useRef, useState } from 'react';
import { Download, CheckCircle2, FileText, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export function ViewExecutiveBrief() {
  const documentRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    if (!documentRef.current) return;
    setIsExporting(true);
    
    try {
      // Temporarily adjust styles for better PDF rendering if needed
      const canvas = await html2canvas(documentRef.current, {
        scale: 2,
        backgroundColor: '#050505',
        logging: false,
        useCORS: true
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });
      
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save('CCPatio_Executive_Brief.pdf');
    } catch (error) {
      console.error('PDF Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 w-full h-full overflow-y-auto">
      <div className="flex justify-between items-end border-b border-slate-800/80 pb-6">
        <div>
          <h2 className="text-2xl font-black text-slate-100">Executive Operations Brief</h2>
          <p className="text-xs font-mono text-slate-400 mt-1 uppercase">Standard Operating Procedure (SOP)</p>
        </div>
        <button 
          onClick={handleExportPDF}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {isExporting ? 'Generating...' : 'Export PDF'}
        </button>
      </div>

      {/* Document to Export */}
      <div 
        ref={documentRef} 
        className="bg-slate-900 border border-slate-800 p-10 rounded-xl shadow-2xl"
      >
        <div className="flex items-center gap-4 border-b border-slate-800 pb-6 mb-8">
          <div className="w-12 h-12 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center font-black text-sky-400 text-xl">
            CC
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-100 uppercase tracking-tight">System Architecture Signoff</h1>
            <p className="text-sm text-slate-400 font-mono mt-1">Document ID: V11-OPS-001 | Date: {new Date().toLocaleDateString()}</p>
          </div>
        </div>

        <div className="space-y-8 text-slate-300">
          <section>
            <h3 className="text-lg font-bold text-slate-100 mb-3 flex items-center gap-2">
              <FileText className="text-sky-400 w-5 h-5" />
              Dual-Pipeline Strategy
            </h3>
            <p className="text-sm leading-relaxed">
              This document serves as the formal executive summary for the CC Patio V11 System Upgrade. The architecture transitions the business from manual spreadsheets to a fully automated dual-pipeline model:
            </p>
            <ul className="mt-4 space-y-3">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-sm"><strong>Path A (Parametric):</strong> VividWorks handles modular configurations, pushing directly to WooCommerce and Katana MRP without human intervention.</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-sm"><strong>Path B (Bespoke):</strong> SketchUp Pro designs are quoted in GoHighLevel, which triggers a webhook to our Next.js backend, formatting cut-lists for Katana MRP.</span>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-bold text-slate-100 mb-3 flex items-center gap-2">
              <FileText className="text-sky-400 w-5 h-5" />
              Financial & Production Convergence
            </h3>
            <p className="text-sm leading-relaxed">
              Regardless of origin (Path A or Path B), all accepted orders converge into a single source of truth: <strong>Katana MRP</strong>. Katana orchestrates the factory floor operations (Cut, Fab, Powder Coating, Upholstery). Upon Final QC clearance, completed jobs automatically sync cost and revenue ledgers to <strong>QuickBooks Online</strong>.
            </p>
          </section>

          <div className="mt-12 pt-8 border-t border-slate-800 grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs text-slate-500 font-mono uppercase mb-4">Authorized By</p>
              <div className="border-b border-slate-700 h-10 w-64"></div>
              <p className="text-sm font-bold text-slate-400 mt-2">Executive Leadership</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-mono uppercase mb-4">Date</p>
              <div className="border-b border-slate-700 h-10 w-48"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ViewExecutiveBrief;
