import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useBackendReadyState } from "../backendReady";
import DetailChart, { DetailChartHandle } from "../components/DetailChart";
import Toast from "../components/Toast";
import { useStore } from "../store";
import { computeSignalMetrics } from "../utils/signals";

type Timeframe = "daily" | "weekly" | "monthly";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isPartial?: boolean;
};

type VolumePoint = {
  time: number;
  value: number;
};

type DailyBar = Candle & {
  volume: number;
};

type BarsResponse = {
  data?: number[][];
  errors?: string[];
};

type PracticeTrade = {
  id: string;
  time: number;
  side: "buy" | "sell";
  action: "open" | "close";
  book: "long" | "short";
  quantity: number;
  price: number;
  lotSize?: number;
  kind?: "DAY_CONFIRM";
  note?: string;
};

type PracticeLedgerEntry = {
  trade: PracticeTrade;
  kind: "TRADE" | "DAY_CONFIRM";
  longLots: number;
  shortLots: number;
  avgLongPrice: number;
  avgShortPrice: number;
  realizedPnL: number;
  realizedDelta: number;
  positionText: string;
};

type OverlayTradeEvent = {
  date: string;
  code: string;
  name: string;
  side: "buy" | "sell";
  action: "open" | "close";
  units: number;
  price?: number;
  memo?: string;
};

type OverlayTradeMarker = {
  time: number;
  date: string;
  buyLots: number;
  sellLots: number;
  trades: OverlayTradeEvent[];
};

type OverlayPosition = {
  time: number;
  date: string;
  shortLots: number;
  longLots: number;
  posText: string;
  avgLongPrice: number;
  avgShortPrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  close: number;
};

type PracticeSession = {
  session_id: string;
  code: string;
  start_date?: string | null;
  end_date?: string | null;
  cursor_time?: number | null;
  max_unlocked_time?: number | null;
  lot_size?: number | null;
  range_months?: number | null;
  trades?: PracticeTrade[];
  notes?: string | null;
  ui_state?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type PracticeUiState = {
  panelCollapsed?: boolean;
  notesCollapsed?: boolean;
  tradeLogCollapsed?: boolean;
};

const DEFAULT_LIMITS = {
  daily: 2000
};

const LIMIT_STEP = {
  daily: 1000
};

const DAILY_ROW_RATIO = 12 / 16;

const QUANTITIES = [1, 2, 3, 5];
const DEFAULT_LOT_SIZE = 100;
const DEFAULT_RANGE_MONTHS = 6;
const EXPORT_MA_PERIODS = [7, 20, 60, 100, 200];
const EXPORT_ATR_PERIOD = 14;
const EXPORT_VOLUME_PERIOD = 20;
const EXPORT_SLOPE_LOOKBACK = 3;
const DEFAULT_WEEKLY_RATIO = 3 / 4;
const MIN_WEEKLY_RATIO = 0.2;
const MIN_MONTHLY_RATIO = 0.1;
const RANGE_PRESETS = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
  { label: "2Y", months: 24 }
];

const normalizeDateParts = (year: number, month: number, day: number) => {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
};

const normalizeTime = (value: unknown) => {
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

const buildDailyBars = (rows: number[][]) => {
  const entries: DailyBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const time = normalizeTime(row[0]);
    if (time == null) continue;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = row.length > 5 ? Number(row[5]) : 0;
    if (![open, high, low, close].every((value) => Number.isFinite(value))) {
      continue;
    }
    entries.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0
    });
  }
  entries.sort((a, b) => a.time - b.time);
  const deduped: DailyBar[] = [];
  let lastTime = -1;
  for (const item of entries) {
    if (item.time === lastTime) continue;
    deduped.push(item);
    lastTime = item.time;
  }
  return deduped;
};

const buildCandles = (bars: DailyBar[]) =>
  bars.map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    isPartial: bar.isPartial
  }));

const buildVolume = (bars: DailyBar[]): VolumePoint[] =>
  bars.map((bar) => ({ time: bar.time, value: bar.volume }));

const getWeekStartTime = (time: number) => {
  const date = new Date(time * 1000);
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const weekStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - diff
  );
  return Math.floor(weekStart / 1000);
};

const getMonthStartTime = (time: number) => {
  const date = new Date(time * 1000);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return Math.floor(monthStart / 1000);
};

const isPartialWeek = (time: number | null) => {
  if (time == null) return false;
  const date = new Date(time * 1000);
  const day = date.getUTCDay();
  return day !== 5;
};

const isPartialMonth = (time: number | null) => {
  if (time == null) return false;
  const date = new Date(time * 1000);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return date.getUTCDate() !== end.getUTCDate();
};

const buildAggregatedBars = (
  bars: DailyBar[],
  timeframe: "weekly" | "monthly",
  cursorTime: number | null
) => {
  const groups = new Map<number, DailyBar>();
  const isWeek = timeframe === "weekly";

  for (const bar of bars) {
    const key = isWeek ? getWeekStartTime(bar.time) : getMonthStartTime(bar.time);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        time: key,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }

  const sorted = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, bar]) => ({
      ...bar,
      time
    }));

  if (sorted.length) {
    const lastIndex = sorted.length - 1;
    const last = sorted[lastIndex];
    const partial = isWeek ? isPartialWeek(cursorTime) : isPartialMonth(cursorTime);
    last.isPartial = partial;
  }

  const candles = sorted.map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    isPartial: bar.isPartial
  }));
  const volume = sorted.map((bar) => ({ time: bar.time, value: bar.volume }));
  return { candles, volume, bars: sorted };
};

const computeMA = (candles: Candle[], period: number) => {
  if (period <= 1) {
    return candles.map((c) => ({ time: c.time, value: c.close }));
  }
  const data: { time: number; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      data.push({ time: candles[i].time, value: sum / period });
    }
  }
  return data;
};

const parseDateString = (value: string | null | undefined) => {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
};

