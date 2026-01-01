import { memo } from "react";
import { BarsPayload, Ticker, useStore } from "../store";
import ThumbnailCanvas from "./ThumbnailCanvas";

const StockTile = memo(function StockTile({
  ticker,
  timeframe,
  onDoubleClick
}: {
  ticker: Ticker;
  timeframe: "monthly" | "daily";
  onDoubleClick: () => void;
}) {
  const barsPayload = useStore((state) => state.barsCache[timeframe][ticker.code]);

  const stageLabel = ticker.stage || "UNKNOWN";
  const stageClass = stageLabel.toLowerCase();

  return (
    <button className="tile" type="button" onDoubleClick={onDoubleClick}>
      <div className="tile-header">
        <div>
          <div className="tile-code">{ticker.code}</div>
          <div className="tile-name">{ticker.name}</div>
        </div>
        <div className="tile-meta">
          <span className={`badge stage-${stageClass}`}>{stageLabel}</span>
          <span className="score">{ticker.score?.toFixed(1) ?? "--"}</span>
        </div>
      </div>
      <div className="tile-chart">
        {barsPayload ? (
          <ThumbnailCanvas payload={barsPayload} />
        ) : (
          <div className="tile-loading">Loading...</div>
        )}
      </div>
    </button>
  );
});

export default StockTile;