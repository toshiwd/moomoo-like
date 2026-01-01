import { memo } from "react";
import { Ticker, useStore } from "../store";
import ThumbnailCanvas from "./ThumbnailCanvas";

const StockTile = memo(function StockTile({
  ticker,
  timeframe,
  onDoubleClick
}: {
  ticker: Ticker;
  timeframe: "monthly" | "weekly" | "daily";
  onDoubleClick: () => void;
}) {
  const barsPayload = useStore((state) => {
    const map = state.barsCache?.[timeframe] ?? {};
    return map[ticker.code];
  });
  const boxes = useStore((state) => {
    const map = state.boxesCache?.[timeframe] ?? {};
    return map[ticker.code] ?? [];
  });
  const barsStatus = useStore((state) => {
    const map = state.barsStatus?.[timeframe] ?? {};
    return map[ticker.code] ?? "idle";
  });
  const showBoxes = useStore((state) => state.settings.showBoxes);

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
        {barsPayload && barsPayload.bars?.length ? (
          <ThumbnailCanvas
            payload={barsPayload}
            boxes={boxes}
            showBoxes={showBoxes}
            timeframe={timeframe}
          />
        ) : (
          <div className="tile-loading">
            {barsStatus === "error"
              ? "Load failed"
              : barsStatus === "empty"
              ? "No data"
              : "Loading..."}
          </div>
        )}
      </div>
    </button>
  );
});

export default StockTile;
