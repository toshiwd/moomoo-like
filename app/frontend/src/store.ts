import { create } from "zustand";
import { api } from "./api";

export type Ticker = {
  code: string;
  name: string;
  stage: string;
  score: number;
  reason: string;
};

export type MaTimeframe = "daily" | "weekly" | "monthly";

export type MaSetting = {
  key: string;
  label: string;
  period: number;
  visible: boolean;
  color: string;
  lineWidth: number;
};

export type Box = {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  lower: number;
  upper: number;
  breakout: "up" | "down" | null;
};

export type BarsPayload = {
  bars: number[][];
  ma: {
    ma7: number[][];
    ma20: number[][];
    ma60: number[][];
  };
  boxes?: Box[];
};

export type BarsCache = {
  monthly: Record<string, BarsPayload>;
  weekly: Record<string, BarsPayload>;
  daily: Record<string, BarsPayload>;
};

export type BoxesCache = {
  monthly: Record<string, Box[]>;
  weekly: Record<string, Box[]>;
  daily: Record<string, Box[]>;
};

type MaSettings = {
  daily: MaSetting[];
  weekly: MaSetting[];
  monthly: MaSetting[];
};

type LoadingMap = {
  monthly: Record<string, boolean>;
  weekly: Record<string, boolean>;
  daily: Record<string, boolean>;
};

type StatusMap = {
  monthly: Record<string, "idle" | "loading" | "success" | "empty" | "error">;
  weekly: Record<string, "idle" | "loading" | "success" | "empty" | "error">;
  daily: Record<string, "idle" | "loading" | "success" | "empty" | "error">;
};

type Settings = {
  columns: 2 | 3 | 4;
  search: string;
  gridScrollTop: number;
  gridTimeframe: "monthly" | "weekly" | "daily";
  showBoxes: boolean;
  sortMode: SortMode;
};

type StoreState = {
  tickers: Ticker[];
  barsCache: BarsCache;
  boxesCache: BoxesCache;
  barsLoading: LoadingMap;
  barsStatus: StatusMap;
  loadingList: boolean;
  maSettings: MaSettings;
  settings: Settings;
  loadList: () => Promise<void>;
  loadBarsBatch: (
    timeframe: Settings["gridTimeframe"],
    codes: string[],
    limitOverride?: number
  ) => Promise<void>;
  loadBoxesBatch: (codes: string[]) => Promise<void>;
  ensureBarsForVisible: (timeframe: Settings["gridTimeframe"], codes: string[]) => Promise<void>;
  setColumns: (columns: Settings["columns"]) => void;
  setSearch: (search: string) => void;
  setGridScrollTop: (value: number) => void;
  setGridTimeframe: (value: Settings["gridTimeframe"]) => void;
  setShowBoxes: (value: boolean) => void;
  setSortMode: (value: SortMode) => void;
  updateMaSetting: (timeframe: MaTimeframe, index: number, patch: Partial<MaSetting>) => void;
  resetMaSettings: (timeframe: MaTimeframe) => void;
};

export type SortMode = "trend-up" | "trend-down" | "trend-abs" | "exhaustion";

const MA_COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b"];
const THUMB_BARS = 30;
const MIN_BATCH_LIMIT = 60;
const MAX_BATCH_LIMIT = 2000;
const WEEKLY_DAILY_FACTOR = 7;
const DEFAULT_PERIODS: Record<MaTimeframe, number[]> = {
  daily: [3, 10, 20, 60, 100],
  weekly: [3, 10, 20, 60, 100],
  monthly: [3, 10, 20, 60, 100]
};

const makeDefaultSettings = (timeframe: MaTimeframe): MaSetting[] =>
  DEFAULT_PERIODS[timeframe].map((period, index) => ({
    key: `ma${index + 1}`,
    label: `MA${index + 1}`,
    period,
    visible: index < 3,
    color: MA_COLORS[index] ?? "#94a3b8",
    lineWidth: 1
  }));

const normalizeColor = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
};

const normalizeLineWidth = (value: unknown, fallback: number) => {
  const width = Number(value);
  if (!Number.isFinite(width)) return fallback;
  return Math.min(6, Math.max(1, Math.round(width)));
};

