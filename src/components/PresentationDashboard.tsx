"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { ViewCurrentChaos } from "@/components/views/ViewCurrentChaos";
import { ViewInfrastructureMatrix } from "@/components/views/ViewInfrastructureMatrix";
import { ViewTrainingGates } from "@/components/views/ViewTrainingGates";
import { ViewExecutiveBrief } from "@/components/views/ViewExecutiveBrief";
import { ViewTrueMargin } from "@/components/views/ViewTrueMargin";
import { ViewAuditLogs } from "@/components/views/ViewAuditLogs";
import MermaidDiagram from "@/components/MermaidDiagram";
import { useAppStore } from "@/store/useAppStore";

const v11Chart = `
%%{init: {"flowchart": {"nodespacing": 80, "rankspacing": 100}}}%%
flowchart TB
    classDef software fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#ffffff,rx:6,ry:6,font-weight:700
    classDef api fill:#0369a1,stroke:#7dd3fc,stroke-width:2px,color:#ffffff,rx:6,ry:6,font-weight:800
    classDef gate fill:#9a3412,stroke:#fdba74,stroke-width:2px,color:#ffffff,font-weight:800
    classDef human fill:transparent,stroke:#64748b,stroke-width:2px,color:#f8fafc,stroke-dasharray: 4 4,rx:20,ry:20,font-weight:600
    classDef external fill:transparent,stroke:#475569,stroke-width:1px,color:#94a3b8,rx:6,ry:6,font-weight:500
    classDef tracker fill:#5b21b6,stroke:#c4b5fd,stroke-width:2px,color:#ffffff,rx:6,ry:6,font-weight:700

    subgraph ZONE0 [ZONE 0: FIELD SALES & ONSITE CAPTURE]
        direction LR
        Leads(["Marketing Leads"]):::human
        FieldApp["GHL Mobile App"]:::software
        SalesTime["Log Sales Time"]:::tracker
        Leads --> FieldApp -.-> SalesTime
    end

    subgraph ZONE1 [ZONE 1: SHOWROOM & PROPOSAL FUNNEL]
        direction LR
        SK["SketchUp Pro"]:::software
        Show["Showroom Selection"]:::human
        Prop["GHL Native Proposal Builder"]:::software
        Mgr{"Manager Margin Approval"}:::gate
        Term["Physical Clover Terminal"]:::software
        GHL["GHL Pipeline: Deposit Cleared"]:::software
        SK --> Show --> Prop
        Prop --> Mgr --> Term --> GHL
    end

    subgraph ZONE2 [ZONE 2: CLOUD MIDDLEWARE]
        direction LR
        UID["Generate Serial IDs"]:::api
        Nest["Automated Nesting API"]:::api
        UID --> Nest
    end

    subgraph ZONE3 [ZONE 3: IN-HOUSE PRODUCTION]
        direction LR
        Kat["Katana MRP Engine"]:::software
        Cut(["Cut Station"]):::human
        Fab(["Fab Cell"]):::human
        UphQC{"As-Built Dimension QC"}:::gate
        Pow(["Powder Coating"]):::human
        Uph(["Upholstery Build"]):::human
        QC(["Final QC & Assembly"]):::human
        Kat --> Cut --> Fab --> UphQC
        UphQC --> Pow --> QC
        UphQC --> Uph --> QC
    end

    subgraph ZONE4 [ZONE 4: FINANCIAL LEDGER]
        direction LR
        QBO["QuickBooks Online"]:::software
    end

    FieldApp --> SK
    GHL --> UID
    Nest --> Kat
    QC --> QBO
`;

export function PresentationDashboard() {
  const activePhase = useAppStore((state) => state.activePhase);
  const modalData = useAppStore((state) => state.modalData);
  const setModalData = useAppStore((state) => state.setModalData);

  const renderActiveView = () => {
    switch (activePhase) {
      case 0:
        return <ViewCurrentChaos setModalData={setModalData} />;
      case 1:
        return (
          <div className="h-full w-full p-8">
            <MermaidDiagram chart={v11Chart} />
          </div>
        );
      case 2:
        return <ViewInfrastructureMatrix />;
      case 3:
        return <ViewTrainingGates />;
      case 4:
        return <ViewExecutiveBrief />;
      case 5:
        return <ViewTrueMargin />;
      case 6:
        return <ViewAuditLogs />;
      default:
        return null;
    }
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto bg-linear-to-b from-slate-950 to-slate-900/50">
        <AnimatePresence mode="wait">
          <motion.div
            key={activePhase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex min-h-max w-full flex-1 flex-col justify-center"
          >
            {renderActiveView()}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {modalData ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-100 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setModalData(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setModalData(null)}
                className="absolute top-4 right-4 cursor-pointer rounded-full p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-100"
              >
                <X size={20} />
              </button>
              <h3 className="mb-4 text-xl font-semibold text-zinc-100">
                {modalData.title}
              </h3>
              <p className="text-sm leading-relaxed text-zinc-400 md:text-base">
                {modalData.description}
              </p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
