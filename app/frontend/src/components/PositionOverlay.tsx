import { useEffect, useMemo, useRef, useState } from "react";
import type { ISeriesApi } from "lightweight-charts";
import type { DailyPosition, TradeEvent, TradeMarker } from "../utils/positions";

type PositionOverlayProps = {
  candleSeries: ISeriesApi<"Candlestick"> | null;
  chart: { timeScale?: () => any } | null;
  dailyPositions: DailyPosition[];
  tradeMarkers: TradeMarker[];
  showOverlay: boolean;
  showPnL: boolean;
  hoverTime: number | null;
  bars: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
  volume: {
    time: number;
    value: number;
  }[];
  showMarkers?: boolean;
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
};

const formatSignedNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value);
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${rounded.toLocaleString()}`;
};

const formatPercent = (value: number) => {
  if (!Number.isFinite(value)) return "0%";
  const rounded = Math.round(value * 100) / 100;
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${rounded.toFixed(2)}%`;
};

const formatDate = (time: number) => {
  const date = new Date(time * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const findClosestTime = (times: number[], time: number | null) => {
  if (!times.length) return null;
  if (time == null) return null;
  let left = 0;
  let right = times.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = times[mid];
    if (midTime === time) return midTime;
    if (midTime < time) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return times[Math.max(0, Math.min(times.length - 1, right))] ?? null;
};

const findClosestIndex = (bars: PositionOverlayProps["bars"], time: number | null) => {
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
  return Math.abs(time - lower.time) <= Math.abs(upper.time - time) ? lowerIndex : upperIndex;
};

const resolveBrokerMeta = (value: string | undefined) => {
  const raw = (value ?? "").toString().trim();
  const lower = raw.toLowerCase();
  if (lower.includes("sbi")) return { key: "sbi", label: "SBI" };
  if (lower.includes("rakuten")) return { key: "rakuten", label: "RAKUTEN" };
  if (raw) return { key: lower, label: raw.toUpperCase() };
  return { key: "unknown", label: "N/A" };
};

const formatTrade = (trade: TradeEvent) => {
  const action = trade.action === "open" ? "OPEN" : "CLOSE";
  const side = trade.side.toUpperCase();
  const units = Number.isFinite(trade.units) ? formatNumber(trade.units) : "0";
  const price = trade.price ? ` @ ${formatNumber(trade.price)}` : "";
  return `${side} ${action} ${units}${price}`;
};

const brokerOrder = (key: string) => {
  if (key === "rakuten") return 0;
  if (key === "sbi") return 1;
  if (key === "unknown") return 2;
  return 3;
};

const compareBrokerKey = (a?: string, b?: string) => {
  const keyA = a ?? "unknown";
  const keyB = b ?? "unknown";
  const rankA = brokerOrder(keyA);
  const rankB = brokerOrder(keyB);
  if (rankA !== rankB) return rankA - rankB;
  return keyA.localeCompare(keyB);
};

export default function PositionOverlay({
  candleSeries,
  chart,
  dailyPositions,
  tradeMarkers,
  showOverlay,
  showPnL,
  hoverTime,
  bars,
  volume,
  showMarkers = true
}: PositionOverlayProps) {
  const [rangeTick, setRangeTick] = useState(0);
  const rangeRafRef = useRef<number | null>(null);
  const volumeMap = useMemo(
    () => new Map(volume.map((item) => [item.time, item.value])),
    [volume]
  );
  const activeIndex = useMemo(() => findClosestIndex(bars, hoverTime), [bars, hoverTime]);

  const positionsByTime = useMemo(() => {
    const map = new Map<number, DailyPosition[]>();
    dailyPositions.forEach((pos) => {
      const list = map.get(pos.time) ?? [];
      list.push(pos);
      map.set(pos.time, list);
    });
    map.forEach((list) =>
      list.sort((a, b) => compareBrokerKey(a.brokerKey, b.brokerKey))
    );
    return map;
  }, [dailyPositions]);
  const positionTimes = useMemo(() => {
    const times: number[] = [];
    positionsByTime.forEach((_value, key) => {
      times.push(key);
    });
    times.sort((a, b) => a - b);
    return times;
  }, [positionsByTime]);

  const normalizeTimeValue = (value: unknown) => {
    if (typeof value === "number") return value;
    if (value && typeof value === "object") {
      const data = value as { year?: number; month?: number; day?: number };
      if (data.year && data.month && data.day) {
        return Math.floor(Date.UTC(data.year, data.month - 1, data.day) / 1000);
      }
    }
    return null;
  };

  useEffect(() => {
    if (!candleSeries) return;
    candleSeries.setMarkers([]);
  }, [candleSeries]);

  useEffect(() => {
    if (!chart) return;
    const timeScale = chart.timeScale?.();
    const priceScale = (chart as any)?.priceScale?.("right");

    const schedule = () => {
      if (rangeRafRef.current != null) return;
      rangeRafRef.current = window.requestAnimationFrame(() => {
        rangeRafRef.current = null;
        setRangeTick((prev) => prev + 1);
      });
    };

    const timeHandler = () => schedule();
    const priceHandler = () => schedule();

    timeScale?.subscribeVisibleTimeRangeChange?.(timeHandler);
    timeScale?.subscribeVisibleLogicalRangeChange?.(timeHandler);
    priceScale?.subscribeVisibleLogicalRangeChange?.(priceHandler);

    return () => {
      timeScale?.unsubscribeVisibleTimeRangeChange?.(timeHandler);
      timeScale?.unsubscribeVisibleLogicalRangeChange?.(timeHandler);
      priceScale?.unsubscribeVisibleLogicalRangeChange?.(priceHandler);
      if (rangeRafRef.current != null) {
        window.cancelAnimationFrame(rangeRafRef.current);
        rangeRafRef.current = null;
      }
    };
  }, [chart]);

  const activeBar = activeIndex != null ? bars[activeIndex] : null;
  const showPositionInfo = showOverlay || showPnL;
  const activePositionTime = useMemo(
    () => (showPositionInfo && activeBar ? findClosestTime(positionTimes, activeBar.time) : null),
    [positionTimes, activeBar?.time, showPositionInfo]
  );
  const activePositions = useMemo(() => {
    if (activePositionTime == null) return [];
    return positionsByTime.get(activePositionTime) ?? [];
  }, [positionsByTime, activePositionTime]);
  const activeTradeMarkers = useMemo(() => {
    if (!showOverlay || !showMarkers || activePositionTime == null) return [];
    return tradeMarkers.filter((trade) => trade.time === activePositionTime);
  }, [tradeMarkers, showOverlay, showMarkers, activePositionTime]);

  const labelEntries = useMemo(() => {
    if (!showMarkers || !showOverlay || !chart || !candleSeries) return [];
    const timeScale = chart.timeScale?.();
    if (!timeScale || typeof timeScale.timeToCoordinate !== "function") return [];
    if (typeof candleSeries.priceToCoordinate !== "function") return [];

    const barsByTime = new Map(bars.map((bar) => [bar.time, bar]));
    const groups = new Map<string, { brokerKey: string; entries: DailyPosition[] }>();
    dailyPositions.forEach((pos) => {
      const groupKey = pos.brokerGroupKey ?? pos.brokerKey ?? "unknown";
      const brokerKey = pos.brokerKey ?? "unknown";
      const list = groups.get(groupKey);
      if (list) {
        list.entries.push(pos);
      } else {
        groups.set(groupKey, { brokerKey, entries: [pos] });
      }
    });

    const changes: { time: number; text: string; brokerKey: string }[] = [];
    groups.forEach((group) => {
      const sorted = [...group.entries].sort((a, b) => a.time - b.time);
      let prevText = "";
      sorted.forEach((pos) => {
        if (pos.posText === "0-0") {
          prevText = pos.posText;
          return;
        }
        if (pos.posText !== prevText) {
          changes.push({ time: pos.time, text: pos.posText, brokerKey: group.brokerKey });
          prevText = pos.posText;
        }
      });
    });
    changes.sort((a, b) => a.time - b.time);

    const visibleRange = timeScale.getVisibleRange?.();
    const visibleFrom = normalizeTimeValue(visibleRange?.from ?? null);
    const visibleTo = normalizeTimeValue(visibleRange?.to ?? null);
    const lastBarTime = bars.length ? bars[bars.length - 1].time : null;
    const twoYearsSec = 60 * 60 * 24 * 365 * 2;
    const baseFrom = lastBarTime != null ? lastBarTime - twoYearsSec : null;
    const rangeFrom =
      baseFrom != null && visibleFrom != null ? Math.min(baseFrom, visibleFrom) : baseFrom ?? visibleFrom;
    const rangeTo =
      lastBarTime != null && visibleTo != null ? Math.max(lastBarTime, visibleTo) : lastBarTime ?? visibleTo;
    const limited = changes.filter((entry) => {
      if (rangeFrom != null && entry.time < rangeFrom) return false;
      if (rangeTo != null && entry.time > rangeTo) return false;
      return true;
    });
    const byTime = new Map<number, { text: string; brokerKey: string }[]>();
    limited.forEach((entry) => {
      const list = byTime.get(entry.time) ?? [];
      list.push({ text: entry.text, brokerKey: entry.brokerKey });
      byTime.set(entry.time, list);
    });

    const output: { key: string; text: string; brokerKey: string; x: number; y: number }[] = [];
    const placed: { x: number; y: number }[] = [];
    byTime.forEach((list, time) => {
      const bar = barsByTime.get(time);
      if (!bar) return;
      const x = timeScale.timeToCoordinate(time as any);
      const yBase = candleSeries.priceToCoordinate(bar.high) ?? candleSeries.priceToCoordinate(bar.close);
      if (x == null || yBase == null) return;
      list.sort((a, b) => compareBrokerKey(a.brokerKey, b.brokerKey));
      list.forEach((entry, index) => {
        const y = yBase - 8 - index * 12;
        const collision = placed.some(
          (item) => Math.abs(item.x - x) < 12 && Math.abs(item.y - y) < 10
        );
        if (collision) return;
        placed.push({ x, y });
        output.push({
          key: `${time}-${entry.brokerKey}`,
          text: entry.text,
          brokerKey: entry.brokerKey,
          x,
          y
        });
      });
    });
    return output;
  }, [showMarkers, showOverlay, chart, candleSeries, bars, dailyPositions, rangeTick]);

  if (!activeBar) return null;

  const volumeValue = volumeMap.get(activeBar.time);
  const volumeText = Number.isFinite(volumeValue) ? formatNumber(volumeValue ?? 0) : "-";

  const prevBar = activeIndex != null && activeIndex > 0 ? bars[activeIndex - 1] : null;
  const delta = prevBar ? activeBar.close - prevBar.close : null;
  const percent =
    prevBar && prevBar.close !== 0 ? ((activeBar.close - prevBar.close) / prevBar.close) * 100 : null;
  const deltaClass = delta && delta > 0 ? "up" : delta && delta < 0 ? "down" : "";


  return (
    <>
      {labelEntries.length > 0 && (
        <div className="position-marker-layer">
          {labelEntries.map((entry) => (
            <div
              key={entry.key}
              className={`position-marker-label broker-${entry.brokerKey}`}
              style={{ left: `${entry.x}px`, top: `${entry.y}px` }}
            >
              {entry.text}
            </div>
          ))}
        </div>
      )}
      <div className="position-overlay-panel">
        <div className="position-overlay-header">
        <div className="position-overlay-date">{formatDate(activeBar.time)}</div>
        {delta != null && percent != null && (
          <div className={`position-overlay-change ${deltaClass}`}>
            Chg {formatSignedNumber(delta)} ({formatPercent(percent)})
          </div>
        )}
        </div>
        <div className="position-overlay-grid">
        <div className="position-overlay-label">O</div>
        <div className="position-overlay-value">{formatNumber(activeBar.open)}</div>
        <div className="position-overlay-label">H</div>
        <div className="position-overlay-value">{formatNumber(activeBar.high)}</div>
        <div className="position-overlay-label">L</div>
        <div className="position-overlay-value">{formatNumber(activeBar.low)}</div>
        <div className="position-overlay-label">C</div>
        <div className="position-overlay-value">{formatNumber(activeBar.close)}</div>
        <div className="position-overlay-label">Vol</div>
        <div className="position-overlay-value">{volumeText}</div>
        </div>
        {showPositionInfo && activePositions.length > 0 && (
          <div className="position-overlay-block">
            {activePositions.map((position) => {
              const brokerKey = position.brokerKey ?? "unknown";
              const brokerLabel = position.brokerLabel ?? "N/A";
              return (
                <div
                  key={`${position.time}-${position.brokerGroupKey ?? brokerKey}`}
                  className={`position-overlay-broker broker-${brokerKey}`}
                >
                  <div className="position-overlay-row">
                    <span className="position-overlay-label">Position</span>
                    <span className="position-overlay-value">
                      <span className="broker-badge">{brokerLabel}</span>
                      {position.posText} (Sell-Buy)
                    </span>
                  </div>
                  {showPnL && (
                    <>
                      <div className="position-overlay-row">
                        <span className="position-overlay-label">Unrealized</span>
                        <span className="position-overlay-value">
                          {formatNumber(position.unrealizedPnL)}
                        </span>
                      </div>
                      <div className="position-overlay-row">
                        <span className="position-overlay-label">Realized</span>
                        <span className="position-overlay-value">
                          {formatNumber(position.realizedPnL)}
                        </span>
                      </div>
                      <div className="position-overlay-row total">
                        <span className="position-overlay-label">Total</span>
                        <span className="position-overlay-value">
                          {formatNumber(position.totalPnL)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {showOverlay && showMarkers && activeTradeMarkers.length > 0 && (
          <div className="position-overlay-trades">
            {activeTradeMarkers.map((marker) => {
              const brokerKey = marker.brokerKey ?? resolveBrokerMeta(marker.trades[0]?.broker).key;
              const brokerLabel = marker.brokerLabel ?? resolveBrokerMeta(marker.trades[0]?.broker).label;
              return (
                <div key={`${marker.time}-${marker.brokerGroupKey ?? brokerKey}`} className={`broker-${brokerKey}`}>
                  <div className="position-overlay-trade-header">
                    <span className="broker-badge">{brokerLabel}</span>
                  </div>
                  {marker.trades.map((trade, index) => (
                    <div key={`${trade.date}-${trade.kind ?? "trade"}-${index}`}>
                      {formatTrade(trade)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
