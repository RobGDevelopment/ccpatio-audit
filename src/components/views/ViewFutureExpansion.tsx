import { motion } from "framer-motion";
import { KpiCard } from "../KpiCard";
import { Factory, PackageCheck, BarChart3, Rocket } from "lucide-react";

interface ViewProps {
  setModalData: (data: { title: string; description: string } | null) => void;
}

export function ViewFutureExpansion({ setModalData }: ViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col h-full w-full max-w-[1400px] mx-auto p-4 md:p-8 overflow-y-auto overflow-x-hidden"
    >
      {/* Header & KPIs */}
      <div className="mb-6 md:mb-12 shrink-0">
        <h2 className="text-2xl md:text-3xl font-light text-zinc-100 mb-2">Phase 3: The 3D Visualizer & Scaling</h2>
        <p className="text-zinc-400 text-xs md:text-sm max-w-3xl mb-6">
          By turning on the software you already own and connecting the systems together, CCPatio can handle massive growth without needing to hire an army of office workers. The final piece is a 3D web configurator.
        </p>
        
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 w-full">
          <KpiCard label="Time Saved" value="40+ Hrs / Wk" trend="No more typing into spreadsheets" status="good" />
          <KpiCard label="True Profit Tracking" value="Exact Costs" trend="Versus Month-End Guesses" status="good" />
          <KpiCard label="Volume Growth" value="3x Capacity" trend="With the exact same office staff" status="good" />
        </div>
      </div>

      {/* Advancements Breakdown Grid (4 Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-12">
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onClick={() => setModalData({
            title: "Factory Efficiency",
            description: "Workers use tablets instead of paper tickets. The system knows exactly what needs to be built next, and automatically tracks the raw materials being used in real-time."
          })}
          className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-2xl p-6 shadow-2xl hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300 cursor-pointer hover:scale-[1.02]"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-white/[0.05] border border-white/10 rounded-lg text-zinc-300">
              <Factory className="w-5 h-5" />
            </div>
            <h3 className="text-base md:text-lg font-light text-zinc-100">Factory Efficiency</h3>
          </div>
          <ul className="space-y-3">
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">Live tablets replace physical paper job tickets.</p>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">System instantly warns if you are low on materials before a build starts.</p>
            </li>
          </ul>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          onClick={() => setModalData({
            title: "Smart Purchasing",
            description: "The software tracks exactly how long it takes for a vendor to deliver aluminum or fabric. When stock runs low, it automatically creates a purchase order for you to approve."
          })}
          className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-2xl p-6 shadow-2xl hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300 cursor-pointer hover:scale-[1.02]"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-white/[0.05] border border-white/10 rounded-lg text-zinc-300">
              <PackageCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base md:text-lg font-light text-zinc-100">Smart Purchasing</h3>
          </div>
          <ul className="space-y-3">
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">Tracks how long vendors actually take to deliver materials.</p>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">Stops you from buying materials you don&apos;t need by tracking exact inventory.</p>
            </li>
          </ul>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          onClick={() => setModalData({
            title: "Executive Control",
            description: "Because the factory software sends the exact cost of materials used for every order directly to your accounting software, your profit margins are always 100% accurate."
          })}
          className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-2xl p-6 shadow-2xl hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300 cursor-pointer hover:scale-[1.02]"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-white/[0.05] border border-white/10 rounded-lg text-zinc-300">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h3 className="text-base md:text-lg font-light text-zinc-100">Executive Control</h3>
          </div>
          <ul className="space-y-3">
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">Exact profit and loss statements without waiting until the end of the month.</p>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">Bank accounts match perfectly with store sales and factory costs.</p>
            </li>
          </ul>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          onClick={() => setModalData({
            title: "Future 3D Customizer",
            description: "Once the factory is fully automated, we launch a 3D web tool. Customers and Trade Partners design their own custom builds online, and the system instantly translates their design into factory instructions."
          })}
          className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-2xl p-6 shadow-2xl hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300 cursor-pointer hover:scale-[1.02]"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-white/[0.05] border border-white/10 rounded-lg text-zinc-300">
              <Rocket className="w-5 h-5" />
            </div>
            <h3 className="text-base md:text-lg font-light text-zinc-100">Future 3D Customizer</h3>
          </div>
          <ul className="space-y-3">
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">Customers and Trade Partners design their own custom builds online.</p>
            </li>
            <li className="flex items-start gap-2">
              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">System instantly translates their design into factory instructions.</p>
            </li>
          </ul>
        </motion.div>

      </div>
    </motion.div>
  );
}
