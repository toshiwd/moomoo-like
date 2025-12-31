import { memo } from "react";
import { Ticker } from "../store";
import Sparkline from "./Sparkline";

const StockTile = memo(function StockTile({
  ticker,
  onClick
}: {
  ticker: Ticker;
  onClick: () => void;
}) {
  return (
    <button className="tile" type="button" onClick={onClick}>
      <div className="tile-header">
        <div>
          <div className="tile-code">{ticker.code}</div>
          <div className="tile-name">{ticker.name}</div>
        </div>
        <div className="tile-meta">
          <span className={`badge stage-${ticker.stage || "na"}`}>{ticker.stage || "n/a"}</span>
          <span className="score">{ticker.score?.toFixed(1) ?? "--"}</span>
        </div>
      </div>
      <div className="tile-chart">
        <Sparkline code={ticker.code} />
      </div>
    </button>
  );
});

export default StockTile;