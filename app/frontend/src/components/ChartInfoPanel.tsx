import { useMemo } from "react";

type Bar = {
  time: number;
  close: number;
};

type ChartInfoPanelProps = {
  bars: Bar[];
  hoverTime: number | null;
};

const formatDate = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  const raw = Number(value);
  if (raw >= 10000000 && raw < 100000000) {
    const year = Math.floor(raw / 10000);
    const month = Math.floor((raw % 10000) / 100);
    const day = raw % 100;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }
  if (raw > 1000000000000) {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toISOString().slice(0, 10);
  }
  if (raw > 1000000000) {
    const date = new Date(raw * 1000);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toISOString().slice(0, 10);
  }
  return "--";
};

const formatPrice = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  return Math.round(value).toLocaleString("ja-JP");
};

const findClosestIndex = (bars: Bar[], time: number | null) => {
  if (!bars.length || time == null) return null;
  let left = 0;
  let right = bars.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = bars[mid].time;
    if (midTime === time) return mid;
    if (midTime < time) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  const lowerIndex = Math.max(0, Math.min(bars.length - 1, right));
  const upperIndex = Math.max(0, Math.min(bars.length - 1, left));
  const lower = bars[lowerIndex];
  const upper = bars[upperIndex];
  if (!lower) return upperIndex ?? null;
  if (!upper) return lowerIndex ?? null;
  return Math.abs(time - lower.time) <= Math.abs(upper.time - time)
    ? lowerIndex
    : upperIndex;
};

export default function ChartInfoPanel({ bars, hoverTime }: ChartInfoPanelProps) {
  const activeIndex = useMemo(() => {
    const closest = findClosestIndex(bars, hoverTime);
    if (closest != null) return closest;
    return bars.length ? bars.length - 1 : null;
  }, [bars, hoverTime]);

  if (activeIndex == null) return null;
  const activeBar = bars[activeIndex];
  if (!activeBar) return null;

  return (
    <div className="chart-info-panel">
      <div className="chart-info-label">日付</div>
      <div className="chart-info-value">{formatDate(activeBar.time)}</div>
      <div className="chart-info-label">終値</div>
      <div className="chart-info-value">{formatPrice(activeBar.close)}</div>
    </div>
  );
}
