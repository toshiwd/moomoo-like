import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BarsPayload, MaSetting } from "../store";
import type { SignalChip } from "../utils/signals";
import ChartInfoPanel from "./ChartInfoPanel";
import DetailChart from "./DetailChart";

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

type ActionConfig = {
  label: string;
  ariaLabel: string;
  className?: string;
  onClick: () => void;
};

type ChartListCardProps = {
  code: string;
  name: string;
  payload?: BarsPayload | null;
  status?: "idle" | "loading" | "success" | "empty" | "error";
  maSettings: MaSetting[];
  rangeMonths?: number | null;
  onOpenDetail: (code: string) => void;
  signals?: SignalChip[];
  action?: ActionConfig | null;
};

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

const buildCandles = (rows: number[][]): Candle[] => {
  const entries: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const time = normalizeTime(row[0]);
    if (time == null) continue;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    if (![open, high, low, close].every((value) => Number.isFinite(value))) continue;
    entries.push({ time, open, high, low, close });
  }
  entries.sort((a, b) => a.time - b.time);
  return entries;
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
  return entries;
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

const getRangeStartTime = (candles: Candle[], rangeMonths?: number | null) => {
  if (!rangeMonths || rangeMonths <= 0) return null;
  if (!candles.length) return null;
  const lastTime = candles[candles.length - 1]?.time;
  if (!Number.isFinite(lastTime)) return null;
  const anchor = new Date(lastTime * 1000);
  if (Number.isNaN(anchor.getTime())) return null;
  const start = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
  );
  start.setUTCMonth(start.getUTCMonth() - rangeMonths);
  return Math.floor(start.getTime() / 1000);
};

const ChartListCard = memo(function ChartListCard({
  code,
  name,
  payload,
  status,
  maSettings,
  rangeMonths,
  onOpenDetail,
  signals,
  action
}: ChartListCardProps) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const hoverPendingRef = useRef<number | null>(null);
  const hoverValueRef = useRef<number | null>(null);

  const candlesAll = useMemo(() => buildCandles(payload?.bars ?? []), [payload]);
  const volumeAll = useMemo(() => buildVolume(payload?.bars ?? []), [payload]);
  const rangeStart = useMemo(
    () => getRangeStartTime(candlesAll, rangeMonths),
    [candlesAll, rangeMonths]
  );
  const candles = useMemo(() => {
    if (rangeStart == null) return candlesAll;
    return candlesAll.filter((bar) => bar.time >= rangeStart);
  }, [candlesAll, rangeStart]);
  const volume = useMemo(() => {
    if (rangeStart == null) return volumeAll;
    return volumeAll.filter((bar) => bar.time >= rangeStart);
  }, [volumeAll, rangeStart]);
  const maLines = useMemo(
    () =>
      maSettings.map((setting) => ({
        key: setting.key,
        label: setting.label,
        period: setting.period,
        color: setting.color,
        visible: setting.visible,
        lineWidth: setting.lineWidth,
        data: computeMA(candlesAll, setting.period)
      })),
    [candlesAll, maSettings]
  );
  const rangedMaLines = useMemo(() => {
    if (rangeStart == null) return maLines;
    return maLines.map((line) => ({
      ...line,
      data: line.data.filter((point) => point.time >= rangeStart)
    }));
  }, [maLines, rangeStart]);
  const barsForInfo = useMemo(
    () => candles.map((bar) => ({ time: bar.time, close: bar.close })),
    [candles]
  );

  const scheduleHoverTime = useCallback((time: number | null) => {
    hoverPendingRef.current = time;
    if (hoverRafRef.current !== null) return;
    hoverRafRef.current = window.requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const next = hoverPendingRef.current ?? null;
      if (hoverValueRef.current === next) return;
      hoverValueRef.current = next;
      setHoverTime(next);
    });
  }, []);

  useEffect(
    () => () => {
      if (hoverRafRef.current !== null) {
        window.cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
    },
    []
  );

  const handleOpen = () => onOpenDetail(code);
  const showLoading = !payload || !payload.bars?.length;
  const loadingLabel =
    status === "error"
      ? "読み込み失敗"
      : status === "empty"
      ? "データなし"
      : "読み込み中...";

  return (
    <div className="tile rank-tile" role="button" tabIndex={0} onClick={handleOpen}>
      <div className="rank-tile-header">
        <div className="rank-tile-left">
          <div className="tile-id">
            <span className="tile-code">{code}</span>
            <span className="tile-name">{name}</span>
          </div>
        </div>
        <div className="rank-tile-right">
          {action && (
            <button
              type="button"
              className={action.className ?? "favorite-toggle"}
              aria-label={action.ariaLabel}
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
              }}
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
      {signals?.length ? (
        <div className="tile-signal-row">
          <div className="signal-chips">
            {signals.slice(0, 4).map((signal) => (
              <span
                key={`${code}-${signal.label}`}
                className={`signal-chip ${signal.kind === "warning" ? "warning" : "achieved"}`}
              >
                {signal.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="tile-chart">
        {showLoading && <div className="tile-loading">{loadingLabel}</div>}
        {!showLoading && (
          <>
            <DetailChart
              candles={candles}
              volume={volume}
              maLines={rangedMaLines}
              showVolume={false}
              boxes={[]}
              showBoxes={false}
              onCrosshairMove={(time) => scheduleHoverTime(time)}
            />
            <ChartInfoPanel bars={barsForInfo} hoverTime={hoverTime} />
          </>
        )}
      </div>
    </div>
  );
});

export default ChartListCard;
