import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { OperationalTask } from "../../schema/operationalTask";
import { OPERATIONAL_ZONE_ACCENT } from "../../schema/operationalTask";

interface SortableActionCardProps {
  task: OperationalTask;
  onClick: () => void;
  onDelete: () => void;
}

export function SortableActionCard({
  task,
  onClick,
  onDelete,
}: SortableActionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    borderLeftColor: OPERATIONAL_ZONE_ACCENT[task.zone],
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border border-l-4 p-3 shadow-sm transition-colors ${
        isDragging
          ? "border-cyan-500 bg-slate-800 opacity-90"
          : "border-slate-700 bg-slate-900 hover:border-slate-600"
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab p-1 text-slate-500 hover:text-slate-300"
      >
        ⋮⋮
      </div>

      <div className="flex-1 cursor-pointer" onClick={onClick}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-100">{task.title}</span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            {task.zone}
          </span>
          {task.nodeType && task.nodeType !== "standard" ? (
            <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">
              {task.nodeType}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
          {task.duration}
          {task.techStack.length > 0 ? ` · ${task.techStack.join(", ")}` : ""}
        </div>
        <div className="mt-2 flex gap-2 text-[10px]">
          {task.inputsRequired.length > 0 && (
            <span className="text-amber-500">IN: {task.inputsRequired.join(", ")}</span>
          )}
          {task.outputsGenerated.length > 0 && (
            <span className="text-emerald-500">
              OUT: {task.outputsGenerated.join(", ")}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        aria-label={`Delete ${task.title}`}
        onClick={onDelete}
        className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-red-950/50 hover:text-red-300"
      >
        ✕
      </button>
    </div>
  );
}