const normalizeSettings = (timeframe: MaTimeframe, input: unknown): MaSetting[] => {
  const defaults = makeDefaultSettings(timeframe);
  if (!Array.isArray(input)) return defaults;
  return defaults.map((item, index) => {
    const candidate = input[index] as Partial<MaSetting> | undefined;
    const period = Number(candidate?.period);
    return {
      ...item,
      period: Number.isFinite(period) && period > 0 ? Math.floor(period) : item.period,
      visible: typeof candidate?.visible === "boolean" ? candidate.visible : item.visible,
      color: normalizeColor(candidate?.color, item.color),
      lineWidth: normalizeLineWidth(candidate?.lineWidth, item.lineWidth)
    };
  });
};

const loadSettings = (timeframe: MaTimeframe): MaSetting[] => {
  if (typeof window === "undefined") return makeDefaultSettings(timeframe);
  const raw = window.localStorage.getItem(`maSettings:${timeframe}`);
  if (!raw) return makeDefaultSettings(timeframe);
  try {
    return normalizeSettings(timeframe, JSON.parse(raw));
  } catch {
    return makeDefaultSettings(timeframe);
  }
};

const persistSettings = (timeframe: MaTimeframe, settings: MaSetting[]) => {
  if (typeof window === "undefined") return;
  const payload = settings.map((item) => ({
    period: item.period,
    visible: item.visible,
    color: item.color,
    lineWidth: item.lineWidth
  }));
  window.localStorage.setItem(`maSettings:${timeframe}`, JSON.stringify(payload));
};

const getMaxPeriod = (settings: MaSetting[]) =>
  settings.reduce((max, setting) => Math.max(max, Math.max(1, setting.period)), 1);

const getRequiredBars = (settings: MaSetting[]) => {
  const desired = getMaxPeriod(settings) + THUMB_BARS - 1;
  return Math.min(MAX_BATCH_LIMIT, Math.max(MIN_BATCH_LIMIT, desired));
};

const getDailyLimitForWeekly = (settings: MaSetting[]) => {
  const weeklyBars = getRequiredBars(settings);
  return Math.min(MAX_BATCH_LIMIT, Math.max(MIN_BATCH_LIMIT, weeklyBars * WEEKLY_DAILY_FACTOR));
};

const normalizeDateParts = (year: number, month: number, day: number) => {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
};

const normalizeBarTime = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10_000_000_000_000) return Math.floor(value / 1000);
    if (value > 10_000_000_000) return Math.floor(value / 10);
    if (value >= 10_000_000 && value < 100_000_000) {
      const year = Math.floor(value / 10000);
      const month = Math.floor((value % 10000) / 100);
      const day = value % 100;
      return normalizeDateParts(year, month, day);
    }
    if (value >= 100_000 && value < 1_000_000) {
      const year = Math.floor(value / 100);
      const month = value % 100;
      return normalizeDateParts(year, month, 1);
    }
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{8}$/.test(trimmed)) {
      const year = Number(trimmed.slice(0, 4));
      const month = Number(trimmed.slice(4, 6));
      const day = Number(trimmed.slice(6, 8));
      return normalizeDateParts(year, month, day);
    }
    if (/^\d{6}$/.test(trimmed)) {
      const year = Number(trimmed.slice(0, 4));
      const month = Number(trimmed.slice(4, 6));
      return normalizeDateParts(year, month, 1);
    }
    const match = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      return normalizeDateParts(year, month, day);
    }
  }
  return null;
};

const buildWeeklyBars = (bars: number[][]) => {
  const groups = new Map<number, { o: number; h: number; l: number; c: number }>();
  for (const row of bars) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const time = normalizeBarTime(row[0]);
    if (time == null) continue;
    const date = new Date(time * 1000);
    const day = date.getUTCDay();
    const diff = (day + 6) % 7;
    const weekStart = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - diff
    );
    const key = Math.floor(weekStart / 1000);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { o: open, h: high, l: low, c: close });
    } else {
      existing.h = Math.max(existing.h, high);
      existing.l = Math.min(existing.l, low);
      existing.c = close;
    }
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, bar]) => [time, bar.o, bar.h, bar.l, bar.c]);
};

