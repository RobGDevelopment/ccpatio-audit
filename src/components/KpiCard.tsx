import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  trend?: string;
  status?: "neutral" | "good" | "bad";
}

export function KpiCard({ label, value, trend, status = "neutral" }: KpiCardProps) {
  const getStatusColor = () => {
    switch (status) {
      case "good":
        return "text-zinc-100"; // Replaced cyan with stark white
      case "bad":
        return "text-red-400";
      case "neutral":
      default:
        return "text-zinc-400";
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-xl shadow-xl hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300">
      <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 mb-1">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-2xl font-light", getStatusColor())}>
          {value}
        </span>
        {trend && (
          <span className="text-xs font-medium text-zinc-400">
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}
