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
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
};

const findClosest = (positions: DailyPosition[], time: number | null) => {
  if (!positions.length) return null;
  if (time == null) return positions[positions.length - 1];
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
  hoverTime
}: PositionOverlayProps) {
  const lastMarkersKeyRef = useRef<string>("");

  const markers = useMemo(() => {
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
  }, [tradeMarkers, dailyPositions]);

  useEffect(() => {
    if (!candleSeries) return;
    if (!showOverlay) {
      candleSeries.setMarkers([]);
      lastMarkersKeyRef.current = "";
      return;
    }
    const key = markers.map((marker) => `${marker.time}-${marker.text}`).join("|");
    if (lastMarkersKeyRef.current === key) return;
    lastMarkersKeyRef.current = key;
    candleSeries.setMarkers(markers);
  }, [candleSeries, markers, showOverlay]);

  if (!showOverlay) {
    return null;
  }

  const activePosition = findClosest(dailyPositions, hoverTime);
  const activeTrades = activePosition
    ? tradeMarkers.find((trade) => trade.time === activePosition.time)
    : null;

  if (!activePosition) return null;

  return (
    <div className="position-overlay-panel">
      <div className="position-overlay-title">
        {activePosition.date} / Close {formatNumber(activePosition.close)}
      </div>
      <div className="position-overlay-row">
        Position {activePosition.posText} (Sell-Buy)
      </div>
      {showPnL && (
        <>
          <div className="position-overlay-row">
            Unrealized {formatNumber(activePosition.unrealizedPnL)}
          </div>
          <div className="position-overlay-row">
            Realized {formatNumber(activePosition.realizedPnL)}
          </div>
          <div className="position-overlay-row total">
            Total {formatNumber(activePosition.totalPnL)}
          </div>
        </>
      )}
      {activeTrades && (
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
