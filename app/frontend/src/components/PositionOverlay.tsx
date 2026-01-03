import { useEffect, useMemo, useRef } from "react";
import type { ISeriesApi } from "lightweight-charts";
import type { DailyPosition, TradeEvent, TradeMarker } from "../utils/positions";

type PositionOverlayProps = {
  candleSeries: ISeriesApi<"Candlestick"> | null;
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

const findClosest = (positions: DailyPosition[], time: number | null) => {
  if (!positions.length) return null;
  if (time == null) return null;
  let left = 0;
  let right = positions.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = positions[mid].time;
    if (midTime === time) return positions[mid];
    if (midTime < time) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return positions[Math.max(0, Math.min(positions.length - 1, right))] ?? null;
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

const formatTrade = (trade: TradeEvent) => {
  const action = trade.action === "open" ? "OPEN" : "CLOSE";
  const side = trade.side.toUpperCase();
  const units = Number.isFinite(trade.units) ? formatNumber(trade.units) : "0";
  const price = trade.price ? ` @ ${formatNumber(trade.price)}` : "";
  return `${side} ${action} ${units}${price}`;
};

export default function PositionOverlay({
  candleSeries,
  dailyPositions,
  tradeMarkers,
  showOverlay,
  showPnL,
  hoverTime,
  bars,
  volume,
  showMarkers = true
}: PositionOverlayProps) {
  const lastMarkersKeyRef = useRef<string>("");
  const volumeMap = useMemo(
    () => new Map(volume.map((item) => [item.time, item.value])),
    [volume]
  );
  const activeIndex = useMemo(() => findClosestIndex(bars, hoverTime), [bars, hoverTime]);

  const markers = useMemo(() => {
    if (!showMarkers) return [];
    const positionMap = new Map(dailyPositions.map((pos) => [pos.time, pos.posText]));
    return tradeMarkers.map((marker) => {
      const text = positionMap.get(marker.time) ?? "";
      const net = marker.buyLots - marker.sellLots;
      return {
        time: marker.time as any,
        position: net >= 0 ? "aboveBar" : "belowBar",
        color: net >= 0 ? "#ef4444" : "#22c55e",
        shape: "circle",
        text
      };
    });
  }, [tradeMarkers, dailyPositions, showMarkers]);

  useEffect(() => {
    if (!candleSeries) return;
    if (!showOverlay || !showMarkers) {
      candleSeries.setMarkers([]);
      lastMarkersKeyRef.current = "";
      return;
    }
    const key = markers.map((marker) => `${marker.time}-${marker.text}`).join("|");
    if (lastMarkersKeyRef.current === key) return;
    lastMarkersKeyRef.current = key;
    candleSeries.setMarkers(markers);
  }, [candleSeries, markers, showOverlay, showMarkers]);

  if (activeIndex == null) return null;

  const activeBar = bars[activeIndex];
  if (!activeBar) return null;

  const volumeValue = volumeMap.get(activeBar.time);
  const volumeText = Number.isFinite(volumeValue) ? formatNumber(volumeValue ?? 0) : "-";

  const prevBar = activeIndex > 0 ? bars[activeIndex - 1] : null;
  const delta = prevBar ? activeBar.close - prevBar.close : null;
  const percent =
    prevBar && prevBar.close !== 0 ? ((activeBar.close - prevBar.close) / prevBar.close) * 100 : null;
  const deltaClass = delta && delta > 0 ? "up" : delta && delta < 0 ? "down" : "";

  const showPositionInfo = showOverlay || showPnL;
  const activePosition = showPositionInfo ? findClosest(dailyPositions, activeBar.time) : null;
  const activeTrades = activePosition
    ? tradeMarkers.find((trade) => trade.time === activePosition.time)
    : null;

  return (
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
      {showPositionInfo && activePosition && (
        <div className="position-overlay-block">
          <div className="position-overlay-row">
            <span className="position-overlay-label">Position</span>
            <span className="position-overlay-value">{activePosition.posText} (Sell-Buy)</span>
          </div>
          {showPnL && (
            <>
              <div className="position-overlay-row">
                <span className="position-overlay-label">Unrealized</span>
                <span className="position-overlay-value">
                  {formatNumber(activePosition.unrealizedPnL)}
                </span>
              </div>
              <div className="position-overlay-row">
                <span className="position-overlay-label">Realized</span>
                <span className="position-overlay-value">
                  {formatNumber(activePosition.realizedPnL)}
                </span>
              </div>
              <div className="position-overlay-row total">
                <span className="position-overlay-label">Total</span>
                <span className="position-overlay-value">
                  {formatNumber(activePosition.totalPnL)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
      {showOverlay && showMarkers && activeTrades && (
        <div className="position-overlay-trades">
          {activeTrades.trades.map((trade, index) => (
            <div key={`${trade.date}-${trade.kind ?? "trade"}-${index}`}>
              {formatTrade(trade)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