const formatDate = (time: number) => {
  const date = new Date(time * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateSlash = (time: number) => {
  const date = new Date(time * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
};

const formatNumber = (value: number | null | undefined, digits = 0) => {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const subtractMonths = (time: number, months: number) => {
  const date = new Date(time * 1000);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCMonth(next.getUTCMonth() - months);
  return Math.floor(next.getTime() / 1000);
};

const addDays = (time: number, days: number) => time + days * 86400;

const clampValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getNextBusinessDay = (time: number) => {
  let next = addDays(time, 1);
  const day = new Date(next * 1000).getUTCDay();
  if (day === 6) {
    next = addDays(next, 2);
  } else if (day === 0) {
    next = addDays(next, 1);
  }
  return next;
};

const resolveCursorIndex = (candles: Candle[], targetTime: number) => {
  if (!candles.length) return null;
  const idx = candles.findIndex((candle) => candle.time >= targetTime);
  if (idx >= 0) return idx;
  return candles.length - 1;
};

const resolveIndexOnOrBefore = (candles: Candle[], targetTime: number) => {
  if (!candles.length) return null;
  let left = 0;
  let right = candles.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = candles[mid].time;
    if (midTime === targetTime) return mid;
    if (midTime < targetTime) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return Math.max(0, Math.min(candles.length - 1, right));
};

const resolveExactIndex = (candles: Candle[], targetTime: number) => {
  if (!candles.length) return null;
  let left = 0;
  let right = candles.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = candles[mid].time;
    if (midTime === targetTime) return mid;
    if (midTime < targetTime) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return null;
};

const buildPracticeLedger = (trades: PracticeTrade[], lotSize: number) => {
  let longLots = 0;
  let shortLots = 0;
  let longShares = 0;
  let shortShares = 0;
  let avgLongPrice = 0;
  let avgShortPrice = 0;
  let realizedPnL = 0;
  const entries: PracticeLedgerEntry[] = [];

  const resolveLotSize = (trade: PracticeTrade) => {
    const value = Number(trade.lotSize ?? lotSize);
    if (!Number.isFinite(value) || value <= 0) return lotSize;
    return value;
  };

  trades.forEach((trade) => {
    if (trade.kind === "DAY_CONFIRM") {
      entries.push({
        trade,
        kind: "DAY_CONFIRM",
        longLots,
        shortLots,
        avgLongPrice,
        avgShortPrice,
        realizedPnL,
        realizedDelta: 0,
        positionText: `${shortLots}-${longLots}`
      });
      return;
    }
    const qty = Math.max(0, Number(trade.quantity) || 0);
    const price = Number(trade.price) || 0;
    const tradeLotSize = resolveLotSize(trade);
    const shares = qty * tradeLotSize;
    let realizedDelta = 0;
    if (trade.book === "long") {
      if (trade.action === "open") {
        const nextShares = longShares + shares;
        avgLongPrice =
          nextShares > 0 ? (avgLongPrice * longShares + price * shares) / nextShares : 0;
        longShares = nextShares;
        longLots += qty;
      } else {
        const closingLots = Math.min(qty, longLots);
        const closingShares = Math.min(shares, longShares);
        realizedDelta = (price - avgLongPrice) * closingShares;
        realizedPnL += realizedDelta;
        longLots = Math.max(0, longLots - closingLots);
        longShares = Math.max(0, longShares - closingShares);
        if (longShares === 0) {
          avgLongPrice = 0;
        }
      }
    } else {
      if (trade.action === "open") {
        const nextShares = shortShares + shares;
        avgShortPrice =
          nextShares > 0 ? (avgShortPrice * shortShares + price * shares) / nextShares : 0;
        shortShares = nextShares;
        shortLots += qty;
      } else {
        const closingLots = Math.min(qty, shortLots);
        const closingShares = Math.min(shares, shortShares);
        realizedDelta = (avgShortPrice - price) * closingShares;
        realizedPnL += realizedDelta;
        shortLots = Math.max(0, shortLots - closingLots);
        shortShares = Math.max(0, shortShares - closingShares);
        if (shortShares === 0) {
          avgShortPrice = 0;
        }
      }
    }
    entries.push({
      trade,
      kind: "TRADE",
      longLots,
      shortLots,
      avgLongPrice,
      avgShortPrice,
      realizedPnL,
      realizedDelta,
      positionText: `${shortLots}-${longLots}`
    });
  });

  return {
    entries,
    summary: {
      longLots,
      shortLots,
      longShares,
      shortShares,
      avgLongPrice,
      avgShortPrice,
      realizedPnL
    }
  };
};

const buildPracticePositions = (
  bars: DailyBar[],
  trades: PracticeTrade[],
  lotSize: number,
  code?: string,
  name?: string
) => {
  const tradesByTime = new Map<number, PracticeTrade[]>();
  trades.forEach((trade) => {
    const list = tradesByTime.get(trade.time) ?? [];
    list.push(trade);
    tradesByTime.set(trade.time, list);
  });

  const resolveLotSize = (trade: PracticeTrade) => {
    const value = Number(trade.lotSize ?? lotSize);
    if (!Number.isFinite(value) || value <= 0) return lotSize;
    return value;
  };

  let longLots = 0;
  let shortLots = 0;
  let longShares = 0;
  let shortShares = 0;
  let avgLongPrice = 0;
  let avgShortPrice = 0;
  let realizedPnL = 0;

  const dailyPositions: OverlayPosition[] = [];
  const tradeMarkers: OverlayTradeMarker[] = [];

  bars.forEach((bar) => {
    const dayTrades = tradesByTime.get(bar.time) ?? [];
    let buyLots = 0;
    let sellLots = 0;
    const markerTrades: OverlayTradeEvent[] = [];

    dayTrades.forEach((trade) => {
      const qty = Math.max(0, Number(trade.quantity) || 0);
      const price = Number(trade.price) || 0;
      const tradeLotSize = resolveLotSize(trade);
      const shares = qty * tradeLotSize;
      if (trade.side === "buy") {
        buyLots += qty;
      } else {
        sellLots += qty;
      }
      markerTrades.push({
        date: formatDate(trade.time),
        code: code ?? "",
        name: name ?? "",
        side: trade.side,
        action: trade.action,
        units: qty,
        price: trade.price,
        memo: trade.note
      });

      if (trade.book === "long") {
        if (trade.action === "open") {
          const nextShares = longShares + shares;
          avgLongPrice =
            nextShares > 0 ? (avgLongPrice * longShares + price * shares) / nextShares : 0;
          longShares = nextShares;
          longLots += qty;
        } else {
          const closingLots = Math.min(qty, longLots);
          const closingShares = Math.min(shares, longShares);
          realizedPnL += (price - avgLongPrice) * closingShares;
          longLots = Math.max(0, longLots - closingLots);
          longShares = Math.max(0, longShares - closingShares);
          if (longShares === 0) {
            avgLongPrice = 0;
          }
        }
      } else {
        if (trade.action === "open") {
          const nextShares = shortShares + shares;
          avgShortPrice =
            nextShares > 0 ? (avgShortPrice * shortShares + price * shares) / nextShares : 0;
          shortShares = nextShares;
          shortLots += qty;
        } else {
          const closingLots = Math.min(qty, shortLots);
          const closingShares = Math.min(shares, shortShares);
          realizedPnL += (avgShortPrice - price) * closingShares;
          shortLots = Math.max(0, shortLots - closingLots);
          shortShares = Math.max(0, shortShares - closingShares);
          if (shortShares === 0) {
            avgShortPrice = 0;
          }
        }
      }
    });

    const unrealizedLong = longShares > 0 ? (bar.close - avgLongPrice) * longShares : 0;
    const unrealizedShort = shortShares > 0 ? (avgShortPrice - bar.close) * shortShares : 0;
    const unrealizedPnL = unrealizedLong + unrealizedShort;
    const totalPnL = realizedPnL + unrealizedPnL;
    const posText = `${shortLots}-${longLots}`;

    dailyPositions.push({
      time: bar.time,
      date: formatDate(bar.time),
      shortLots,
      longLots,
      posText,
      avgLongPrice,
      avgShortPrice,
      realizedPnL,
      unrealizedPnL,
      totalPnL,
      close: bar.close
    });

    if (markerTrades.length) {
      tradeMarkers.push({
        time: bar.time,
        date: formatDate(bar.time),
        buyLots,
        sellLots,
        trades: markerTrades
      });
    }
  });

  return { dailyPositions, tradeMarkers };
};

const parseBarsResponse = (payload: BarsResponse | number[][], label: string) => {
  if (Array.isArray(payload)) {
    return { rows: payload, errors: [] as string[] };
  }
  if (payload && Array.isArray(payload.data)) {
    return {
      rows: payload.data,
      errors: Array.isArray(payload.errors) ? payload.errors : []
    };
  }
  return { rows: [], errors: [`${label}_response_invalid`] };
};

const createSessionId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `practice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const findNearestCandle = (candles: Candle[], time: number) => {
  if (!candles.length) return null;
  let left = 0;
  let right = candles.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = candles[mid].time;
    if (midTime === time) return candles[mid];
    if (midTime < time) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  const lower = candles[Math.max(0, Math.min(candles.length - 1, right))];
  const upper = candles[Math.max(0, Math.min(candles.length - 1, left))];
  if (!lower) return upper;
  if (!upper) return lower;
  return Math.abs(time - lower.time) <= Math.abs(upper.time - time) ? lower : upper;
};

const exportFile = (filename: string, contents: string, type: string) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export default function PracticeView() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { ready: backendReady } = useBackendReadyState();
  const dailyChartRef = useRef<DetailChartHandle | null>(null);
  const weeklyChartRef = useRef<DetailChartHandle | null>(null);
  const monthlyChartRef = useRef<DetailChartHandle | null>(null);
  const cursorTimeRef = useRef<number | null>(null);
  const sessionChangeRef = useRef(0);
  const bottomRowRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);

  const tickers = useStore((state) => state.tickers);
  const loadList = useStore((state) => state.loadList);
  const loadingList = useStore((state) => state.loadingList);
  const maSettings = useStore((state) => state.maSettings);

  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [startDateDraft, setStartDateDraft] = useState<string>("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [notesCollapsed, setNotesCollapsed] = useState(true);
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [tradeLogCollapsed, setTradeLogCollapsed] = useState(true);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [maxUnlockedTime, setMaxUnlockedTime] = useState<number | null>(null);
  const [tradeNote, setTradeNote] = useState("");
  const [trades, setTrades] = useState<PracticeTrade[]>([]);
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_LIMITS.daily);
  const [dailyData, setDailyData] = useState<number[][]>([]);
  const [dailyErrors, setDailyErrors] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hover, setHover] = useState<{ time: number | null; source: Timeframe | null }>({
    time: null,
    source: null
  });
  const [weeklyRatio, setWeeklyRatio] = useState(DEFAULT_WEEKLY_RATIO);
  const [lotSize, setLotSize] = useState(DEFAULT_LOT_SIZE);
  const [rangeMonths, setRangeMonths] = useState(DEFAULT_RANGE_MONTHS);
  const [hasMoreDaily, setHasMoreDaily] = useState(true);
  const [loadingDaily, setLoadingDaily] = useState(false);

  const tickerName = useMemo(() => {
    if (!code) return "";
    const raw = tickers.find((item) => item.code === code)?.name ?? "";
    const cleaned = raw.replace(/\s*\?\s*$/, "").trim();
    return cleaned === "?" ? "" : cleaned;
  }, [tickers, code]);
  const sessionStorageKey = code ? `practice_session_id_${code}` : null;

  useEffect(() => {
    if (!backendReady) return;
    if (!tickers.length && !loadingList) {
      loadList();
    }
  }, [backendReady, tickers.length, loadingList, loadList]);

  const refreshSessions = () => {
    if (!backendReady || !code) return;
    setSessionsLoading(true);
    api
      .get("/practice/sessions", { params: { code } })
      .then((res) => {
        const payload = res.data as { sessions?: PracticeSession[] };
        const items = Array.isArray(payload.sessions) ? payload.sessions : [];
        setSessions(items);
        if (!items.length && !sessionId) {
          const nextId = createSessionId();
          const payload = {
            session_id: nextId,
            code,
            start_date: null,
            end_date: null,
            cursor_time: null,
            max_unlocked_time: null,
            lot_size: DEFAULT_LOT_SIZE,
            range_months: DEFAULT_RANGE_MONTHS,
            trades: [],
            notes: "",
            ui_state: { panelCollapsed: true, notesCollapsed: true, tradeLogCollapsed: true }
          };
          api.post("/practice/session", payload).finally(() => {
            setSessionId(nextId);
            refreshSessions();
          });
          return;
        }
        if (!sessionId || !items.some((item) => item.session_id === sessionId)) {
          const stored = sessionStorageKey ? localStorage.getItem(sessionStorageKey) : null;
          const fallback = items.find((item) => item.session_id === stored) ?? items[0] ?? null;
          if (fallback) {
            setSessionId(fallback.session_id);
          }
        }
      })
      .finally(() => setSessionsLoading(false));
  };

  useEffect(() => {
    refreshSessions();
  }, [backendReady, code]);

  useEffect(() => {
    if (!sessionStorageKey || !sessionId) return;
    localStorage.setItem(sessionStorageKey, sessionId);
  }, [sessionStorageKey, sessionId]);

  useEffect(() => {
    if (!backendReady || !sessionId) return;
    api
      .get("/practice/session", { params: { session_id: sessionId } })
      .then((res) => {
        const payload = res.data as { session?: PracticeSession | null };
        const session = payload.session;
        if (!session) return;
        if (code && session.code !== code) return;
        const sessionTrades = Array.isArray(session.trades) ? session.trades : [];
        const sessionStart = session.start_date ?? null;
        const sessionEnd = session.end_date ?? null;
        const sessionNotesValue = session.notes ?? "";
        const nextLotSize =
          Number.isFinite(Number(session.lot_size)) && Number(session.lot_size) > 0
            ? Number(session.lot_size)
            : DEFAULT_LOT_SIZE;
        const nextRangeMonths =
          Number.isFinite(Number(session.range_months)) && Number(session.range_months) > 0
            ? Number(session.range_months)
            : DEFAULT_RANGE_MONTHS;
        const uiState = (session.ui_state ?? {}) as PracticeUiState;
        setTrades(sessionTrades);
        setStartDate(sessionStart);
        setEndDate(sessionEnd);
        setStartDateDraft(sessionStart ?? "");
        setSessionNotes(sessionNotesValue);
        setLotSize(nextLotSize);
        setRangeMonths(nextRangeMonths);
        setCursorTime(session.cursor_time ?? null);
        setMaxUnlockedTime(session.max_unlocked_time ?? null);
        setPanelCollapsed(Boolean(uiState.panelCollapsed ?? true));
        setNotesCollapsed(Boolean(uiState.notesCollapsed ?? true));
        setTradeLogCollapsed(Boolean(uiState.tradeLogCollapsed ?? true));
        sessionChangeRef.current += 1;
      })
      .catch(() => {
        setTrades([]);
        setStartDate(null);
        setEndDate(null);
        setStartDateDraft("");
        setSessionNotes("");
        setTradeLogCollapsed(true);
      });
  }, [backendReady, sessionId, code]);


  const persistSession = (next: Partial<{
    startDate: string | null;
    endDate: string | null;
    cursorTime: number | null;
    maxUnlockedTime: number | null;
    trades: PracticeTrade[];
    notes: string;
    lotSize: number;
    rangeMonths: number;
    uiState: PracticeUiState;
  }>) => {
    if (!sessionId || !code) return;
    const payload = {
      session_id: sessionId,
      code,
      start_date: next.startDate !== undefined ? next.startDate : startDate,
      end_date: next.endDate !== undefined ? next.endDate : endDate,
      cursor_time: next.cursorTime !== undefined ? next.cursorTime : cursorTime,
      max_unlocked_time:
        next.maxUnlockedTime !== undefined ? next.maxUnlockedTime : maxUnlockedTime,
      lot_size: next.lotSize !== undefined ? next.lotSize : lotSize,
      range_months: next.rangeMonths !== undefined ? next.rangeMonths : rangeMonths,
      trades: next.trades !== undefined ? next.trades : trades,
      notes: next.notes !== undefined ? next.notes : sessionNotes,
      ui_state:
        next.uiState !== undefined
          ? next.uiState
          : { panelCollapsed, notesCollapsed, tradeLogCollapsed }
    };
    api.post("/practice/session", payload).catch(() => {
      setToastMessage("セッションの保存に失敗しました。");
    });
  };

  useEffect(() => {
    if (!backendReady || !code) return;
    setLoadingDaily(true);
    setDailyErrors([]);
    api
      .get("/practice/daily", {
        params: {
          code,
          limit: dailyLimit
        }
      })
      .then((res) => {
        const { rows, errors } = parseBarsResponse(res.data as BarsResponse | number[][], "daily");
        setDailyData(rows);
        setDailyErrors(errors);
        setHasMoreDaily(rows.length >= dailyLimit);
      })
      .catch((error) => {
        const message = error?.message || "Daily fetch failed";
        setDailyErrors([message]);
      })
      .finally(() => setLoadingDaily(false));
  }, [backendReady, code, dailyLimit]);

  const dailyBars = useMemo(() => buildDailyBars(dailyData), [dailyData]);
  const sessionStartTime = useMemo(() => parseDateString(startDate), [startDate]);
  const sessionEndTime = useMemo(() => parseDateString(endDate), [endDate]);

  useEffect(() => {
    if (!dailyBars.length) return;
    if (cursorTime == null) {
      const fallbackTime = sessionStartTime ?? dailyBars[dailyBars.length - 1].time;
      const idx = resolveCursorIndex(dailyBars, fallbackTime);
      const nextTime = dailyBars[idx]?.time ?? dailyBars[dailyBars.length - 1].time;
      setCursorTime(nextTime);
      if (maxUnlockedTime == null) {
        setMaxUnlockedTime(nextTime);
      }
      return;
    }
    const idx = resolveCursorIndex(dailyBars, cursorTime);
    const resolved = dailyBars[idx]?.time;
    if (resolved != null && resolved != cursorTime) {
      setCursorTime(resolved);
    }
    if (maxUnlockedTime != null) {
      const maxIdx = resolveCursorIndex(dailyBars, maxUnlockedTime);
      const resolvedMax = dailyBars[maxIdx]?.time;
      if (resolvedMax != null && resolvedMax != maxUnlockedTime) {
        setMaxUnlockedTime(resolvedMax);
      }
    }
  }, [dailyBars, cursorTime, maxUnlockedTime, sessionStartTime]);

  useEffect(() => {
    cursorTimeRef.current = cursorTime ?? null;
  }, [cursorTime]);

  useEffect(() => {
    if (!sessionId) return;
    if (cursorTime == null && maxUnlockedTime == null) return;
    persistSession({ cursorTime, maxUnlockedTime });
  }, [cursorTime, maxUnlockedTime, sessionId]);

  useEffect(() => {
    if (!dailyBars.length || sessionEndTime == null) return;
    const endIdx = resolveIndexOnOrBefore(dailyBars, sessionEndTime);
    const endTime = endIdx != null ? dailyBars[endIdx]?.time : null;
    if (endTime == null) return;
    if (cursorTime != null && cursorTime > endTime) {
      setCursorTime(endTime);
    }
    if (maxUnlockedTime != null && maxUnlockedTime > endTime) {
      setMaxUnlockedTime(endTime);
    }
  }, [dailyBars, sessionEndTime, cursorTime, maxUnlockedTime]);

  const cursorIndex = useMemo(
    () => (cursorTime != null ? resolveCursorIndex(dailyBars, cursorTime) : null),
    [dailyBars, cursorTime]
  );
  const maxUnlockedIndex = useMemo(() => {
    if (maxUnlockedTime != null) {
      return resolveCursorIndex(dailyBars, maxUnlockedTime);
    }
    return cursorIndex;
  }, [dailyBars, maxUnlockedTime, cursorIndex]);

  const sessionStartIndex = useMemo(() => {
    if (!dailyBars.length) return null;
    if (sessionStartTime == null) return 0;
    return resolveCursorIndex(dailyBars, sessionStartTime);
  }, [dailyBars, sessionStartTime]);

  const sessionEndIndex = useMemo(() => {
    if (!dailyBars.length) return null;
    if (sessionEndTime == null) return dailyBars.length - 1;
    return resolveIndexOnOrBefore(dailyBars, sessionEndTime);
  }, [dailyBars, sessionEndTime]);

  const cursorCandle = cursorIndex != null ? dailyBars[cursorIndex] : null;

  const rangeStartTime = useMemo(() => {
    if (cursorTime == null || !dailyBars.length) return null;
    let start = subtractMonths(cursorTime, rangeMonths);
    const earliest = dailyBars[0]?.time;
    if (earliest != null) {
      start = Math.max(start, earliest);
    }
    return start;
  }, [cursorTime, rangeMonths, dailyBars]);

  const trainingBars = useMemo(() => {
    if (!dailyBars.length) return [];
    const endTime = cursorTime ?? dailyBars[dailyBars.length - 1].time;
    return dailyBars.filter((bar) => bar.time <= endTime);
  }, [dailyBars, cursorTime]);

  const visibleDailyBars = useMemo(() => {
    if (!trainingBars.length) return [];
    const startTime = rangeStartTime ?? trainingBars[0].time;
    const endTime = cursorTime ?? trainingBars[trainingBars.length - 1].time;
    return trainingBars.filter((bar) => bar.time >= startTime && bar.time <= endTime);
  }, [trainingBars, rangeStartTime, cursorTime]);

  const weeklyAggregate = useMemo(
    () => buildAggregatedBars(trainingBars, "weekly", cursorTime),
    [trainingBars, cursorTime]
  );
  const monthlyAggregate = useMemo(
    () => buildAggregatedBars(trainingBars, "monthly", cursorTime),
    [trainingBars, cursorTime]
  );

  const weeklyBars = useMemo(() => {
    if (!weeklyAggregate.bars.length) return [];
    const startTime = rangeStartTime ?? weeklyAggregate.bars[0].time;
    const endTime = cursorTime ?? weeklyAggregate.bars[weeklyAggregate.bars.length - 1].time;
    return weeklyAggregate.bars.filter((bar) => bar.time >= startTime && bar.time <= endTime);
  }, [weeklyAggregate.bars, rangeStartTime, cursorTime]);

  const monthlyBars = useMemo(() => {
    if (!monthlyAggregate.bars.length) return [];
    const startTime = rangeStartTime ?? monthlyAggregate.bars[0].time;
    const endTime = cursorTime ?? monthlyAggregate.bars[monthlyAggregate.bars.length - 1].time;
    return monthlyAggregate.bars.filter((bar) => bar.time >= startTime && bar.time <= endTime);
  }, [monthlyAggregate.bars, rangeStartTime, cursorTime]);

  const trainingCandles = useMemo(() => buildCandles(trainingBars), [trainingBars]);
  const dailyCandles = useMemo(() => buildCandles(visibleDailyBars), [visibleDailyBars]);
  const dailyVolume = useMemo(() => buildVolume(visibleDailyBars), [visibleDailyBars]);
  const weeklyCandlesAll = useMemo(() => buildCandles(weeklyAggregate.bars), [weeklyAggregate.bars]);
  const weeklyCandles = useMemo(() => buildCandles(weeklyBars), [weeklyBars]);
  const weeklyVolume = useMemo(() => buildVolume(weeklyBars), [weeklyBars]);
  const monthlyCandlesAll = useMemo(() => buildCandles(monthlyAggregate.bars), [monthlyAggregate.bars]);
  const monthlyCandles = useMemo(() => buildCandles(monthlyBars), [monthlyBars]);
  const monthlyVolume = useMemo(() => buildVolume(monthlyBars), [monthlyBars]);

  const dailyMaLines = useMemo(() => {
    const start = rangeStartTime ?? (trainingCandles[0]?.time ?? 0);
    const end = cursorTime ?? (trainingCandles[trainingCandles.length - 1]?.time ?? 0);
    return maSettings.daily.map((setting) => {
      const data = computeMA(trainingCandles, setting.period).filter(
        (point) => point.time >= start && point.time <= end
      );
      return {
        key: setting.key,
        label: setting.label,
        period: setting.period,
        color: setting.color,
        lineWidth: setting.lineWidth,
        visible: setting.visible,
        data
      };
    });
  }, [trainingCandles, maSettings.daily, rangeStartTime, cursorTime]);

  const weeklyMaLines = useMemo(() => {
    const start = rangeStartTime ?? (weeklyCandlesAll[0]?.time ?? 0);
    const end = cursorTime ?? (weeklyCandlesAll[weeklyCandlesAll.length - 1]?.time ?? 0);
    return maSettings.weekly.map((setting) => {
      const data = computeMA(weeklyCandlesAll, setting.period).filter(
        (point) => point.time >= start && point.time <= end
      );
      return {
        key: setting.key,
        label: setting.label,
        period: setting.period,
        color: setting.color,
        lineWidth: setting.lineWidth,
        visible: setting.visible,
        data
      };
    });
  }, [weeklyCandlesAll, maSettings.weekly, rangeStartTime, cursorTime]);

  const monthlyMaLines = useMemo(() => {
    const start = rangeStartTime ?? (monthlyCandlesAll[0]?.time ?? 0);
    const end = cursorTime ?? (monthlyCandlesAll[monthlyCandlesAll.length - 1]?.time ?? 0);
    return maSettings.monthly.map((setting) => {
      const data = computeMA(monthlyCandlesAll, setting.period).filter(
        (point) => point.time >= start && point.time <= end
      );
      return {
        key: setting.key,
        label: setting.label,
        period: setting.period,
        color: setting.color,
        lineWidth: setting.lineWidth,
        visible: setting.visible,
        data
      };
    });
  }, [monthlyCandlesAll, maSettings.monthly, rangeStartTime, cursorTime]);

  const visibleTrades = useMemo(
    () => trades.filter((trade) => (cursorTime == null ? true : trade.time <= cursorTime)),
    [trades, cursorTime]
  );

  const ledger = useMemo(() => buildPracticeLedger(visibleTrades, lotSize), [visibleTrades, lotSize]);
  const positionSummary = ledger.summary;
  const netLots = positionSummary.longLots - positionSummary.shortLots;

  const latestDailyClose = cursorCandle?.close ?? null;
  const longShares = positionSummary.longShares ?? positionSummary.longLots * lotSize;
  const shortShares = positionSummary.shortShares ?? positionSummary.shortLots * lotSize;
  const unrealizedPnL =
    latestDailyClose != null
      ? (latestDailyClose - positionSummary.avgLongPrice) * longShares +
        (positionSummary.avgShortPrice - latestDailyClose) * shortShares
      : null;

  const practicePositionData = useMemo(
    () => buildPracticePositions(trainingBars, visibleTrades, lotSize, code, tickerName),
    [trainingBars, visibleTrades, lotSize, code, tickerName]
  );
  const dailyPositions = practicePositionData.dailyPositions;
  const tradeMarkers = practicePositionData.tradeMarkers;

  const weeklyCursorTime = cursorTime != null ? getWeekStartTime(cursorTime) : null;
  const monthlyCursorTime = cursorTime != null ? getMonthStartTime(cursorTime) : null;

  const weeklyPartialTimes = useMemo(() => {
    const last = weeklyBars[weeklyBars.length - 1];
    return last?.isPartial ? [last.time] : [];
  }, [weeklyBars]);

  const monthlyPartialTimes = useMemo(() => {
    const last = monthlyBars[monthlyBars.length - 1];
    return last?.isPartial ? [last.time] : [];
  }, [monthlyBars]);

  const monthlyRatio = 1 - weeklyRatio;

  const isLocked = cursorTime != null && maxUnlockedTime != null && cursorTime < maxUnlockedTime;

  const progressIndex = useMemo(() => {
    if (cursorIndex == null || sessionStartIndex == null) return null;
    return Math.max(1, cursorIndex - sessionStartIndex + 1);
  }, [cursorIndex, sessionStartIndex]);

  const minStepIndex = sessionStartIndex ?? 0;
  const maxStepIndex = sessionEndIndex ?? (dailyBars.length ? dailyBars.length - 1 : 0);
  const currentStepIndex = cursorIndex ?? maxStepIndex;
  const frontierIndex = maxUnlockedIndex ?? currentStepIndex;
  const maxAdvanceIndex = currentStepIndex < frontierIndex ? frontierIndex : maxStepIndex;
  const canStepBack = dailyBars.length > 0 && currentStepIndex > minStepIndex;
  const canStepForward = dailyBars.length > 0 && currentStepIndex < maxAdvanceIndex;
  const headerDateLabel = cursorCandle ? formatDateSlash(cursorCandle.time) : "--";
  const headerDayLabel = progressIndex != null ? `${progressIndex}日目` : "--";
  const headerMetaLabel =
    cursorCandle && progressIndex != null ? `${headerDateLabel} (${headerDayLabel})` : headerDateLabel;
  const guideText = useMemo(() => {
    if (sessions.length === 0) return "まず「新規」で練習を作成してください";
    if (!sessionId) return "セッションを選択してください";
    if (!startDate) return "開始日を選んで「開始日を確定」を押してください";
    if (isLocked) return "過去日を表示中です。最新日に戻ると操作できます";
    return "建玉を操作して「翌日」で進めます（→キーでも可）";
  }, [sessions.length, sessionId, startDate, isLocked]);
  const sessionBadgeLabel = sessionId ? (endDate ? "完了" : "進行中") : "未作成";
  const sessionBadgeClass = sessionId ? (endDate ? "is-ended" : "is-active") : "is-empty";
  const sessionRangeLabel = sessionId
    ? `開始 ${startDate ?? "--"} / 終了 ${endDate ?? "--"}`
    : "セッション未作成";
  const canUndo =
    !isLocked &&
    cursorTime != null &&
    trades.length > 0 &&
    trades[trades.length - 1]?.time === cursorTime;
  const canResetDay =
    !isLocked && cursorTime != null && trades.some((trade) => trade.time === cursorTime);

  const handleStep = (direction: 1 | -1) => {
    if (!dailyBars.length) return;
    const minIndex = minStepIndex;
    const maxIndex = maxStepIndex;
    const currentIndex = cursorIndex ?? maxIndex;
    let nextIndex = currentIndex;
    let nextMaxUnlocked = maxUnlockedTime ?? null;

    if (direction < 0) {
      nextIndex = Math.max(currentIndex - 1, minIndex);
    } else {
      if (maxUnlockedIndex != null && currentIndex < maxUnlockedIndex) {
        nextIndex = Math.min(currentIndex + 1, maxUnlockedIndex);
      } else {
        nextIndex = Math.min(currentIndex + 1, maxIndex);
        const candidate = dailyBars[nextIndex]?.time ?? null;
        if (candidate != null && (nextMaxUnlocked == null || candidate > nextMaxUnlocked)) {
          nextMaxUnlocked = candidate;
        }
      }
    }

    const nextTime = dailyBars[nextIndex]?.time;
    if (nextTime == null) return;
    setCursorTime(nextTime);
    if (nextMaxUnlocked != null && nextMaxUnlocked !== maxUnlockedTime) {
      setMaxUnlockedTime(nextMaxUnlocked);
    }
    persistSession({ cursorTime: nextTime, maxUnlockedTime: nextMaxUnlocked });
  };

  const togglePanel = (force?: boolean) => {
    setPanelCollapsed((prev) => {
      const next = typeof force === "boolean" ? force : !prev;
      persistSession({
        uiState: { panelCollapsed: next, notesCollapsed, tradeLogCollapsed }
      });
      return next;
    });
  };

  const toggleNotes = () => {
    setNotesCollapsed((prev) => {
      const next = !prev;
      persistSession({
        uiState: { panelCollapsed, notesCollapsed: next, tradeLogCollapsed }
      });
      return next;
    });
  };

  const toggleTradeLog = () => {
    setTradeLogCollapsed((prev) => {
      const next = !prev;
      persistSession({
        uiState: { panelCollapsed, notesCollapsed, tradeLogCollapsed: next }
      });
      return next;
    });
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleStep(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleStep(-1);
        return;
      }
      if (event.key.toLowerCase() === "p") {
        togglePanel();
        return;
      }
      if (event.key === "Escape") {
        togglePanel(true);
        return;
      }
      if (event.key.toLowerCase() === "m") {
        toggleNotes();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleStep, notesCollapsed, panelCollapsed]);

  useEffect(() => {
    const handleMove = (event: MouseEvent | TouchEvent) => {
      if (!resizingRef.current || !bottomRowRef.current) return;
      let clientX = 0;
      if ("touches" in event) {
        if (!event.touches.length) return;
        event.preventDefault();
        clientX = event.touches[0].clientX;
      } else {
        clientX = event.clientX;
      }
      const rect = bottomRowRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const position = clampValue((clientX - rect.left) / rect.width, 0.05, 0.95);
      const nextWeekly = clampValue(position, MIN_WEEKLY_RATIO, 1 - MIN_MONTHLY_RATIO);
      setWeeklyRatio(nextWeekly);
    };

    const handleUp = () => {
      resizingRef.current = false;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, []);

  const startResize = () => (event: ReactMouseEvent | ReactTouchEvent) => {
    event.preventDefault();
    resizingRef.current = true;
  };

  const resolveActiveCandle = () => {
    if (cursorCandle) return cursorCandle;
    if (dailyBars.length) return dailyBars[dailyBars.length - 1];
    return null;
  };

  const handleDailyCrosshair = (time: number | null, point?: { x: number; y: number } | null) => {
    setHover({ time, source: time ? "daily" : null });
    weeklyChartRef.current?.setCrosshair(time, null);
    monthlyChartRef.current?.setCrosshair(time, null);
  };

  const handleWeeklyCrosshair = (time: number | null, point?: { x: number; y: number } | null) => {
    setHover({ time, source: time ? "weekly" : null });
    dailyChartRef.current?.setCrosshair(time, null);
    monthlyChartRef.current?.setCrosshair(time, null);
  };

  const handleMonthlyCrosshair = (time: number | null, point?: { x: number; y: number } | null) => {
    setHover({ time, source: time ? "monthly" : null });
    dailyChartRef.current?.setCrosshair(time, null);
    weeklyChartRef.current?.setCrosshair(time, null);
  };

  const pushTrade = (trade: PracticeTrade) => {
    const nextTrades = [...trades, trade];
    setTrades(nextTrades);
    persistSession({ trades: nextTrades });
  };

  const handleHudAction = (side: "buy" | "sell", delta: number) => {
    if (!code) return;
    if (isLocked) {
      setToastMessage("過去の日時では編集できません");
      return;
    }
    const candle = cursorCandle ?? resolveActiveCandle();
    if (!candle) {
      setToastMessage("チャートデータがありません");
      return;
    }
    const qty = Math.abs(delta);
    const isBuy = side === "buy";
    const action = delta > 0 ? "open" : "close";
    const book = isBuy ? "long" : "short";
    const actualSide =
      isBuy && action === "open"
        ? "buy"
        : isBuy
        ? "sell"
        : action === "open"
        ? "sell"
        : "buy";
    const available = book === "long" ? positionSummary.longLots : positionSummary.shortLots;
    const finalQty = action === "close" ? Math.min(qty, available) : qty;
    if (action === "close" && finalQty <= 0) {
      setToastMessage("減玉できる建玉がありません");
      return;
    }
    const trade: PracticeTrade = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: candle.time,
      side: actualSide,
      action,
      book,
      quantity: finalQty,
      price: candle.close,
      lotSize,
      note: tradeNote.trim() ? tradeNote.trim() : undefined
    };
    pushTrade(trade);
  };

  const handleUndo = () => {
    if (!trades.length || cursorTime == null || isLocked) return;
    const last = trades[trades.length - 1];
    if (!last || last.time !== cursorTime) return;
    const next = trades.slice(0, -1);
    setTrades(next);
    persistSession({ trades: next });
  };

  const handleResetDay = () => {
    if (cursorTime == null || isLocked) return;
    const next = trades.filter((trade) => trade.time !== cursorTime);
    if (next.length === trades.length) return;
    setTrades(next);
    persistSession({ trades: next });
  };

  const handleDeleteTrade = (id: string) => {
    if (isLocked || cursorTime == null) return;
    const target = trades.find((trade) => trade.id === id);
    if (!target || target.time !== cursorTime) return;
    const next = trades.filter((trade) => trade.id !== id);
    setTrades(next);
    persistSession({ trades: next });
  };

  const handleEditTrade = (id: string, patch: Partial<PracticeTrade>) => {
    if (isLocked || cursorTime == null) return;
    const target = trades.find((trade) => trade.id === id);
    if (!target || target.time !== cursorTime) return;
    const next = trades.map((trade) => (trade.id === id ? { ...trade, ...patch } : trade));
    setTrades(next);
    persistSession({ trades: next });
  };

  useEffect(() => {
    if (!editingTradeId) return;
    const target = trades.find((trade) => trade.id === editingTradeId);
    if (!target || cursorTime == null || target.time !== cursorTime || isLocked) {
      setEditingTradeId(null);
    }
  }, [editingTradeId, trades, cursorTime, isLocked]);

  const handleCreateSession = () => {
    if (!code) return;
    const nextId = createSessionId();
    const lastEndDate = sessions.find((item) => item.end_date)?.end_date ?? null;
    const nextStart = (() => {
      if (lastEndDate) {
        const endTime = parseDateString(lastEndDate);
        if (endTime != null) {
          return formatDate(getNextBusinessDay(endTime));
        }
        return lastEndDate;
      }
      return cursorCandle ? formatDate(cursorCandle.time) : null;
    })();
    const payload = {
      session_id: nextId,
      code,
      start_date: nextStart,
      end_date: null,
      cursor_time: null,
      max_unlocked_time: null,
      lot_size: DEFAULT_LOT_SIZE,
      range_months: DEFAULT_RANGE_MONTHS,
      trades: [],
      notes: "",
      ui_state: { panelCollapsed: true, notesCollapsed: true, tradeLogCollapsed: true }
    };
    api.post("/practice/session", payload).finally(() => {
      setSessionId(nextId);
      refreshSessions();
    });
  };

  const handleSelectSession = (nextId: string) => {
    if (nextId === sessionId) return;
    setSessionId(nextId);
  };

  const handleEndSession = () => {
    if (!cursorCandle) return;
    const date = formatDate(cursorCandle.time);
    setEndDate(date);
    persistSession({ endDate: date });
  };


  const handleDeleteSession = (targetId?: string) => {
    const id = targetId ?? sessionId;
    if (!id) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("このセッションを削除しますか？");
      if (!ok) return;
    }
    api
      .delete("/practice/session", { params: { session_id: id } })
      .finally(() => {
        if (sessionStorageKey) {
          localStorage.removeItem(sessionStorageKey);
        }
        if (id === sessionId) {
          setSessionId(null);
          setStartDate(null);
          setEndDate(null);
          setStartDateDraft("");
          setTrades([]);
          setSessionNotes("");
          setCursorTime(null);
          setMaxUnlockedTime(null);
          setHover({ time: null, source: null });
        }
        refreshSessions();
      });
  };


  const buildExportPayload = () => {
    const exportedAt = new Date().toISOString();
    const cursorLabel = cursorTime != null ? formatDate(cursorTime) : null;
    const rangeStartLabel = rangeStartTime != null ? formatDate(rangeStartTime) : cursorLabel;
    const selectedRange =
      rangeMonths === 12 ? "1Y" : rangeMonths === 24 ? "2Y" : `${rangeMonths}M`;

    const lastIndex = dailyBars.length ? dailyBars.length - 1 : 0;
    const cursorIdx = cursorIndex != null ? cursorIndex : lastIndex;
    const warmupDepth = Math.max(
      EXPORT_MA_PERIODS[EXPORT_MA_PERIODS.length - 1],
      EXPORT_ATR_PERIOD,
      EXPORT_VOLUME_PERIOD
    );
    const warmupStartIndex = Math.max(0, cursorIdx - warmupDepth - 5);
    const warmupBars = dailyBars.slice(warmupStartIndex, cursorIdx + 1);
    const warmupStartTime = warmupBars[0]?.time ?? null;

    const buildSignalSeries = (bars: DailyBar[], timeframe: "D" | "W" | "M") => {
      const hits: {
        date: string;
        timeframe: "D" | "W" | "M";
        ruleId: string;
        label: string;
        value: string;
        tags: string[];
      }[] = [];
      const byTime = new Map<number, { labels: string[] }>();
      const rows = bars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume]);
      for (let i = 0; i < bars.length; i += 1) {
        const metrics = computeSignalMetrics(rows.slice(0, i + 1));
        const labels = metrics.signals.map((signal) => signal.label);
        byTime.set(bars[i].time, { labels });
        metrics.signals.forEach((signal) => {
          hits.push({
            date: formatDate(bars[i].time),
            timeframe,
            ruleId: signal.label,
            label: signal.label,
            value: signal.kind,
            tags: [signal.kind]
          });
        });
      }
      return { byTime, hits };
    };

    const buildExportBars = (
      bars: DailyBar[],
      signalMap: Map<number, { labels: string[] }>
    ) => {
      const candles = bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close
      }));
      const maMaps = new Map<number, Record<number, number>>();
      EXPORT_MA_PERIODS.forEach((period) => {
        computeMA(candles, period).forEach((point) => {
          const existing = maMaps.get(point.time) ?? {};
          existing[period] = point.value;
          maMaps.set(point.time, existing);
        });
      });

      const countState = new Map<number, { up: number; down: number }>();
      EXPORT_MA_PERIODS.forEach((period) => countState.set(period, { up: 0, down: 0 }));
      let prevClose: number | null = null;
      const trWindow: number[] = [];
      let trSum = 0;
      const volumeWindow: number[] = [];
      let volumeSum = 0;

      const rows = bars.map((bar, index) => {
        const maValues = maMaps.get(bar.time) ?? {};
        const count: Record<string, number | null> = {};
        let aboveCount = 0;
        let belowCount = 0;

        EXPORT_MA_PERIODS.forEach((period) => {
          const maValue = maValues[period];
          const state = countState.get(period) ?? { up: 0, down: 0 };
          if (maValue == null || !Number.isFinite(maValue)) {
            state.up = 0;
            state.down = 0;
          } else if (bar.close > maValue) {
            state.up += 1;
            state.down = 0;
            aboveCount += 1;
          } else if (bar.close < maValue) {
            state.down += 1;
            state.up = 0;
            belowCount += 1;
          } else {
            state.up = 0;
            state.down = 0;
          }
          countState.set(period, state);
          count[`up${period}`] = state.up;
          count[`down${period}`] = state.down;
        });

        const tr = prevClose == null
          ? bar.high - bar.low
          : Math.max(
              bar.high - bar.low,
              Math.abs(bar.high - prevClose),
              Math.abs(bar.low - prevClose)
            );
        prevClose = bar.close;
        trWindow.push(tr);
        trSum += tr;
        if (trWindow.length > EXPORT_ATR_PERIOD) {
          trSum -= trWindow.shift() ?? 0;
        }
        const atr14 = trWindow.length >= EXPORT_ATR_PERIOD ? trSum / EXPORT_ATR_PERIOD : null;

        const volume = Number.isFinite(bar.volume) ? bar.volume : 0;
        volumeWindow.push(volume);
        volumeSum += volume;
        if (volumeWindow.length > EXPORT_VOLUME_PERIOD) {
          volumeSum -= volumeWindow.shift() ?? 0;
        }
        const volumeRatio =
          volumeWindow.length >= EXPORT_VOLUME_PERIOD && volumeSum > 0
            ? volume / (volumeSum / volumeWindow.length)
            : null;

        const body = Math.abs(bar.close - bar.open);
        const range = Math.max(0, bar.high - bar.low);
        const upperWick = bar.high - Math.max(bar.open, bar.close);
        const lowerWick = Math.min(bar.open, bar.close) - bar.low;
        const bodyRatio = range > 0 ? body / range : 0;
        const direction = bar.close >= bar.open ? "up" : "down";

        const ma20 = maValues[20] ?? null;
        let slope20: number | null = null;
        if (index >= EXPORT_SLOPE_LOOKBACK && ma20 != null) {
          const pastBar = bars[index - EXPORT_SLOPE_LOOKBACK];
          const pastMa20 = maMaps.get(pastBar.time)?.[20] ?? null;
          if (pastMa20 != null) {
            slope20 = ma20 - pastMa20;
          }
        }

        return {
          date: formatDate(bar.time),
          o: bar.open,
          h: bar.high,
          l: bar.low,
          c: bar.close,
          v: bar.volume,
          ma: {
            ma7: maValues[7] ?? null,
            ma20: maValues[20] ?? null,
            ma60: maValues[60] ?? null,
            ma100: maValues[100] ?? null,
            ma200: maValues[200] ?? null
          },
          slope: {
            ma20: slope20
          },
          pos: {
            aboveCount,
            belowCount
          },
          count,
          candle: {
            body,
            range,
            upperWick,
            lowerWick,
            bodyRatio,
            direction
          },
          atr14,
          volumeRatio,
          isPartial: Boolean(bar.isPartial),
          signalsRaw: signalMap.get(bar.time) ?? { labels: [] }
        };
      });

      return rows.filter((row) => {
        if (rangeStartTime == null) return true;
        const time = parseDateString(row.date);
        return time != null && time >= rangeStartTime;
      });
    };

    const dailySignals = buildSignalSeries(warmupBars, "D");
    const weeklySignals = buildSignalSeries(weeklyAggregate.bars, "W");
    const monthlySignals = buildSignalSeries(monthlyAggregate.bars, "M");

    const dailyExportBars = buildExportBars(warmupBars, dailySignals.byTime);
    const weeklyExportBars = buildExportBars(weeklyAggregate.bars, weeklySignals.byTime);
    const monthlyExportBars = buildExportBars(monthlyAggregate.bars, monthlySignals.byTime);

    const rangeTrades = visibleTrades.filter((trade) => {
      if (cursorTime != null && trade.time > cursorTime) return false;
      if (rangeStartTime != null && trade.time < rangeStartTime) return false;
      return true;
    });

    const beforeRangeTrades = visibleTrades.filter((trade) =>
      rangeStartTime != null ? trade.time < rangeStartTime : false
    );
    const rangeSnapshot = buildPracticeLedger(beforeRangeTrades, lotSize).summary;

    const positionByDate = dailyPositions
      .filter((pos) => (rangeStartTime == null ? true : pos.time >= rangeStartTime))
      .map((pos) => ({
        date: pos.date,
        time: pos.time,
        longLots: pos.longLots,
        shortLots: pos.shortLots,
        avgLongPrice: pos.avgLongPrice,
        avgShortPrice: pos.avgShortPrice,
        realizedPnL: pos.realizedPnL,
        unrealizedPnL: pos.unrealizedPnL,
        totalPnL: pos.totalPnL
      }));

    const pnlSummary = {
      realized: positionSummary.realizedPnL,
      unrealized: unrealizedPnL,
      total:
        (positionSummary.realizedPnL ?? 0) + (unrealizedPnL ?? 0)
    };

    return {
      meta: {
        schemaVersion: 1,
        exportedAt,
        code,
        sessionId,
        scope: {
          rangeStartDate: rangeStartLabel,
          cursorDate: cursorLabel,
          selectedRange,
          calcWarmupStartDate: warmupStartTime != null ? formatDate(warmupStartTime) : null
        }
      },
      settings: {
        lotSizeDefault: DEFAULT_LOT_SIZE
      },
      series: {
        daily: { bars: dailyExportBars },
        weekly: { bars: weeklyExportBars },
        monthly: { bars: monthlyExportBars }
      },
      positions: {
        rangeStartSnapshot: {
          date: rangeStartLabel,
          longLots: rangeSnapshot.longLots,
          shortLots: rangeSnapshot.shortLots,
          avgLongPrice: rangeSnapshot.avgLongPrice,
          avgShortPrice: rangeSnapshot.avgShortPrice,
          realizedPnL: rangeSnapshot.realizedPnL
        },
        tradeLog: rangeTrades,
        positionByDate,
        pnlSummary
      },
      signals: {
        signalHits: [...dailySignals.hits, ...weeklySignals.hits, ...monthlySignals.hits]
      },
      summary: {}
    };
  };

  const handleApplyStartDate = () => {
    const date = startDateDraft || (cursorCandle ? formatDate(cursorCandle.time) : "");
    if (!date) {
      setToastMessage("開始日を選択してください。");
      return;
    }
    if (!dailyBars.length) {
      setToastMessage("日足データが読み込まれていません。");
      return;
    }
    const nextTime = parseDateString(date);
    if (nextTime == null) {
      setToastMessage("開始日が正しくありません。");
      return;
    }
    const idx = resolveExactIndex(dailyBars, nextTime);
    if (idx == null) {
      setToastMessage("指定日が日足データにありません。");
      return;
    }
    let nextTrades = trades;
    if (trades.length > 0 && date !== startDate) {
      const ok =
        typeof window === "undefined"
          ? false
          : window.confirm("開始日を変更し、既存の建玉をクリアしますか？");
      if (!ok) return;
      nextTrades = [];
      setTrades([]);
    }
    const resolved = dailyBars[idx]?.time;
    if (resolved != null) {
      setCursorTime(resolved);
      setMaxUnlockedTime(resolved);
    }
    setStartDate(date);
    setStartDateDraft(date);
    persistSession({
      startDate: date,
      cursorTime: resolved ?? null,
      maxUnlockedTime: resolved ?? null,
      trades: nextTrades
    });
  };

  const handleExport = () => {
    if (!code) return;
    const exportPayload = buildExportPayload();
    exportFile(
      `practice_${code}_${startDate ?? "unset"}.json`,
      JSON.stringify(exportPayload, null, 2),
      "application/json"
    );
  };

  const handleSaveNotes = () => {
    persistSession({ notes: sessionNotes });
    setToastMessage("メモを保存しました。");
  };

  const handleJumpToTrade = (time: number) => {
    dailyChartRef.current?.setCrosshair(time);
    weeklyChartRef.current?.setCrosshair(time);
    monthlyChartRef.current?.setCrosshair(time);
    setHover({ time, source: "daily" });
  };

  const dailyEmptyMessage = dailyCandles.length === 0 ? dailyErrors[0] ?? "No data" : null;
  const weeklyEmptyMessage = weeklyCandles.length === 0 ? dailyErrors[0] ?? "No data" : null;
  const monthlyEmptyMessage = monthlyCandles.length === 0 ? dailyErrors[0] ?? "No data" : null;

  return (
    <div className="detail-shell practice-shell">
      <div className="detail-header practice-header">
        <div className="practice-header-left">
          <button className="back" onClick={() => navigate(-1)}>
            戻る
          </button>
          <div className="detail-title">
            <div className="detail-title-main">
              <div className="title">{code}</div>
              {tickerName && <div className="title-name">{tickerName}</div>}
            </div>
            <div className="subtitle">練習</div>
          </div>
          <div className="practice-header-group">
            <div className="practice-header-label">セッション</div>
            <div className="practice-session-controls">
              <select
                value={sessionId ?? ""}
                onChange={(event) => handleSelectSession(event.target.value)}
                disabled={sessionsLoading || sessions.length === 0}
              >
                {sessions.length === 0 && <option value="">セッションなし</option>}
                {sessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.start_date ?? "開始未設定"}
                    {session.end_date ? ` - ${session.end_date}` : " (進行中)"}
                  </option>
                ))}
              </select>
              <button className="indicator-button" onClick={handleCreateSession}>
                新規
              </button>
              <button
                className="indicator-button"
                onClick={() => setSessionManagerOpen((prev) => !prev)}
              >
                管理
              </button>
            </div>
            <div className="practice-session-meta">
              <span
                className={`practice-session-badge ${sessionBadgeClass}`}
              >
                {sessionBadgeLabel}
              </span>
              <span className="practice-session-range-text">
                {sessionRangeLabel}
              </span>
            </div>
          </div>
        </div>
        <div className="practice-header-actions">
          <div className="practice-header-group">
            <div className="practice-header-label">表示</div>
            <div className="segmented practice-range">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  className={rangeMonths === preset.months ? "active" : ""}
                  onClick={() => {
                    setRangeMonths(preset.months);
                    persistSession({ rangeMonths: preset.months });
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="practice-view-meta">{headerMetaLabel}</div>
          </div>
          <div className="practice-header-group">
            <div className="practice-header-label">出力</div>
            <div className="practice-header-stack">
              <button className="indicator-button" onClick={handleExport}>
                出力
              </button>
              <button
                className="indicator-button practice-panel-toggle"
                onClick={() => togglePanel(panelCollapsed ? false : true)}
                aria-label={panelCollapsed ? "パネルを開く" : "パネルを閉じる"}
              >
                {panelCollapsed ? "⇐ パネル" : "⇒ パネル"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {sessionManagerOpen && (
        <div className="practice-session-list">
          <div className="practice-session-settings">
            <div className="practice-session-settings-title">セッション設定</div>
            <div className="practice-session-settings-controls">
              <span className="practice-session-settings-label">開始日</span>
              <input
                type="date"
                value={startDateDraft}
                onChange={(event) => setStartDateDraft(event.target.value)}
                disabled={sessions.length === 0 || !sessionId}
              />
              <button
                className="indicator-button"
                onClick={handleApplyStartDate}
                disabled={sessions.length === 0 || !sessionId}
              >
                開始日を確定
              </button>
              <button
                className="indicator-button"
                onClick={handleEndSession}
                disabled={!cursorCandle || Boolean(endDate) || sessions.length === 0 || !sessionId}
              >
                練習終了
              </button>
            </div>
          </div>
          {sessions.length === 0 ? (
            <div className="practice-session-empty">まだセッションがありません。</div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.session_id}
                className={`practice-session-row ${
                  session.session_id === sessionId ? "is-active" : ""
                }`}
              >
                <div className="practice-session-range">
                  <div className="practice-session-title">
                    {session.start_date ?? "開始未設定"}
                    {session.end_date ? ` - ${session.end_date}` : " (進行中)"}
                  </div>
                  <div className="practice-session-meta">
                    更新: {session.updated_at ?? "--"}
                  </div>
                </div>
                <div className="practice-session-actions">
                  <button onClick={() => handleSelectSession(session.session_id)}>開く</button>
                  <button onClick={() => handleDeleteSession(session.session_id)}>削除</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="practice-content">
        <div className={`practice-main ${panelCollapsed ? "is-panel-collapsed" : ""}`}>
          <div className="practice-charts">
            <div className="detail-split practice-split">
              <div className="detail-row detail-row-top" style={{ flex: `${DAILY_ROW_RATIO} 1 0%` }}>
                <div className="detail-pane-header">日足</div>
                <div className="detail-chart">
                  <DetailChart
                    ref={dailyChartRef}
                    candles={dailyCandles}
                    volume={dailyVolume}
                    maLines={dailyMaLines}
                    showVolume={dailyVolume.length > 0}
                    boxes={[]}
                    showBoxes={false}
                    cursorTime={cursorCandle?.time ?? null}
                    positionOverlay={{
                      dailyPositions,
                      tradeMarkers,
                      showOverlay: true,
                      showPnL: false,
                      hoverTime: hover.time ?? cursorCandle?.time ?? null,
                      showMarkers: true,
                      markerSuffix: lotSize !== DEFAULT_LOT_SIZE ? `x${lotSize}` : undefined
                    }}
                    onCrosshairMove={handleDailyCrosshair}
                  />
                  <div className="practice-hud-mini">
                    <div className="practice-hud-mini-title">建玉</div>
                    <div className="practice-hud-mini-row">
                      売{positionSummary.shortLots}-買{positionSummary.longLots}
                    </div>
                    <div className="practice-hud-mini-row">
                      {netLots === 0
                        ? "ネット0"
                        : netLots > 0
                        ? `ネット買い ${netLots}`
                        : `ネット売り ${Math.abs(netLots)}`}
                    </div>
                    <div className="practice-hud-mini-row">
                      実 {formatNumber(positionSummary.realizedPnL, 0)} / 評 {formatNumber(unrealizedPnL, 0)}
                    </div>
                    <div className="practice-hud-mini-row">株数 {lotSize}</div>
                    {isLocked && <div className="practice-hud-mini-lock">過去日閲覧</div>}
                  </div>
                  {dailyEmptyMessage && (
                    <div className="detail-chart-empty">日足: {dailyEmptyMessage}</div>
                  )}
                </div>
              </div>
              <div
                className="detail-row detail-row-bottom"
                style={{ flex: `${1 - DAILY_ROW_RATIO} 1 0%` }}
                ref={bottomRowRef}
              >
                <div className="detail-pane" style={{ flex: `${weeklyRatio} 1 0%` }}>
                  <div className="detail-pane-header">週足</div>
                  <div className="detail-chart">
                    <DetailChart
                      ref={weeklyChartRef}
                      candles={weeklyCandles}
                      volume={weeklyVolume}
                      maLines={weeklyMaLines}
                      showVolume={false}
                      boxes={[]}
                      showBoxes={false}
                      cursorTime={weeklyCursorTime}
                      partialTimes={weeklyPartialTimes}
                      onCrosshairMove={handleWeeklyCrosshair}
                    />
                    {weeklyEmptyMessage && (
                      <div className="detail-chart-empty">週足: {weeklyEmptyMessage}</div>
                    )}
                  </div>
                </div>
                <div
                  className="detail-divider detail-divider-vertical"
                  onMouseDown={startResize()}
                  onTouchStart={startResize()}
                />
                <div className="detail-pane" style={{ flex: `${monthlyRatio} 1 0%` }}>
                  <div className="detail-pane-header">月足</div>
                  <div className="detail-chart">
                    <DetailChart
                      ref={monthlyChartRef}
                      candles={monthlyCandles}
                      volume={[]}
                      maLines={monthlyMaLines}
                      showVolume={false}
                      boxes={[]}
                      showBoxes={false}
                      cursorTime={monthlyCursorTime}
                      partialTimes={monthlyPartialTimes}
                      onCrosshairMove={handleMonthlyCrosshair}
                    />
                    {monthlyEmptyMessage && (
                      <div className="detail-chart-empty">月足: {monthlyEmptyMessage}</div>
                    )}
                  </div>
                </div>
              </div>
              </div>
            </div>
            <div className={`practice-panel ${panelCollapsed ? "is-collapsed" : ""}`}>
              <div className="practice-panel-header">
                <div>
                  <div className="practice-panel-title">建玉</div>
                  <div className="practice-panel-sub">
                    売{positionSummary.shortLots}-買{positionSummary.longLots}
                  </div>
                </div>
              <button
                className="practice-panel-close"
                onClick={() => togglePanel(true)}
                aria-label="パネルを閉じる"
              >
                ⇐
              </button>
              </div>
              {!panelCollapsed && (
                <div className="practice-panel-body">
                  <div className="practice-guide">{guideText}</div>
                  <div className="practice-hud-net">
                    {netLots === 0
                      ? "ネット0"
                      : netLots > 0
                      ? `ネット買い ${netLots}`
                      : `ネット売り ${Math.abs(netLots)}`}
                  </div>
                  {isLocked && <div className="practice-hud-lock">過去日閲覧（操作不可）</div>}
                  <div className="practice-hud-pnl">
                    <div>実現損益: {formatNumber(positionSummary.realizedPnL, 0)}</div>
                    <div>評価損益: {formatNumber(unrealizedPnL, 0)}</div>
                  </div>
                  <div className="practice-hud-step">
                    <div className="practice-hud-step-label">進める</div>
                    <div className="practice-hud-step-controls">
                      <button onClick={() => handleStep(-1)} disabled={!canStepBack}>
                        前日
                      </button>
                      <button onClick={() => handleStep(1)} disabled={!canStepForward}>
                        翌日
                      </button>
                    </div>
                    <div className="practice-hud-step-meta">{headerMetaLabel}</div>
                  </div>
                  <div className="practice-hud-avg">
                    <div>平均買い: {formatNumber(positionSummary.avgLongPrice, 2)}</div>
                    <div>平均売り: {formatNumber(positionSummary.avgShortPrice, 2)}</div>
                  </div>
                  <div className="practice-hud-lot">
                    <span>株数</span>
                    <input
                      type="number"
                      min={1}
                    value={lotSize}
                    onChange={(event) => {
                      const next = Math.max(1, Number(event.target.value) || DEFAULT_LOT_SIZE);
                        setLotSize(next);
                        persistSession({ lotSize: next });
                      }}
                    />
                    <span>株</span>
                  </div>
                  <div className="practice-hud-note">
                    <input
                      type="text"
                      placeholder="メモ（振り返り）"
                      value={tradeNote}
                      onChange={(event) => setTradeNote(event.target.value)}
                    />
                  </div>
                  <div className="practice-hud-controls">
                    <div>
                      <div className="practice-hud-label">買い</div>
                      <div className="practice-hud-buttons">
                        {QUANTITIES.map((qty) => (
                          <button
                          key={`buy-plus-${qty}`}
                          onClick={() => handleHudAction("buy", qty)}
                          disabled={isLocked}
                        >
                          +{qty}
                        </button>
                      ))}
                      {QUANTITIES.map((qty) => (
                        <button
                          key={`buy-minus-${qty}`}
                          onClick={() => handleHudAction("buy", -qty)}
                          disabled={isLocked}
                        >
                          -{qty}
                        </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="practice-hud-label">売り</div>
                      <div className="practice-hud-buttons">
                        {QUANTITIES.map((qty) => (
                          <button
                          key={`sell-plus-${qty}`}
                          onClick={() => handleHudAction("sell", qty)}
                          disabled={isLocked}
                        >
                          +{qty}
                        </button>
                      ))}
                      {QUANTITIES.map((qty) => (
                        <button
                          key={`sell-minus-${qty}`}
                          onClick={() => handleHudAction("sell", -qty)}
                          disabled={isLocked}
                        >
                          -{qty}
                        </button>
                      ))}
                    </div>
                    </div>
                  </div>
                  <div className="practice-hud-actions">
                    <button onClick={handleUndo} disabled={!canUndo}>
                      取り消し
                    </button>
                    <button onClick={handleResetDay} disabled={!canResetDay}>
                      当日をリセット
                    </button>
                  </div>
                </div>
              )}
          </div>
        </div>

        <div className={`practice-log ${tradeLogCollapsed ? "is-collapsed" : ""}`}>
          <div className="practice-log-header">
              <div>
                <div className="practice-log-title">建玉履歴</div>
                <div className="practice-log-sub">
                  {visibleTrades.length}件 | 実現損益 {formatNumber(positionSummary.realizedPnL, 0)}
                </div>
              </div>
              <div className="practice-log-actions">
                <button className="indicator-button" onClick={toggleTradeLog}>
                  {tradeLogCollapsed ? "履歴を表示" : "履歴を隠す"}
                </button>
                {!tradeLogCollapsed && (
                <button
                  className="indicator-button"
                  onClick={() => setDailyLimit((prev) => prev + LIMIT_STEP.daily)}
                  disabled={loadingDaily || !hasMoreDaily}
                >
                  {loadingDaily ? "日足を読み込み中..." : hasMoreDaily ? "日足を追加読み込み" : "日足はすべて読み込み済み"}
                </button>
                )}
              </div>
          </div>
            {tradeLogCollapsed ? (
              <div className="practice-log-collapsed">履歴を非表示にしています。</div>
            ) : (
            <>
              <div className="practice-log-table">
                <div className="practice-log-row practice-log-head">
                  <span>日付</span>
                  <span>種別</span>
                  <span>玉数</span>
                  <span>約定</span>
                  <span>建玉</span>
                  <span>実現損益</span>
                  <span>メモ</span>
                  <span>操作</span>
                </div>
                {ledger.entries.length === 0 && (
                  <div className="practice-log-empty">まだ履歴がありません。</div>
                )}
                {ledger.entries.map((entry) => {
                  const trade = entry.trade;
                    const label =
                      trade.book === "long"
                        ? trade.action === "open"
                          ? "買い 新規"
                          : "買い 決済"
                        : trade.action === "open"
                        ? "売り 新規"
                        : "売り 決済";
                  const canEdit = !isLocked && cursorTime != null && trade.time === cursorTime;
                  const isEditing = canEdit && editingTradeId === trade.id;
                  return (
                    <div
                      className="practice-log-row"
                      key={trade.id}
                      onClick={() => handleJumpToTrade(trade.time)}
                      role="button"
                      tabIndex={0}
                    >
                      <span>{formatDate(trade.time)}</span>
                      <span>{label}</span>
                      {isEditing ? (
                        <>
                          <span>
                            <input
                              type="number"
                              min={0}
                              value={trade.quantity}
                              onChange={(event) =>
                                handleEditTrade(trade.id, { quantity: Number(event.target.value) })
                              }
                            />
                          </span>
                          <span>
                            <input
                              type="number"
                              step="0.1"
                              min={0}
                              value={trade.price}
                              onChange={(event) =>
                                handleEditTrade(trade.id, { price: Number(event.target.value) })
                              }
                            />
                          </span>
                        </>
                      ) : (
                        <>
                          <span>{trade.quantity}</span>
                          <span>{formatNumber(trade.price, 2)}</span>
                        </>
                      )}
                      <span>{entry.positionText}</span>
                      <span className={entry.realizedDelta >= 0 ? "pnl-up" : "pnl-down"}>
                        {entry.realizedDelta === 0 ? "--" : formatNumber(entry.realizedDelta, 0)}
                      </span>
                      {isEditing ? (
                        <span>
                          <input
                            type="text"
                            value={trade.note ?? ""}
                            onChange={(event) =>
                              handleEditTrade(trade.id, { note: event.target.value })
                            }
                          />
                        </span>
                      ) : (
                        <span>{trade.note ?? "--"}</span>
                      )}
                      <span className="practice-log-actions">
                        {isEditing ? (
                          <>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingTradeId(null);
                              }}
                              disabled={!canEdit}
                            >
                              保存
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingTradeId(null);
                              }}
                              disabled={!canEdit}
                            >
                              キャンセル
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!canEdit) return;
                                setEditingTradeId(trade.id);
                              }}
                              disabled={!canEdit}
                            >
                              編集
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!canEdit) return;
                                handleDeleteTrade(trade.id);
                              }}
                              disabled={!canEdit}
                            >
                              削除
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className={`practice-notes ${notesCollapsed ? "is-collapsed" : ""}`}>
                <div className="practice-notes-header">
                  <div>メモ</div>
                  <div className="practice-notes-actions">
                    <button className="indicator-button" onClick={toggleNotes}>
                      {notesCollapsed ? "メモを表示" : "メモを隠す"}
                    </button>
                    <button className="indicator-button" onClick={handleSaveNotes}>
                      メモを保存
                    </button>
                  </div>
                </div>
                {!notesCollapsed && (
                  <textarea
                    value={sessionNotes}
                    onChange={(event) => setSessionNotes(event.target.value)}
                    placeholder="メモ（振り返り）"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
