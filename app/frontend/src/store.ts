import { create } from "zustand";
import { api } from "./api";

export type Ticker = {
  code: string;
  name: string;
  stage: string | null;
  score: number | null;
};

export type MonthlyMap = Record<string, number[][]>;

type Settings = {
  columns: 2 | 3 | 4;
  search: string;
  gridScrollTop: number;
};

type StoreState = {
  tickers: Ticker[];
  monthlyCache: MonthlyMap;
  monthlyLoading: Record<string, boolean>;
  loadingList: boolean;
  settings: Settings;
  loadList: () => Promise<void>;
  loadMonthlyBatch: (codes: string[]) => Promise<void>;
  ensureMonthlyForVisible: (codes: string[]) => Promise<void>;
  setColumns: (columns: Settings["columns"]) => void;
  setSearch: (search: string) => void;
  setGridScrollTop: (value: number) => void;
};

export const useStore = create<StoreState>((set, get) => ({
  tickers: [],
  monthlyCache: {},
  monthlyLoading: {},
  loadingList: false,
  settings: {
    columns: 3,
    search: "",
    gridScrollTop: 0
  },
  loadList: async () => {
    if (get().loadingList) return;
    set({ loadingList: true });
    try {
      const res = await api.get("/list");
      const items = (res.data.items || []) as [string, string, string | null, number | null][];
      const tickers = items.map(([code, name, stage, score]) => ({
        code,
        name,
        stage,
        score
      }));
      set({ tickers });
    } finally {
      set({ loadingList: false });
    }
  },
  loadMonthlyBatch: async (codes) => {
    const trimmed = codes.filter((code) => !get().monthlyLoading[code]);
    if (!trimmed.length) return;

    const loadingMap = { ...get().monthlyLoading };
    trimmed.forEach((code) => {
      loadingMap[code] = true;
    });
    set({ monthlyLoading: loadingMap });

    try {
      const res = await api.post("/batch_monthly", { codes: trimmed });
      const data = res.data as Record<string, number[][]>;
      set((state) => ({
        monthlyCache: { ...state.monthlyCache, ...data }
      }));
    } finally {
      set((state) => {
        const nextLoading = { ...state.monthlyLoading };
        trimmed.forEach((code) => {
          delete nextLoading[code];
        });
        return { monthlyLoading: nextLoading };
      });
    }
  },
  ensureMonthlyForVisible: async (codes) => {
    const missing = codes.filter((code) => !get().monthlyCache[code]);
    if (!missing.length) return;

    const batchSize = 48;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await get().loadMonthlyBatch(batch);
    }
  },
  setColumns: (columns) => {
    set((state) => ({ settings: { ...state.settings, columns } }));
  },
  setSearch: (search) => {
    set((state) => ({ settings: { ...state.settings, search } }));
  },
  setGridScrollTop: (value) => {
    set((state) => ({ settings: { ...state.settings, gridScrollTop: value } }));
  }
}));