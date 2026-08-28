import { create } from 'zustand';

export interface ModalData {
  title: string;
  description: string;
}

interface AppState {
  activePhase: number;
  setActivePhase: (phase: number) => void;
  modalData: ModalData | null;
  setModalData: (data: ModalData | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activePhase: 0,
  setActivePhase: (phase) => set({ activePhase: phase }),
  modalData: null,
  setModalData: (data) => set({ modalData: data }),
}));
