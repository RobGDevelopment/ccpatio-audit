"use client";

import { useEffect, useRef, useState } from "react";
import { getPendingStaffNotes } from "./actions";

type Note = {
  id: string;
  global_sku: string | null;
  panel_location: string;
  operator_email: string;
  note: string;
  is_urgent: boolean;
  created_at: Date;
};

export function StaffRequestsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchNotes = async () => {
    setIsLoading(true);
    try {
      const data = await getPendingStaffNotes();
      setNotes(data as any);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDropdown = () => {
    if (!isOpen) {
      fetchNotes();
    }
    setIsOpen(!isOpen);
  };

  const urgentCount = notes.filter(n => n.is_urgent).length;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition shadow-sm border border-zinc-800"
      >
        <span>Staff Requests</span>
        {notes.length > 0 && (
          <span className="flex h-5 items-center justify-center rounded-full bg-emerald-500/20 px-2 text-[10px] font-bold text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
            {notes.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border border-zinc-800 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-4 border-b border-zinc-800/80 pb-3">
            <h3 className="text-sm font-semibold text-zinc-100">Pending Feedback & Tasks</h3>
            {urgentCount > 0 && (
              <span className="text-[10px] uppercase font-bold text-red-400 bg-red-500/10 px-2 py-1 rounded-md">
                {urgentCount} Urgent Blockers
              </span>
            )}
          </div>
          
          <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
            {isLoading ? (
              <div className="text-center text-xs text-zinc-500 py-4">Loading requests...</div>
            ) : notes.length === 0 ? (
              <div className="text-center text-xs text-emerald-400 py-4">All caught up! No pending requests.</div>
            ) : (
              notes.map(note => (
                <div key={note.id} className="rounded-lg bg-zinc-950 border border-zinc-800/50 p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{note.panel_location}</div>
                      <div className="text-xs font-medium text-zinc-300">{note.operator_email}</div>
                    </div>
                    {note.is_urgent && (
                      <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 rounded">
                        URGENT
                      </span>
                    )}
                  </div>
                  {note.global_sku && (
                    <div className="text-[11px] font-mono text-zinc-400 mb-2 bg-zinc-900 inline-block px-2 py-0.5 rounded">
                      {note.global_sku}
                    </div>
                  )}
                  <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{note.note}</p>
                  <div className="mt-2 text-[10px] text-zinc-600 text-right">
                    {new Date(note.created_at).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
