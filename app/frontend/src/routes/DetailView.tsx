import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import DetailChart, { DetailChartHandle } from "../components/DetailChart";
import { Box, MaSetting, useStore } from "../store";
import { computeSignalMetrics } from "../utils/signals";
import type { TradeEvent } from "../utils/positions";
import { buildDailyPositions } from "../utils/positions";

type Timeframe = "daily" | "weekly" | "monthly";
type FocusPanel = Timeframe | null;

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type VolumePoint = {
  time: number;
  value: number;
};

type ParseStats = {
  total: number;
  parsed: number;
  invalidRow: number;
  invalidTime: number;
  invalidValue: number;
};

type FetchState = {
  status: "idle" | "loading" | "success" | "error";
  responseCount: number;
  errorMessage: string | null;
};

const DEFAULT_LIMITS = {
  daily: 2000,
  monthly: 240
};

const LIMIT_STEP = {
  daily: 1000,
  monthly: 120
};

const RANGE_PRESETS = [
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
  { label: "2Y", months: 24 }
];

const DAILY_ROW_RATIO = 12 / 16;
const DEFAULT_WEEKLY_RATIO = 3 / 4;
const MIN_WEEKLY_RATIO = 0.2;
const MIN_MONTHLY_RATIO = 0.1;

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

const buildCandlesWithStats = (rows: number[][]) => {
  const entries: Candle[] = [];
  const stats: ParseStats = {
    total: rows.length,
    parsed: 0,
    invalidRow: 0,
    invalidTime: 0,
    invalidValue: 0
  };
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) {
      stats.invalidRow += 1;
      continue;
    }
    const time = normalizeTime(row[0]);
    if (time == null) {
      stats.invalidTime += 1;
      continue;
    }
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    if (![open, high, low, close].every((value) => Number.isFinite(value))) {
      stats.invalidValue += 1;
      continue;
    }
    entries.push({ time, open, high, low, close });
  }
  entries.sort((a, b) => a.time - b.time);
  const deduped: Candle[] = [];
  let lastTime = -1;
  for (const item of entries) {
    if (item.time === lastTime) continue;
    deduped.push(item);
    lastTime = item.time;
  }
  stats.parsed = deduped.length;
  return { candles: deduped, stats };
};

const buildVolume = (rows: number[][]): VolumePoint[] => {
  const entries: VolumePoint[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = normalizeTime(row[0]);
    if (time == null) continue;
    const value = Number(row[5]);
    if (!Number.isFinite(value)) continue;
    entries.push({ time, value });
  }
  entries.sort((a, b) => a.time - b.time);
  const deduped: VolumePoint[] = [];
  let lastTime = -1;
  for (const item of entries) {
    if (item.time === lastTime) continue;
    deduped.push(item);
    lastTime = item.time;
  }
  return deduped;
};

const buildWeekly = (candles: Candle[], volume: VolumePoint[]) => {
  const volumeMap = new Map(volume.map((item) => [item.time, item.value]));
  const groups = new Map<number, { candle: Candle; volume: number }>();

  for (const candle of candles) {
    const date = new Date(candle.time * 1000);
    const day = date.getUTCDay();
    const diff = (day + 6) % 7;
    const weekStart = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - diff
    );
    const key = Math.floor(weekStart / 1000);
    const vol = volumeMap.get(candle.time) ?? 0;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        candle: { ...candle, time: key },
        volume: vol
      });
    } else {
      existing.candle.high = Math.max(existing.candle.high, candle.high);
      existing.candle.low = Math.min(existing.candle.low, candle.low);
      existing.candle.close = candle.close;
      existing.volume += vol;
    }
  }

  const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  const weeklyCandles = sorted.map((item) => item[1].candle);
  const weeklyVolume = sorted.map((item) => ({
    time: item[1].candle.time,
    value: item[1].volume
  }));
  return { candles: weeklyCandles, volume: weeklyVolume };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildRange = (candles: Candle[], months: number) => {
  if (!candles.length) return null;
  const end = candles[candles.length - 1].time;
  const endDate = new Date(end * 1000);
  const startDate = new Date(endDate);
  startDate.setMonth(endDate.getMonth() - months);
  return { from: Math.floor(startDate.getTime() / 1000), to: end };
};

