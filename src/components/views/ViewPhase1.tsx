import { motion } from "framer-motion";
import { Database, Factory, CalendarDays, Store } from "lucide-react";
import { KpiCard } from "../KpiCard";
import { PipelineNode } from "../PipelineNode";
import { DataPipe } from "../DataPipe";

interface ViewProps {
  setModalData: (data: { title: string; description: string } | null) => void;
}

export function ViewPhase1({ setModalData }: ViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full w-full max-w-[1400px] mx-auto p-4 md:p-8"
    >
      {/* Header & KPIs */}
      <div className="mb-6 md:mb-12 shrink-0">
        <h2 className="text-2xl md:text-3xl font-light text-zinc-100 mb-2">Phase 1: The Optimized Workflow</h2>
        <p className="text-zinc-400 text-xs md:text-sm max-w-3xl mb-6">
          We turn on the Factory Software and eliminate the Giant Google Sheet. Sales, the Factory, and Accounting are finally talking to each other instantly.
        </p>
        
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 w-full">
          <KpiCard label="Manual Typing" value="0" trend="Everything is Automatic" status="good" />
          <KpiCard label="Factory Materials" value="100% Accurate" trend="No More Guessing" status="good" />
          <KpiCard label="Expense Tracking" value="Real-Time" trend="Per Custom Order" status="good" />
        </div>
      </div>

      {/* Grid Canvas */}
      <div className="flex-1 flex flex-col justify-start md:justify-center items-center w-full relative z-10 pb-24 md:pb-0 overflow-y-auto md:overflow-visible no-scrollbar">
        
        {/* Main Pipeline Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-y-16 md:gap-y-24 lg:gap-y-0 gap-x-8 md:gap-x-12 w-full max-w-6xl relative">
          
          {/* Node 1 */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="Sales Hub (GoHighLevel)" 
              sublabel="Captures leads & closes deals." 
              icon={Store} 
              status="automated" 
              delay={0.1} 
              onClick={() => setModalData({
                title: "Sales Hub (GoHighLevel)",
                description: "All leads from Meta Ads, the website, and the showroom are captured in one place and converted into closed deals without any manual typing."
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
              label="The Factory Brain (Katana)" 
              sublabel="Receives orders instantly. Auto-deducts materials." 
              icon={Factory} 
              status="automated" 
              delay={0.2} 
              onClick={() => setModalData({
                title: "The Factory Brain (Katana)",
                description: "As soon as a deal closes in Sales, the factory software instantly receives the order and automatically deducts the raw materials from inventory."
              })}
            />
            {/* Desktop Connector (Right) */}
            <DataPipe direction="right" status="automated" className="hidden lg:block top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Tablet Connector (Down-Left wrap) */}
            <DataPipe direction="diagonal-backward" status="automated" className="hidden md:block lg:hidden right-1/2 top-[100%] w-[calc(100%+3rem)] h-[6rem]" />
            {/* Mobile Connector (Down) */}
            <DataPipe direction="down" status="automated" className="block md:hidden left-1/2 -bottom-[4rem] h-[4rem] -translate-x-1/2" />
          </div>

          {/* Node 3 */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="The Ledger (QuickBooks)" 
              sublabel="Auto-reconciles sales and exact production costs." 
              icon={Database} 
              status="automated" 
              delay={0.3} 
              onClick={() => setModalData({
                title: "The Ledger (QuickBooks)",
                description: "Accounting software automatically reconciles the sales revenue and exact production costs for every single custom order."
              })}
            />
            {/* Desktop Connector (Right) */}
            <DataPipe direction="right" status="automated" className="hidden lg:block top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Tablet Connector (Right) */}
            <DataPipe direction="right" status="automated" className="hidden md:block lg:hidden top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Mobile Connector (Down) */}
            <DataPipe direction="down" status="automated" className="block md:hidden left-1/2 -bottom-[4rem] h-[4rem] -translate-x-1/2" />
          </div>

          {/* Node 4 */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="Delivery Tracking" 
              sublabel="Auto-schedules when the factory finishes." 
              icon={CalendarDays} 
              status="automated" 
              delay={0.4} 
              onClick={() => setModalData({
                title: "Delivery Tracking",
                description: "When the factory finishes the build, the system automatically schedules the delivery without anyone having to check a spreadsheet."
              })}
            />
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
