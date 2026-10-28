import { create } from "zustand";
import type { TimeOfDay } from "@/config";

export type ViewerMode = "orbit" | "playable";

export type StoreState = {
  structure: Record<string, unknown> | null;
  structureName: string | null;
  loadError: string | null;
  timeOfDay: TimeOfDay;
  viewerMode: ViewerMode;
  setStructure: (structure: Record<string, unknown>, name: string) => void;
  setLoadError: (error: string | null) => void;
  setTimeOfDay: (time: TimeOfDay) => void;
  setViewerMode: (mode: ViewerMode) => void;
};

export const useStore = create<StoreState>()((set) => ({
  structure: null,
  structureName: null,
  loadError: null,
  timeOfDay: "sunset",
  viewerMode: "orbit",
  setStructure: (structure, name) =>
    set({ structure, structureName: name, loadError: null }),
  setLoadError: (error) => set({ loadError: error }),
  setTimeOfDay: (time) => set({ timeOfDay: time }),
  setViewerMode: (mode) => set({ viewerMode: mode }),
}));