const getInitialTimeframe = (): Settings["gridTimeframe"] => {
  if (typeof window === "undefined") return "monthly";
  const saved = window.localStorage.getItem("gridTimeframe");
  return saved === "daily" || saved === "weekly" ? (saved as Settings["gridTimeframe"]) : "monthly";
};

export const useStore = create<StoreState>((set, get) => ({
  tickers: [],
  barsCache: { monthly: {}, weekly: {}, daily: {} },
  boxesCache: { monthly: {}, weekly: {}, daily: {} },
  barsLoading: { monthly: {}, weekly: {}, daily: {} },
  barsStatus: { monthly: {}, weekly: {}, daily: {} },
  loadingList: false,
  maSettings: {
    daily: loadSettings("daily"),
    weekly: loadSettings("weekly"),
    monthly: loadSettings("monthly")
  },
  settings: {
    columns: 3,
    search: "",
    gridScrollTop: 0,
    gridTimeframe: getInitialTimeframe(),
    showBoxes: true,
    sortMode: "trend-up"
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
  loadBarsBatch: async (timeframe, codes, limitOverride) => {
    const state = get();
    const loadingMap = state.barsLoading[timeframe];
    const trimmed = codes.filter((code) => !loadingMap[code]);
    if (!trimmed.length) return;

    if (timeframe === "weekly") {
      const dailyLimit = Math.max(
        limitOverride ?? 0,
        getDailyLimitForWeekly(get().maSettings.weekly)
      );
      try {
        const dailyCache = get().barsCache.daily;
        const dailyMissing = trimmed.filter((code) => {
          const payload = dailyCache[code];
          return !payload || payload.bars.length < dailyLimit;
        });
        if (dailyMissing.length) {
          await get().loadBarsBatch("daily", dailyMissing, dailyLimit);
        }
      } catch (error) {
        set((prev) => ({
          barsStatus: {
            ...prev.barsStatus,
            weekly: {
              ...prev.barsStatus.weekly,
              ...trimmed.reduce((acc, code) => {
                acc[code] = "error";
                return acc;
              }, {} as Record<string, "idle" | "loading" | "success" | "empty" | "error">)
            }
          }
        }));
        throw error;
      }
      set((prev) => {
        const weeklyItems: Record<string, BarsPayload> = {};
        const weeklyBoxes: Record<string, Box[]> = {};
        trimmed.forEach((code) => {
          const dailyPayload = prev.barsCache.daily[code];
          if (!dailyPayload) return;
          weeklyItems[code] = {
            bars: buildWeeklyBars(dailyPayload.bars),
            ma: { ma7: [], ma20: [], ma60: [] }
          };
          weeklyBoxes[code] = prev.boxesCache.daily[code] ?? [];
        });
        return {
          barsCache: {
            ...prev.barsCache,
            weekly: { ...prev.barsCache.weekly, ...weeklyItems }
          },
          boxesCache: {
            ...prev.boxesCache,
            weekly: { ...prev.boxesCache.weekly, ...weeklyBoxes }
          },
          barsStatus: {
            ...prev.barsStatus,
            weekly: {
              ...prev.barsStatus.weekly,
              ...trimmed.reduce((acc, code) => {
                const payload = weeklyItems[code];
                acc[code] = payload && payload.bars.length ? "success" : "empty";
                return acc;
              }, {} as Record<string, "idle" | "loading" | "success" | "empty" | "error">)
            }
          }
        };
      });
      return;
    }

    const nextLoading = { ...state.barsLoading[timeframe] };
    trimmed.forEach((code) => {
      nextLoading[code] = true;
    });
    set({
      barsLoading: { ...state.barsLoading, [timeframe]: nextLoading },
      barsStatus: {
        ...state.barsStatus,
        [timeframe]: {
          ...state.barsStatus[timeframe],
          ...trimmed.reduce((acc, code) => {
            acc[code] = "loading";
            return acc;
          }, {} as Record<string, "idle" | "loading" | "success" | "empty" | "error">)
        }
      }
    });

    try {
      const maSettings =
        timeframe === "daily" ? get().maSettings.daily : get().maSettings.monthly;
      const limit = Math.max(limitOverride ?? 0, getRequiredBars(maSettings));
      const payload = { url: "/api/batch_bars", timeframe, codes: trimmed, limit };
      console.debug("[batch_bars] request", payload);
      const res = await api.post("/batch_bars", {
        timeframe,
        codes: trimmed,
        limit
      });
      console.debug("[batch_bars] response", res.status, res.data);
      if (res.status !== 200) {
        throw new Error(`batch_bars failed with status ${res.status}`);
      }
      const items = (res.data?.items || {}) as Record<string, BarsPayload>;
      const boxesMonthly: Record<string, Box[]> = {};
      const boxesDaily: Record<string, Box[]> = {};
      Object.entries(items).forEach(([code, payload]) => {
        const boxes = payload.boxes ?? [];
        boxesMonthly[code] = boxes;
        boxesDaily[code] = boxes;
      });
      set((prev) => ({
        barsCache: {
          ...prev.barsCache,
          [timeframe]: { ...prev.barsCache[timeframe], ...items }
        },
        boxesCache: {
          monthly: { ...prev.boxesCache.monthly, ...boxesMonthly },
          daily: { ...prev.boxesCache.daily, ...boxesDaily }
        },
        barsStatus: {
          ...prev.barsStatus,
          [timeframe]: {
            ...prev.barsStatus[timeframe],
            ...trimmed.reduce((acc, code) => {
              const payload = items[code];
              acc[code] = payload && payload.bars.length ? "success" : "empty";
              return acc;
            }, {} as Record<string, "idle" | "loading" | "success" | "empty" | "error">)
          }
        }
      }));
    } catch (error) {
      set((prev) => ({
        barsStatus: {
          ...prev.barsStatus,
          [timeframe]: {
            ...prev.barsStatus[timeframe],
            ...trimmed.reduce((acc, code) => {
              acc[code] = "error";
              return acc;
            }, {} as Record<string, "idle" | "loading" | "success" | "empty" | "error">)
          }
        }
      }));
      throw error;
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
  loadBoxesBatch: async (codes) => {
    if (!codes.length) return;
    await get().loadBarsBatch("monthly", codes);
  },
  ensureBarsForVisible: async (timeframe, codes) => {
    const state = get();
    const cache = state.barsCache[timeframe];
    const maSettings = state.maSettings;
    const requiredBars =
      timeframe === "daily"
        ? getRequiredBars(maSettings.daily)
        : timeframe === "weekly"
        ? getRequiredBars(maSettings.weekly)
        : getRequiredBars(maSettings.monthly);
    const dailyLimitForWeekly =
      timeframe === "weekly" ? getDailyLimitForWeekly(maSettings.weekly) : null;
    const missing = codes.filter((code) => {
      const payload = cache[code];
      if (!payload) return true;
      if (timeframe === "weekly") {
        return payload.bars.length < requiredBars;
      }
      return payload.bars.length < requiredBars;
    });
    if (!missing.length) return;

    const batchSize = 48;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await get().loadBarsBatch(
        timeframe,
        batch,
        timeframe === "weekly" ? dailyLimitForWeekly ?? undefined : requiredBars
      );
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
  },
  setShowBoxes: (value) => {
    set((state) => ({ settings: { ...state.settings, showBoxes: value } }));
  },
  setSortMode: (value) => {
    set((state) => ({ settings: { ...state.settings, sortMode: value } }));
  },
  updateMaSetting: (timeframe, index, patch) => {
    set((state) => {
      const current = state.maSettings[timeframe][index];
      if (!current) return state;
      const next = [...state.maSettings[timeframe]];
      const updated: MaSetting = {
        ...current,
        ...patch,
        period:
          Number.isFinite(Number(patch.period)) && Number(patch.period) > 0
            ? Math.floor(Number(patch.period))
            : current.period,
        color: normalizeColor(patch.color ?? current.color, current.color),
        lineWidth: normalizeLineWidth(patch.lineWidth ?? current.lineWidth, current.lineWidth),
        visible: typeof patch.visible === "boolean" ? patch.visible : current.visible
      };
      next[index] = updated;
      persistSettings(timeframe, next);
      return { maSettings: { ...state.maSettings, [timeframe]: next } };
    });
  },
  resetMaSettings: (timeframe) => {
    set((state) => {
      const next = makeDefaultSettings(timeframe);
      persistSettings(timeframe, next);
      return { maSettings: { ...state.maSettings, [timeframe]: next } };
    });
  }
}));
