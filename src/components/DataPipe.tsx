import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface DataPipeProps {
  status: "broken" | "automated";
  direction: "right" | "down" | "diagonal-backward";
  className?: string;
  bidirectional?: boolean;
}

export function DataPipe({ status, direction, className, bidirectional }: DataPipeProps) {
  const isBroken = status === "broken";
  
  // Base SVG styles
  const trackStyle = "stroke-white/10 stroke-[2]";
  const packetStyle = cn(
    "stroke-[3] drop-shadow-[0_0_6px_currentColor]",
    isBroken ? "stroke-red-500" : "stroke-white"
  );
  
  // Packet animation logic
  const packetAnimation = {
    duration: isBroken ? 3 : 1.5,
    repeat: Infinity,
    ease: "linear" as const
  };

  const dashArray = isBroken ? "4 100" : "20 100"; // broken is a dot, automated is a streak
  
  if (direction === "right") {
    return (
      <div className={cn("absolute z-0 pointer-events-none", className)}>
        <svg className="w-full h-full overflow-visible" preserveAspectRatio="none">
          <line x1="0" y1={bidirectional ? "35%" : "50%"} x2="100%" y2={bidirectional ? "35%" : "50%"} className={trackStyle} strokeDasharray={isBroken ? "4 4" : "none"} />
          <motion.line 
            x1="0" y1={bidirectional ? "35%" : "50%"} x2="100%" y2={bidirectional ? "35%" : "50%"} 
            className={packetStyle}
            strokeDasharray={dashArray}
            initial={{ strokeDashoffset: 120 }}
            animate={{ strokeDashoffset: -20 }}
            transition={packetAnimation}
            strokeLinecap="round"
          />
          {bidirectional && (
            <>
              <line x1="100%" y1="65%" x2="0" y2="65%" className={trackStyle} strokeDasharray={isBroken ? "4 4" : "none"} />
              <motion.line 
                x1="100%" y1="65%" x2="0" y2="65%" 
                className={packetStyle}
                strokeDasharray={dashArray}
                initial={{ strokeDashoffset: 120 }}
                animate={{ strokeDashoffset: -20 }}
                transition={{ ...packetAnimation, delay: 0.5 }}
                strokeLinecap="round"
              />
            </>
          )}
        </svg>
      </div>
    );
  }

  if (direction === "down") {
    return (
      <div className={cn("absolute z-0 pointer-events-none", className)}>
        <svg className="w-full h-full overflow-visible" preserveAspectRatio="none">
          <line x1="50%" y1="0" x2="50%" y2="100%" className={trackStyle} strokeDasharray={isBroken ? "4 4" : "none"} />
          <motion.line 
            x1="50%" y1="0" x2="50%" y2="100%" 
            className={packetStyle}
            strokeDasharray={dashArray}
            initial={{ strokeDashoffset: 120 }}
            animate={{ strokeDashoffset: -20 }}
            transition={packetAnimation}
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }

  if (direction === "diagonal-backward") {
    return (
      <div className={cn("absolute z-0 pointer-events-none", className)}>
        <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path d="M 100 0 C 100 50, 0 50, 0 100" fill="none" className={trackStyle} strokeDasharray={isBroken ? "4 4" : "none"} vectorEffect="non-scaling-stroke" />
          <motion.path 
            d="M 100 0 C 100 50, 0 50, 0 100"
            fill="none"
            className={packetStyle}
            strokeDasharray={dashArray}
            initial={{ pathLength: 0, pathOffset: 0 }}
            animate={{ pathOffset: 1 }}
            transition={packetAnimation}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  }

  return null;
}
