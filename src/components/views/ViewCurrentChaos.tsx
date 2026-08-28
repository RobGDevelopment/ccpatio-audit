import { motion } from "framer-motion";
import { Globe, Store, FileSpreadsheet, Factory, Calculator } from "lucide-react";
import { KpiCard } from "../KpiCard";
import { PipelineNode } from "../PipelineNode";
import { DataPipe } from "../DataPipe";

interface ViewProps {
  setModalData: (data: { title: string; description: string } | null) => void;
}

export function ViewCurrentChaos({ setModalData }: ViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col w-full max-w-[1400px] mx-auto h-full"
    >
      {/* Header & KPIs */}
      <div className="mb-6 md:mb-12 shrink-0">
        <h2 className="text-2xl md:text-3xl font-light text-zinc-100 mb-2">The Current Chaos</h2>
        <p className="text-zinc-400 text-xs md:text-sm max-w-3xl mb-6">
          The business has strong sales, but the back-office is disconnected. Teams waste hours copying data by hand into spreadsheets, causing major delays and blindspots for the factory and accounting.
        </p>
        
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 w-full">
          <KpiCard label="New Leads" value="High Volume" trend="Ads & Website Active" status="neutral" />
          <KpiCard label="Factory Progress" value="Blindspot" trend="Stuck in Google Sheets" status="bad" />
          <KpiCard label="Money Tracking" value="100% Manual" trend="Disconnected Systems" status="bad" />
        </div>
      </div>

      {/* Grid Canvas */}
      <div className="flex-1 w-full relative z-10 pb-24 md:pb-0 overflow-y-auto md:overflow-visible no-scrollbar flex flex-col items-center">
        
        {/* Main Pipeline Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-y-16 md:gap-y-24 lg:gap-y-0 gap-x-8 md:gap-x-12 w-full max-w-6xl relative">
          
          {/* Node 1: Leads */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="Ad & Website Leads" 
              sublabel="High volume, but disconnected." 
              icon={Globe} 
              status="neutral" 
              delay={0.1} 
              onClick={() => setModalData({
                title: "Ad & Website Leads",
                description: "Leads come in from Meta Ads, web forms, and calls, but there is no unified system capturing them before they hit the showroom."
              })}
            />
            {/* Desktop Connector (Right) */}
            <DataPipe direction="right" status="broken" className="hidden lg:block top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Tablet Connector (Right) */}
            <DataPipe direction="right" status="broken" className="hidden md:block lg:hidden top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Mobile Connector (Down) */}
            <DataPipe direction="down" status="broken" className="block md:hidden left-1/2 -bottom-[4rem] h-[4rem] -translate-x-1/2" />
          </div>

          {/* Node 2: Showroom Sales */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="Showroom Sales (Clover)" 
              sublabel="Rings sales, but talks to nothing else." 
              icon={Store} 
              status="broken" 
              customBadge="ISOLATED"
              delay={0.2} 
              onClick={() => setModalData({
                title: "Showroom Sales (Clover)",
                description: "Sales are rung up in the showroom using Clover POS. However, this system doesn't talk to the factory or accounting, meaning the data stops here."
              })}
            />
            {/* Desktop Connector (Right) */}
            <DataPipe direction="right" status="broken" className="hidden lg:block top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Tablet Connector (Down-Left wrap) */}
            <DataPipe direction="diagonal-backward" status="broken" className="hidden md:block lg:hidden right-1/2 top-[100%] w-[calc(100%+3rem)] h-[6rem]" />
            {/* Mobile Connector (Down) */}
            <DataPipe direction="down" status="broken" className="block md:hidden left-1/2 -bottom-[4rem] h-[4rem] -translate-x-1/2" />
          </div>

          {/* Node 3: The Google Sheet */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="The Google Sheet" 
              sublabel="The manual bottleneck. 100% typing." 
              icon={FileSpreadsheet} 
              status="broken" 
              customBadge="BOTTLENECK"
              delay={0.3} 
              onClick={() => setModalData({
                title: "The Google Sheet",
                description: "The absolute bottleneck. A massive, chaotic spreadsheet where showroom reps manually type orders and the factory tries to read them to build products. It is prone to catastrophic human error."
              })}
            />
            {/* Desktop Connector (Right) */}
            <DataPipe direction="right" status="broken" className="hidden lg:block top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Tablet Connector (Right) */}
            <DataPipe direction="right" status="broken" className="hidden md:block lg:hidden top-1/2 -right-[3rem] w-[3rem] -translate-y-1/2" />
            {/* Mobile Connector (Down) */}
            <DataPipe direction="down" status="broken" className="block md:hidden left-1/2 -bottom-[4rem] h-[4rem] -translate-x-1/2" />
          </div>

          {/* Node 4: Accounting */}
          <div className="relative flex justify-center">
            <PipelineNode 
              label="Accounting (QuickBooks)" 
              sublabel="Isolated. Every invoice is typed by hand." 
              icon={Calculator} 
              status="broken" 
              customBadge="MANUAL ENTRY"
              delay={0.4} 
              onClick={() => setModalData({
                title: "Accounting (QuickBooks)",
                description: "Accounting is completely blind to production. When an order is done, it is manually typed into QuickBooks, losing track of real-time material costs and labor expenses."
              })}
            />
          </div>

        </div>

        {/* Isolated Nodes (Katana) */}
        <div className="mt-16 md:mt-24 lg:mt-32 border-t border-white/5 pt-8 w-full max-w-lg flex flex-col items-center">
          <p className="text-zinc-600 text-[10px] uppercase tracking-widest font-bold mb-6">Unused Assets</p>
          <PipelineNode 
            label="Factory Software (Katana)" 
            sublabel="Paid for, but 0% utilized. Sitting dormant." 
            icon={Factory} 
            status="dormant" 
            delay={0.5} 
            onClick={() => setModalData({
              title: "Factory Software (Katana)",
              description: "A powerful MRP system that has been fully paid for and populated with products, but sits completely idle because the team relies on the Google Sheet."
            })}
          />
        </div>

      </div>
      
      {/* Scroll indicator for mobile if needed */}
      <div className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 text-zinc-500 text-[10px] uppercase tracking-widest animate-pulse pointer-events-none">
        Scroll to view more
      </div>
    </motion.div>
  );
}
