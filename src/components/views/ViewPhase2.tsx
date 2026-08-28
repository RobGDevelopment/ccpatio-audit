import { motion } from "framer-motion";
import { CreditCard, ShoppingCart, Factory } from "lucide-react";
import { KpiCard } from "../KpiCard";
import { PipelineNode } from "../PipelineNode";
import { DataPipe } from "../DataPipe";

interface ViewProps {
  setModalData: (data: { title: string; description: string } | null) => void;
}

export function ViewPhase2({ setModalData }: ViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full w-full max-w-[1400px] mx-auto p-4 md:p-8"
    >
      {/* Header & KPIs */}
      <div className="mb-6 md:mb-12 shrink-0">
        <h2 className="text-2xl md:text-3xl font-light text-zinc-100 mb-2">Phase 2: Standard E-Commerce & Automated Billing</h2>
        <p className="text-zinc-400 text-xs md:text-sm max-w-3xl mb-6">
          We turn on standard online sales for fixed catalog items and implement automated text-to-pay links for showroom deposits. Both workflows instantly feed into the automated Phase 1 backbone.
        </p>
        
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 w-full">
          <KpiCard label="Deposit Collection" value="Instant" trend="Secure SMS Payment Links" status="good" />
          <KpiCard label="Fixed Catalog Sales" value="24/7" trend="Zero Human Touch Required" status="good" />
          <KpiCard label="Factory Handoff" value="Automatic" trend="Orders flow straight to Katana" status="good" />
        </div>
      </div>

      {/* Grid Canvas */}
      <div className="flex-1 flex flex-col justify-start md:justify-center items-center w-full relative z-10 pb-24 md:pb-0 overflow-y-auto md:overflow-visible no-scrollbar">
        
        {/* Main Pipeline Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-16 md:gap-y-24 lg:gap-y-0 gap-x-8 md:gap-x-12 w-full max-w-5xl relative">
          
          {/* Node 1 */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="Automated Deposits" 
              sublabel="Showroom quotes trigger instant payment links." 
              icon={CreditCard} 
              status="automated" 
              delay={0.1} 
              onClick={() => setModalData({
                title: "Automated Deposits",
                description: "Solution: When a rep makes a sale, the system instantly texts the client a secure link to pay their deposit online. Once paid, the factory software turns on automatically."
              })}
            />
            {/* Desktop Connector (Right) */}
            <DataPipe direction="right" status="automated" className="hidden lg:block top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Tablet Connector (Right) */}
            <DataPipe direction="right" status="automated" className="hidden md:block lg:hidden top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Mobile Connector (Down) */}
            <DataPipe direction="down" status="automated" className="block md:hidden left-1/2 -bottom-[4rem] h-[4rem] -translate-x-1/2" />
          </div>

          {/* Node 2 */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="Standard Online Sales" 
              sublabel="Sell fixed items (fire pits, covers) 24/7." 
              icon={ShoppingCart} 
              status="automated" 
              delay={0.2} 
              onClick={() => setModalData({
                title: "Standard Online Sales",
                description: "Solution: We turn the website catalog into a live store for standard items. Orders flow straight to the factory and accounting without a human touching it."
              })}
            />
            {/* Desktop Connector (Right) */}
            <DataPipe direction="right" status="automated" className="hidden lg:block top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Tablet Connector (Down-Left wrap) */}
            <DataPipe direction="diagonal-backward" status="automated" className="hidden md:block lg:hidden right-1/2 top-[100%] w-[calc(100%+3rem)] h-[6rem]" />
            {/* Mobile Connector (Down) */}
            <DataPipe direction="down" status="automated" className="block md:hidden left-1/2 -bottom-[4rem] h-[4rem] -translate-x-1/2" />
          </div>

          {/* Node 3 (Phase 1 encapsulate) */}
          <div className="relative flex justify-center pt-8 md:pt-0">
            {/* Phase 1 Encapsulated Group */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="flex flex-col p-4 md:p-6 rounded-2xl border border-white/10 bg-white/[0.02] shadow-2xl relative w-full"
            >
              <div className="absolute -top-2 md:-top-3 left-1/2 -translate-x-1/2 px-2 md:px-3 py-0.5 md:py-1 bg-zinc-900 border border-zinc-700 text-zinc-400 text-[8px] md:text-[10px] uppercase font-bold tracking-widest rounded-full whitespace-nowrap">
                Phase 1 Backbone
              </div>
              <div className="flex items-center justify-center mt-2">
                <PipelineNode 
                  label="The Factory Brain" 
                  sublabel="Auto-generates materials"
                  icon={Factory} 
                  status="automated"
                  onClick={() => setModalData({
                    title: "The Factory Brain",
                    description: "Both the automated deposit payments and the standard online sales drop seamlessly into the Phase 1 backbone. The factory is immediately notified to start production."
                  })} 
                />
              </div>
            </motion.div>
          </div>

        </div>

      </div>

      {/* Scroll indicator for mobile if needed */}
      <div className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 text-zinc-500 text-[10px] uppercase tracking-widest animate-pulse pointer-events-none">
        Scroll to view more
      </div>
    </motion.div>
  );
}
