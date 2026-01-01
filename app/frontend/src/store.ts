import { create } from "zustand";
import { api } from "./api";

export type Ticker = {
  code: string;
  name: string;
  stage: string;
  score: number;
  reason: string;
};

export type BarsPayload = {
  bars: number[][];
  ma: {
    ma7: number[][];
    ma20: number[][];
    ma60: number[][];
  };
};

export type BarsCache = {
  monthly: Record<string, BarsPayload>;
  daily: Record<string, BarsPayload>;
};

type LoadingMap = {
  monthly: Record<string, boolean>;
  daily: Record<string, boolean>;
};

type Settings = {
  columns: 2 | 3 | 4;
  search: string;
  gridScrollTop: number;
  gridTimeframe: "monthly" | "daily";
};

type StoreState = {
  tickers: Ticker[];
  barsCache: BarsCache;
  barsLoading: LoadingMap;
  loadingList: boolean;
  settings: Settings;
  loadList: () => Promise<void>;
  loadBarsBatch: (timeframe: Settings["gridTimeframe"], codes: string[]) => Promise<void>;
  ensureBarsForVisible: (timeframe: Settings["gridTimeframe"], codes: string[]) => Promise<void>;
  setColumns: (columns: Settings["columns"]) => void;
  setSearch: (search: string) => void;
  setGridScrollTop: (value: number) => void;
  setGridTimeframe: (value: Settings["gridTimeframe"]) => void;
};

const getInitialTimeframe = (): Settings["gridTimeframe"] => {
  if (typeof window === "undefined") return "monthly";
  const saved = window.localStorage.getItem("gridTimeframe");
  return saved === "daily" ? "daily" : "monthly";
};

export const useStore = create<StoreState>((set, get) => ({
  tickers: [],
  barsCache: { monthly: {}, daily: {} },
  barsLoading: { monthly: {}, daily: {} },
  loadingList: false,
  settings: {
    columns: 3,
    search: "",
    gridScrollTop: 0,
    gridTimeframe: getInitialTimeframe()
  },
  loadList: async () => {
    if (get().loadingList) return;
    set({ loadingList: true });
    try {
      const res = await api.get("/list");
      const items = (res.data || []) as [string, string, string, number, string][];
      const tickers = items.map(([code, name, stage, score, reason]) => ({
        code,
        name,
        stage,
        score,
        reason
      }));
      set({ tickers });
    } finally {
      set({ loadingList: false });
    }
  },
  loadBarsBatch: async (timeframe, codes) => {
    const state = get();
    const loadingMap = state.barsLoading[timeframe];
    const trimmed = codes.filter((code) => !loadingMap[code]);
    if (!trimmed.length) return;

    const nextLoading = { ...state.barsLoading[timeframe] };
    trimmed.forEach((code) => {
      nextLoading[code] = true;
    });
    set({ barsLoading: { ...state.barsLoading, [timeframe]: nextLoading } });

    try {
      const res = await api.post("/batch_bars", {
        timeframe,
        codes: trimmed,
        limit: 60
      });
      const items = (res.data?.items || {}) as Record<string, BarsPayload>;
      set((prev) => ({
        barsCache: {
          ...prev.barsCache,
          [timeframe]: { ...prev.barsCache[timeframe], ...items }
        }
      }));
    } finally {
      set((prev) => {
        const cleared = { ...prev.barsLoading[timeframe] };
        trimmed.forEach((code) => {
          delete cleared[code];
        });
        return { barsLoading: { ...prev.barsLoading, [timeframe]: cleared } };
      });
    }
  },
  ensureBarsForVisible: async (timeframe, codes) => {
    const state = get();
    const cache = state.barsCache[timeframe];
    const missing = codes.filter((code) => !cache[code]);
    if (!missing.length) return;

    const batchSize = 48;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await get().loadBarsBatch(timeframe, batch);
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
  },
  setGridTimeframe: (value) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("gridTimeframe", value);
    }
    set((state) => ({ settings: { ...state.settings, gridTimeframe: value } }));
  }
}));