const countInRange = (candles: Candle[], months: number | null) => {
  if (!months) return candles.length;
  const range = buildRange(candles, months);
  if (!range) return 0;
  return candles.filter((c) => c.time >= range.from && c.time <= range.to).length;
};

export default function DetailView() {
  const { code } = useParams();
  const navigate = useNavigate();
  const dailyChartRef = useRef<DetailChartHandle | null>(null);
  const weeklyChartRef = useRef<DetailChartHandle | null>(null);
  const monthlyChartRef = useRef<DetailChartHandle | null>(null);
  const bottomRowRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const tickers = useStore((state) => state.tickers);
  const loadList = useStore((state) => state.loadList);
  const loadingList = useStore((state) => state.loadingList);
  const showBoxes = useStore((state) => state.settings.showBoxes);
  const setShowBoxes = useStore((state) => state.setShowBoxes);
  const maSettings = useStore((state) => state.maSettings);
  const updateMaSetting = useStore((state) => state.updateMaSetting);
  const resetMaSettings = useStore((state) => state.resetMaSettings);

  const [dailyLimit, setDailyLimit] = useState(DEFAULT_LIMITS.daily);
  const [monthlyLimit, setMonthlyLimit] = useState(DEFAULT_LIMITS.monthly);
  const [dailyData, setDailyData] = useState<number[][]>([]);
  const [monthlyData, setMonthlyData] = useState<number[][]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [tradeWarnings, setTradeWarnings] = useState<string[]>([]);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [dailyFetch, setDailyFetch] = useState<FetchState>({
    status: "idle",
    responseCount: 0,
    errorMessage: null
  });
  const [monthlyFetch, setMonthlyFetch] = useState<FetchState>({
    status: "idle",
    responseCount: 0,
    errorMessage: null
  });
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [hasMoreDaily, setHasMoreDaily] = useState(true);
  const [hasMoreMonthly, setHasMoreMonthly] = useState(true);
  const [showIndicators, setShowIndicators] = useState(false);
  const [weeklyRatio, setWeeklyRatio] = useState(DEFAULT_WEEKLY_RATIO);
  const [rangeMonths, setRangeMonths] = useState<number | null>(12);
  const [showTradesOverlay, setShowTradesOverlay] = useState(true);
  const [showPnLPanel, setShowPnLPanel] = useState(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [focusPanel, setFocusPanel] = useState<FocusPanel>(null);

  const tickerName = useMemo(() => {
    if (!code) return "";
    const raw = tickers.find((item) => item.code === code)?.name ?? "";
    const cleaned = raw.replace(/\s*\?\s*$/, "").trim();
    return cleaned === "?" ? "" : cleaned;
  }, [tickers, code]);

  const subtitle = useMemo(() => {
    const parts = [] as string[];
    if (tickerName) parts.push(tickerName);
    parts.push("Daily / Weekly / Monthly");
    return parts.filter(Boolean).join(" / ");
  }, [tickerName]);

  useEffect(() => {
    if (!tickers.length && !loadingList) {
      loadList();
    }
  }, [tickers.length, loadingList, loadList]);

  useEffect(() => {
    if (!code) return;
    setLoadingDaily(true);
    setDailyFetch((prev) => ({ ...prev, status: "loading", errorMessage: null }));
    api
      .get("/ticker/daily", { params: { code, limit: dailyLimit } })
      .then((res) => {
        if (!Array.isArray(res.data)) {
          throw new Error("JSON parse failed: daily response is not an array");
        }
        const rows = res.data as number[][];
        setDailyData(rows);
        setHasMoreDaily(rows.length >= dailyLimit);
        setDailyFetch({ status: "success", responseCount: rows.length, errorMessage: null });
      })
      .catch((error) => {
        const message = error?.message || "Daily fetch failed";
        setDailyFetch((prev) => ({
          status: "error",
          responseCount: prev.responseCount,
          errorMessage: message
        }));
      })
      .finally(() => setLoadingDaily(false));
  }, [code, dailyLimit]);

  useEffect(() => {
    if (!code) return;
    setLoadingMonthly(true);
    setMonthlyFetch((prev) => ({ ...prev, status: "loading", errorMessage: null }));
    api
      .get("/ticker/monthly", { params: { code, limit: monthlyLimit } })
      .then((res) => {
        if (!Array.isArray(res.data)) {
          throw new Error("JSON parse failed: monthly response is not an array");
        }
        const rows = res.data as number[][];
        setMonthlyData(rows);
        setHasMoreMonthly(rows.length >= monthlyLimit);
        setMonthlyFetch({ status: "success", responseCount: rows.length, errorMessage: null });
      })
      .catch((error) => {
        const message = error?.message || "Monthly fetch failed";
        setMonthlyFetch((prev) => ({
          status: "error",
          responseCount: prev.responseCount,
          errorMessage: message
        }));
      })
      .finally(() => setLoadingMonthly(false));
  }, [code, monthlyLimit]);

  useEffect(() => {
    if (!code) return;
    api
      .get("/ticker/boxes", { params: { code } })
      .then((res) => {
        const rows = (res.data || []) as Box[];
        setBoxes(rows);
      })
      .catch(() => {
        setBoxes([]);
      });
  }, [code]);

  useEffect(() => {
    if (!code) return;
    setTradeError(null);
    api
      .get(`/trades/${code}`)
      .then((res) => {
        const payload = res.data as {
          events?: TradeEvent[];
          warnings?: string[];
          currentPosition?: { buyUnits: number; sellUnits: number; text?: string };
        };
        if (!payload || !Array.isArray(payload.events)) {
          throw new Error("Trades response is invalid");
        }
        setTrades(payload.events ?? []);
        setTradeWarnings(payload.warnings ?? []);
      })
      .catch((error) => {
        const message = error?.message || "Trades fetch failed";
        setTradeError(message);
        setTrades([]);
        setTradeWarnings([]);
      });
  }, [code]);

  const dailyParse = useMemo(() => buildCandlesWithStats(dailyData), [dailyData]);
  const monthlyParse = useMemo(() => buildCandlesWithStats(monthlyData), [monthlyData]);
  const dailyCandles = dailyParse.candles;
  const monthlyCandles = monthlyParse.candles;
  const dailyVolume = useMemo(() => buildVolume(dailyData), [dailyData]);
  const monthlyVolume = useMemo(() => buildVolume(monthlyData), [monthlyData]);
  const weeklyData = useMemo(() => buildWeekly(dailyCandles, dailyVolume), [dailyCandles, dailyVolume]);

  const weeklyCandles = weeklyData.candles;
  const weeklyVolume = weeklyData.volume;
  const dailySignalBars = useMemo(
    () => dailyCandles.map((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close]),
    [dailyCandles]
  );
  const dailySignalMetrics = useMemo(
    () => computeSignalMetrics(dailySignalBars),
    [dailySignalBars]
  );
  const dailySignals = dailySignalMetrics.signals;
  const positionData = useMemo(
    () => buildDailyPositions(dailyCandles, trades),
    [dailyCandles, trades]
  );
  const dailyPositions = positionData.dailyPositions;
  const tradeMarkers = positionData.tradeMarkers;
  const dailyRangeCount = useMemo(
    () => countInRange(dailyCandles, rangeMonths),
    [dailyCandles, rangeMonths]
  );
  const weeklyRangeCount = useMemo(
    () => countInRange(weeklyCandles, rangeMonths),
    [weeklyCandles, rangeMonths]
  );
  const monthlyRangeCount = useMemo(
    () => countInRange(monthlyCandles, rangeMonths),
    [monthlyCandles, rangeMonths]
  );

  const dailyInvalidCount =
    dailyParse.stats.invalidRow + dailyParse.stats.invalidTime + dailyParse.stats.invalidValue;
  const monthlyInvalidCount =
    monthlyParse.stats.invalidRow + monthlyParse.stats.invalidTime + monthlyParse.stats.invalidValue;
  const dailyHasEmpty = dailyFetch.status === "success" && dailyFetch.responseCount === 0;
  const monthlyHasEmpty = monthlyFetch.status === "success" && monthlyFetch.responseCount === 0;
  const dailyHasParsedZero = dailyParse.stats.parsed === 0 && dailyParse.stats.total > 0;
  const monthlyHasParsedZero = monthlyParse.stats.parsed === 0 && monthlyParse.stats.total > 0;

  const dailyError =
    dailyFetch.status === "error"
      ? dailyFetch.errorMessage
      : dailyHasEmpty
      ? "No data"
      : dailyHasParsedZero
      ? `Date parse failed ${dailyParse.stats.invalidTime}`
      : null;

  const monthlyError =
    monthlyFetch.status === "error"
      ? monthlyFetch.errorMessage
      : monthlyHasEmpty
      ? "No data"
      : monthlyHasParsedZero
      ? `Date parse failed ${monthlyParse.stats.invalidTime}`
      : null;

  const weeklyHasEmpty = weeklyCandles.length === 0 && dailyCandles.length > 0;
  const dailyIssue =
    dailyFetch.status === "error" ||
    dailyHasEmpty ||
    dailyHasParsedZero ||
    dailyInvalidCount > 0 ||
    !!tradeError ||
    tradeWarnings.length > 0;
  const weeklyIssue = dailyFetch.status === "error" || weeklyHasEmpty;
  const monthlyIssue =
    monthlyFetch.status === "error" ||
    monthlyHasEmpty ||
    monthlyHasParsedZero ||
    monthlyInvalidCount > 0;
  const hasIssues = dailyIssue || weeklyIssue || monthlyIssue;

  const debugMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("debug") === "1";
  }, []);
  const [debugOpen, setDebugOpen] = useState(false);

  const debugSummary = useMemo(() => {
    const parts: string[] = [];
    if (dailyFetch.status === "error") parts.push("Daily fetch error");
    if (dailyHasEmpty) parts.push("Daily 0 bars");
    if (dailyHasParsedZero) parts.push("Daily parsed 0");
    if (dailyInvalidCount > 0) parts.push(`Daily invalid ${dailyInvalidCount}`);
    if (weeklyHasEmpty && dailyFetch.status !== "error") parts.push("Weekly 0 bars");
    if (monthlyFetch.status === "error") parts.push("Monthly fetch error");
    if (monthlyHasEmpty) parts.push("Monthly 0 bars");
    if (monthlyHasParsedZero) parts.push("Monthly parsed 0");
    if (monthlyInvalidCount > 0) parts.push(`Monthly invalid ${monthlyInvalidCount}`);
    if (tradeError) parts.push("Trades error");
    if (tradeWarnings.length) {
      const preview = tradeWarnings.slice(0, 2).join(", ");
      parts.push(preview ? `Trades warning: ${preview}` : "Trades warning");
    }
    return parts;
  }, [
    dailyFetch.status,
    dailyHasEmpty,
    dailyHasParsedZero,
    dailyInvalidCount,
    weeklyHasEmpty,
    monthlyFetch.status,
    monthlyHasEmpty,
    monthlyHasParsedZero,
    monthlyInvalidCount,
    tradeError,
    tradeWarnings.length
  ]);

  const dailyMaLines = useMemo(() => {
    return maSettings.daily.map((setting) => ({
      key: setting.key,
      color: setting.color,
      visible: setting.visible,
      lineWidth: setting.lineWidth,
      data: computeMA(dailyCandles, setting.period)
    }));
  }, [dailyCandles, maSettings.daily]);

  const weeklyMaLines = useMemo(() => {
    return maSettings.weekly.map((setting) => ({
      key: setting.key,
      color: setting.color,
      visible: setting.visible,
      lineWidth: setting.lineWidth,
      data: computeMA(weeklyCandles, setting.period)
    }));
  }, [weeklyCandles, maSettings.weekly]);

  const monthlyMaLines = useMemo(() => {
    return maSettings.monthly.map((setting) => ({
      key: setting.key,
      color: setting.color,
      visible: setting.visible,
      lineWidth: setting.lineWidth,
      data: computeMA(monthlyCandles, setting.period)
    }));
  }, [monthlyCandles, maSettings.monthly]);

  const dailyVisibleRange = useMemo(
    () => (rangeMonths ? buildRange(dailyCandles, rangeMonths) : null),
    [dailyCandles, rangeMonths]
  );

  const weeklyVisibleRange = useMemo(
    () => (rangeMonths ? buildRange(weeklyCandles, rangeMonths) : null),
    [weeklyCandles, rangeMonths]
  );

  const monthlyVisibleRange = useMemo(
    () => (rangeMonths ? buildRange(monthlyCandles, rangeMonths) : null),
    [monthlyCandles, rangeMonths]
  );

  useEffect(() => {
    const handleMove = (event: MouseEvent | TouchEvent) => {
      if (!draggingRef.current || !bottomRowRef.current) return;
      let clientX = 0;
      if ("touches" in event) {
        if (!event.touches.length) return;
        event.preventDefault();
        clientX = event.touches[0].clientX;
      } else {
        clientX = event.clientX;
      }
      const rect = bottomRowRef.current.getBoundingClientRect();
      const position = clamp((clientX - rect.left) / rect.width, 0.05, 0.95);
      const nextWeekly = clamp(position, MIN_WEEKLY_RATIO, 1 - MIN_MONTHLY_RATIO);
      setWeeklyRatio(nextWeekly);
    };

    const handleUp = () => {
      draggingRef.current = false;
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocusPanel(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setHoverTime(null);
    dailyChartRef.current?.clearCrosshair();
    weeklyChartRef.current?.clearCrosshair();
    monthlyChartRef.current?.clearCrosshair();
  }, [focusPanel]);

  const showVolumeDaily = dailyVolume.length > 0;

  const loadMoreDaily = () => {
    setDailyLimit((prev) => prev + LIMIT_STEP.daily);
  };

  const loadMoreMonthly = () => {
    setMonthlyLimit((prev) => prev + LIMIT_STEP.monthly);
  };

  const toggleRange = (months: number) => {
    setRangeMonths((prev) => (prev === months ? null : months));
  };

  const updateSetting = (timeframe: Timeframe, index: number, patch: Partial<MaSetting>) => {
    updateMaSetting(timeframe, index, patch);
  };

  const resetSettings = (timeframe: Timeframe) => {
    resetMaSettings(timeframe);
  };

  const startDrag = () => (event: ReactMouseEvent | ReactTouchEvent) => {
    event.preventDefault();
    draggingRef.current = true;
  };

  const toggleFocus = (panel: Timeframe) => {
    setFocusPanel((prev) => (prev === panel ? null : panel));
  };

  const handleDailyCrosshair = (time: number | null) => {
    weeklyChartRef.current?.setCrosshair(time);
    monthlyChartRef.current?.setCrosshair(time);
    if (focusPanel === null || focusPanel === "daily") {
      setHoverTime(time);
    }
  };

  const handleWeeklyCrosshair = (time: number | null) => {
    dailyChartRef.current?.setCrosshair(time);
    monthlyChartRef.current?.setCrosshair(time);
    if (focusPanel === "weekly") {
      setHoverTime(time);
    }
  };

  const handleMonthlyCrosshair = (time: number | null) => {
    dailyChartRef.current?.setCrosshair(time);
    weeklyChartRef.current?.setCrosshair(time);
    if (focusPanel === "monthly") {
      setHoverTime(time);
    }
  };

  const dailyEmptyMessage = dailyCandles.length === 0 ? dailyError ?? "No data" : null;
  const weeklyEmptyMessage = weeklyCandles.length === 0 ? dailyError ?? "No data" : null;
  const monthlyEmptyMessage = monthlyCandles.length === 0 ? monthlyError ?? "No data" : null;

  const monthlyRatio = 1 - weeklyRatio;
  const focusTitle =
    focusPanel === "daily" ? "Daily (Focused)" : focusPanel === "weekly" ? "Weekly (Focused)" : "Monthly (Focused)";

  return (
    <div className="detail-shell">
      <div className="detail-header">
        <button className="back" onClick={() => navigate(-1)}>
          Back
        </button>
        <div>
          <div className="title">{code}</div>
          <div className="subtitle">{subtitle}</div>
          {dailySignals.length > 0 && (
            <div className="detail-signals">
              {dailySignals.map((signal) => (
                <span
                  key={signal.label}
                  className={`signal-chip ${signal.kind === "warning" ? "warning" : "achieved"}`}
                >
                  {signal.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="detail-controls">
          <div className="segmented detail-range">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className={rangeMonths === preset.months ? "active" : ""}
                onClick={() => toggleRange(preset.months)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <button
            className={showBoxes ? "indicator-button active" : "indicator-button"}
            onClick={() => setShowBoxes(!showBoxes)}
          >
            Boxes
          </button>
          <button
            className={showTradesOverlay ? "indicator-button active" : "indicator-button"}
            onClick={() => setShowTradesOverlay(!showTradesOverlay)}
          >
            Positions
          </button>
          <button
            className={showPnLPanel ? "indicator-button active" : "indicator-button"}
            onClick={() => setShowPnLPanel(!showPnLPanel)}
          >
            PnL
          </button>
          <button className="indicator-button" onClick={() => setShowIndicators(true)}>
            Indicators
          </button>
        </div>
      </div>
      <div className={`detail-split ${focusPanel ? "detail-split-focus" : ""}`}>
        {focusPanel ? (
          <div className="detail-row detail-row-focus">
            <div className="detail-pane-header">{focusTitle}</div>
            <div
              className="detail-chart detail-chart-focused"
              onDoubleClick={() => toggleFocus(focusPanel)}
            >
              {focusPanel === "daily" && (
                <DetailChart
                  ref={dailyChartRef}
                  candles={dailyCandles}
                  volume={dailyVolume}
                  maLines={dailyMaLines}
                  showVolume={showVolumeDaily}
                  boxes={boxes}
                  showBoxes={showBoxes}
                  visibleRange={dailyVisibleRange}
                  positionOverlay={{
                    dailyPositions,
                    tradeMarkers,
                    showOverlay: showTradesOverlay,
                    showMarkers: true,
                    showPnL: showPnLPanel,
                    hoverTime,
                    bars: dailyCandles,
                    volume: dailyVolume
                  }}
                  onCrosshairMove={handleDailyCrosshair}
                />
              )}
              {focusPanel === "weekly" && (
                <DetailChart
                  ref={weeklyChartRef}
                  candles={weeklyCandles}
                  volume={weeklyVolume}
                  maLines={weeklyMaLines}
                  showVolume={false}
                  boxes={boxes}
                  showBoxes={showBoxes}
                  visibleRange={weeklyVisibleRange}
                  positionOverlay={{
                    dailyPositions,
                    tradeMarkers,
                    showOverlay: showTradesOverlay,
                    showMarkers: false,
                    showPnL: showPnLPanel,
                    hoverTime,
                    bars: weeklyCandles,
                    volume: weeklyVolume
                  }}
                  onCrosshairMove={handleWeeklyCrosshair}
                />
              )}
              {focusPanel === "monthly" && (
                <DetailChart
                  ref={monthlyChartRef}
                  candles={monthlyCandles}
                  volume={monthlyVolume}
                  maLines={monthlyMaLines}
                  showVolume={false}
                  boxes={boxes}
                  showBoxes={showBoxes}
                  visibleRange={monthlyVisibleRange}
                  positionOverlay={{
                    dailyPositions,
                    tradeMarkers,
                    showOverlay: showTradesOverlay,
                    showMarkers: false,
                    showPnL: showPnLPanel,
                    hoverTime,
                    bars: monthlyCandles,
                    volume: monthlyVolume
                  }}
                  onCrosshairMove={handleMonthlyCrosshair}
                />
              )}
              {focusPanel === "daily" && dailyEmptyMessage && (
                <div className="detail-chart-empty">Daily: {dailyEmptyMessage}</div>
              )}
              {focusPanel === "weekly" && weeklyEmptyMessage && (
                <div className="detail-chart-empty">Weekly: {weeklyEmptyMessage}</div>
              )}
              {focusPanel === "monthly" && monthlyEmptyMessage && (
                <div className="detail-chart-empty">Monthly: {monthlyEmptyMessage}</div>
              )}
              <button
                type="button"
                className="detail-focus-back"
                onClick={() => setFocusPanel(null)}
              >
                Back to 3 charts
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="detail-row detail-row-top" style={{ flex: `${DAILY_ROW_RATIO} 1 0%` }}>
              <div className="detail-pane-header">Daily</div>
              <div
                className="detail-chart detail-chart-focusable"
                onDoubleClick={() => toggleFocus("daily")}
              >
                <DetailChart
                  ref={dailyChartRef}
                  candles={dailyCandles}
                  volume={dailyVolume}
                  maLines={dailyMaLines}
                  showVolume={showVolumeDaily}
                  boxes={boxes}
                  showBoxes={showBoxes}
                  visibleRange={dailyVisibleRange}
                  positionOverlay={{
                    dailyPositions,
                    tradeMarkers,
                    showOverlay: showTradesOverlay,
                    showMarkers: true,
                    showPnL: showPnLPanel,
                    hoverTime,
                    bars: dailyCandles,
                    volume: dailyVolume
                  }}
                  onCrosshairMove={handleDailyCrosshair}
                />
                {dailyEmptyMessage && (
                  <div className="detail-chart-empty">Daily: {dailyEmptyMessage}</div>
                )}
              </div>
            </div>
            <div
              className="detail-row detail-row-bottom"
              style={{ flex: `${1 - DAILY_ROW_RATIO} 1 0%` }}
              ref={bottomRowRef}
            >
              <div className="detail-pane" style={{ flex: `${weeklyRatio} 1 0%` }}>
                <div className="detail-pane-header">Weekly</div>
                <div
                  className="detail-chart detail-chart-focusable"
                  onDoubleClick={() => toggleFocus("weekly")}
                >
                  <DetailChart
                    ref={weeklyChartRef}
                    candles={weeklyCandles}
                    volume={weeklyVolume}
                    maLines={weeklyMaLines}
                    showVolume={false}
                    boxes={boxes}
                    showBoxes={showBoxes}
                    visibleRange={weeklyVisibleRange}
                    onCrosshairMove={handleWeeklyCrosshair}
                  />
                  {weeklyEmptyMessage && (
                    <div className="detail-chart-empty">Weekly: {weeklyEmptyMessage}</div>
                  )}
                </div>
              </div>
              <div
                className="detail-divider detail-divider-vertical"
                onMouseDown={startDrag()}
                onTouchStart={startDrag()}
              />
              <div className="detail-pane" style={{ flex: `${monthlyRatio} 1 0%` }}>
                <div className="detail-pane-header">Monthly</div>
                <div
                  className="detail-chart detail-chart-focusable"
                  onDoubleClick={() => toggleFocus("monthly")}
                >
                  <DetailChart
                    ref={monthlyChartRef}
                    candles={monthlyCandles}
                    volume={monthlyVolume}
                    maLines={monthlyMaLines}
                    showVolume={false}
                    boxes={boxes}
                    showBoxes={showBoxes}
                    visibleRange={monthlyVisibleRange}
                    onCrosshairMove={handleMonthlyCrosshair}
                  />
                  {monthlyEmptyMessage && (
                    <div className="detail-chart-empty">Monthly: {monthlyEmptyMessage}</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="detail-footer">
        <div className="detail-footer-left">
          <button className="load-more" onClick={loadMoreDaily} disabled={loadingDaily || !hasMoreDaily}>
            {loadingDaily ? "Loading daily..." : hasMoreDaily ? "Load more daily" : "Daily all loaded"}
          </button>
          <button
            className="load-more"
            onClick={loadMoreMonthly}
            disabled={loadingMonthly || !hasMoreMonthly}
          >
            {loadingMonthly
              ? "Loading monthly..."
              : hasMoreMonthly
              ? "Load more monthly"
              : "Monthly all loaded"}
          </button>
        </div>
        <div className="detail-hint">
          Daily {dailyCandles.length} bars | Weekly {weeklyCandles.length} bars | Monthly {monthlyCandles.length} bars
        </div>
      </div>
      {(hasIssues || debugMode) && (
        <div className={`detail-debug-banner ${hasIssues ? "warning" : "info"}`}>
          <button
            type="button"
            className="detail-debug-toggle"
            onClick={() => setDebugOpen((prev) => !prev)}
          >
            {hasIssues
              ? `Data issue detected${
                  debugSummary.length ? ` (${debugSummary.join(", ")})` : ""
                }`
              : "Show debug info"}
          </button>
          {debugOpen && (
            <div className="detail-debug-panel">
              <div className="detail-debug-header">
                <div className="detail-debug-title">Debug Details</div>
                <button
                  type="button"
                  className="detail-debug-close"
                  onClick={() => setDebugOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="detail-debug-lines">
                <div>
                  Daily({dailyFetch.status}) API {dailyFetch.responseCount} | Parsed {dailyParse.stats.parsed} | Range {dailyRangeCount} | InvalidRow {dailyParse.stats.invalidRow} | InvalidTime {dailyParse.stats.invalidTime} | InvalidValue {dailyParse.stats.invalidValue} | Error {dailyError ?? "-"}
                </div>
                <div>
                  Weekly Parsed {weeklyCandles.length} | Range {weeklyRangeCount} | Error {dailyError ?? "-"}
                </div>
                <div>
                  Monthly({monthlyFetch.status}) API {monthlyFetch.responseCount} | Parsed {monthlyParse.stats.parsed} | Range {monthlyRangeCount} | InvalidRow {monthlyParse.stats.invalidRow} | InvalidTime {monthlyParse.stats.invalidTime} | InvalidValue {monthlyParse.stats.invalidValue} | Error {monthlyError ?? "-"}
                </div>
                {tradeWarnings.length > 0 && (
                  <div>Trades warnings: {tradeWarnings.slice(0, 5).join(", ")}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {showIndicators && (
        <div className="indicator-overlay" onClick={() => setShowIndicators(false)}>
          <div className="indicator-panel" onClick={(event) => event.stopPropagation()}>
            <div className="indicator-header">
              <div className="indicator-title">Indicators</div>
              <button className="indicator-close" onClick={() => setShowIndicators(false)}>
                Close
              </button>
            </div>
            {(["daily", "weekly", "monthly"] as Timeframe[]).map((frame) => (
              <div className="indicator-section" key={frame}>
                <div className="indicator-subtitle">Moving Averages ({frame})</div>
                <div className="indicator-rows">
                  {maSettings[frame].map((setting, index) => (
                    <div className="indicator-row" key={setting.key}>
                      <input
                        type="checkbox"
                        checked={setting.visible}
                        onChange={() => updateSetting(frame, index, { visible: !setting.visible })}
                      />
                      <div className="indicator-label">{setting.label}</div>
                      <input
                        className="indicator-input"
                        type="number"
                        min={1}
                        value={setting.period}
                        onChange={(event) =>
                          updateSetting(frame, index, { period: Number(event.target.value) || 1 })
                        }
                      />
                      <input
                        className="indicator-input indicator-width"
                        type="number"
                        min={1}
                        max={6}
                        value={setting.lineWidth}
                        onChange={(event) =>
                          updateSetting(frame, index, { lineWidth: Number(event.target.value) })
                        }
                      />
                      <input
                        className="indicator-color-input"
                        type="color"
                        value={setting.color}
                        onChange={(event) => updateSetting(frame, index, { color: event.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <button className="indicator-reset" onClick={() => resetSettings(frame)}>
                  Reset {frame}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
