"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTopologyStore } from "../topology/topologyStore";
import { SortableActionCard } from "./SortableActionCard";
import { BlueprintPersistenceBar } from "./BlueprintPersistenceBar";

export function ActionCardList() {
  const operationalTasks = useTopologyStore((s) => s.operationalTasks);
  const moveBlueprintTask = useTopologyStore((s) => s.moveBlueprintTask);
  const selectTask = useTopologyStore((s) => s.selectTask);
  const addTask = useTopologyStore((s) => s.addTask);
  const deleteTask = useTopologyStore((s) => s.deleteTask);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = operationalTasks.findIndex((task) => task.id === active.id);
      const newIndex = operationalTasks.findIndex((task) => task.id === over.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        moveBlueprintTask(oldIndex, newIndex);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-slate-800 p-4">
        <button
          type="button"
          onClick={addTask}
          className="w-full rounded-lg border border-cyan-400/70 bg-cyan-500/20 px-4 py-3 text-sm font-semibold uppercase tracking-wider text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.25)] hover:bg-cyan-500/30"
        >
          + Add Operational Task
        </button>
        <BlueprintPersistenceBar />
      </div>

      {operationalTasks.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">
          No operational tasks yet. Add one to start mapping the supply chain.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={operationalTasks.map((task) => task.id)}
                strategy={verticalListSortingStrategy}
              >
                {operationalTasks.map((task) => (
                  <SortableActionCard
                    key={task.id}
                    task={task}
                    onClick={() => selectTask(task.id)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}
    </div>
  );
}
