import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface PipelineNodeProps {
  label: string;
  sublabel?: string;
  icon: LucideIcon;
  status: "broken" | "automated" | "neutral" | "future" | "dormant" | "isolated";
  delay?: number;
  customBadge?: string;
  onClick?: () => void;
}

export function PipelineNode({ label, sublabel, icon: Icon, status, delay = 0, customBadge, onClick }: PipelineNodeProps) {
  const getStatusStyles = () => {
    switch (status) {
      case "broken":
        return "border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]";
      case "dormant":
        return "border-zinc-800 bg-black/50 opacity-40 grayscale pointer-events-auto hover:opacity-100 hover:grayscale-0";
      case "isolated":
        return "border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.1)]";
      case "automated":
      case "future":
      case "neutral":
      default:
        return "border-white/10 hover:border-white/20";
    }
  };

  const getIconColor = () => {
    switch (status) {
      case "broken":
        return "text-red-400";
      case "dormant":
        return "text-zinc-400";
      case "isolated":
        return "text-yellow-400";
      case "automated":
      case "future":
        return "text-zinc-100";
      case "neutral":
      default:
        return "text-zinc-500";
    }
  };

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: status === "dormant" ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.5, delay, type: "spring", stiffness: 200, damping: 20 }}
      className={cn(
        "relative flex flex-col items-center justify-center p-4 md:p-6 w-40 md:w-48 bg-white/[0.03] backdrop-blur-2xl rounded-2xl border transition-all duration-300 hover:bg-white/[0.06] hover:scale-[1.03] active:scale-[0.98] shrink-0 z-10 text-left outline-none cursor-pointer focus:ring-2 focus:ring-white/20",
        getStatusStyles()
      )}
    >
      <div className={cn(
        "mb-3 md:mb-4 p-3 md:p-4 rounded-xl shadow-inner border transition-colors duration-300 flex items-center justify-center",
        status === "broken" ? "bg-red-950/20 border-red-500/20" : 
        status === "isolated" ? "bg-yellow-950/20 border-yellow-500/20" :
        "bg-black/40 border-white/5"
      )}>
        <Icon className={cn("w-6 h-6 md:w-8 md:h-8", getIconColor())} strokeWidth={1.5} />
      </div>
      <h3 className={cn("text-xs md:text-sm font-semibold tracking-wide text-center leading-tight", status === "dormant" ? "text-zinc-500" : "text-zinc-100")}>
        {label}
      </h3>
      {sublabel && (
        <p className="text-[9px] md:text-[10px] text-zinc-400 uppercase tracking-widest mt-1 md:mt-2 text-center leading-tight">
          {sublabel}
        </p>
      )}
      
      {status === "broken" && !customBadge && (
        <span className="absolute -top-2 -right-2 md:-top-3 md:-right-3 flex items-center justify-center w-5 h-5 md:w-6 md:h-6 bg-red-500/20 border border-red-500/50 text-red-400 text-[10px] md:text-xs font-bold rounded-full shadow-[0_0_10px_rgba(239,68,68,0.3)] z-20">
          !
        </span>
      )}

      {customBadge && (
        <span className={cn(
          "absolute -top-2 md:-top-3 right-auto left-auto px-2 py-0.5 md:px-3 md:py-1 text-[7px] md:text-[8px] font-bold tracking-widest uppercase rounded-full whitespace-nowrap z-20",
          status === "dormant" ? "bg-zinc-900 border border-zinc-700 text-zinc-500 shadow-md" :
          status === "isolated" ? "bg-yellow-950/80 border border-yellow-700/50 text-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)]" :
          "bg-white/[0.1] border border-white/20 text-zinc-200 shadow-lg"
        )}>
          {customBadge}
        </span>
      )}
    </motion.button>
  );
}
