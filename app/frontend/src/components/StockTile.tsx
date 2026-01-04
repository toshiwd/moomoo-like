import { memo } from "react";
import { Ticker, useStore } from "../store";
import type { SignalChip } from "../utils/signals";
import ThumbnailCanvas from "./ThumbnailCanvas";
import { buildThumbnailCacheKey, getThumbnailCache } from "./thumbnailCache";

const StockTile = memo(function StockTile({
  ticker,
  timeframe,
  onOpenDetail,
  signals,
  trendStrength,
  exhaustionRisk,
  selected = false,
  onToggleSelect
}: {
  ticker: Ticker;
  timeframe: "monthly" | "weekly" | "daily";
  signals?: SignalChip[];
  trendStrength?: number | null;
  exhaustionRisk?: number | null;
  onOpenDetail: (code: string) => void;
  selected?: boolean;
  onToggleSelect?: (code: string) => void;
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
  const maSettings = useStore((state) => {
    const map = state.maSettings;
    if (!map) return [];
    return timeframe === "daily"
      ? map.daily ?? []
      : timeframe === "weekly"
      ? map.weekly ?? []
      : map.monthly ?? [];
  });
  const showBoxes = useStore((state) => state.settings.showBoxes);
  const cacheKey = buildThumbnailCacheKey(ticker.code, timeframe, showBoxes, maSettings);
  const cachedThumb = getThumbnailCache(cacheKey);

  const stageLabel = (ticker.stage ?? "").trim();
  const showStage = stageLabel.length > 0 && stageLabel.toUpperCase() !== "UNKNOWN";
  const stageClass = stageLabel.toLowerCase();
  const scoreText =
    typeof trendStrength === "number"
      ? `TS:${trendStrength >= 0 ? "+" : ""}${Math.round(trendStrength)}`
      : null;
  const riskText =
    typeof exhaustionRisk === "number" ? `ER:${Math.round(exhaustionRisk)}` : null;

  return (
    <div
      className={`tile ${selected ? "is-selected" : ""}`}
      role="button"
      tabIndex={0}
      onDoubleClick={() => onOpenDetail(ticker.code)}
    >
      <div className="tile-header">
        <div className="tile-id">
          {onToggleSelect ? (
            <>
              <label
                className="tile-select-toggle"
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(ticker.code)}
                  aria-label={`${ticker.code} を選択`}
                />
                <span className="tile-code">{ticker.code}</span>
              </label>
              <span className="tile-name">{ticker.name}</span>
            </>
          ) : (
            <>
              <span className="tile-code">{ticker.code}</span>
              <span className="tile-name">{ticker.name}</span>
            </>
          )}
        </div>
        <div className="tile-meta">
          {showStage && <span className={`badge stage-${stageClass}`}>{stageLabel}</span>}
          <span className="score">{ticker.score?.toFixed(1) ?? "--"}</span>
        </div>
      </div>
      {(signals?.length || scoreText || riskText) && (
        <div className="tile-signal-row">
          <div className="signal-chips">
            {signals?.slice(0, 5).map((signal) => (
              <span
                key={signal.label}
                className={`signal-chip ${signal.kind === "warning" ? "warning" : "achieved"}`}
              >
                {signal.label}
              </span>
            ))}
          </div>
          <div className="tile-scores">
            {scoreText && (
              <span
                className={`score-chip ${
                  typeof trendStrength === "number" && trendStrength < 0 ? "down" : "up"
                }`}
              >
                {scoreText}
              </span>
            )}
            {riskText && <span className="score-chip">{riskText}</span>}
          </div>
        </div>
      )}
      <div className="tile-chart">
        {barsPayload && barsPayload.bars?.length ? (
          <ThumbnailCanvas
            payload={barsPayload}
            boxes={boxes}
            showBoxes={showBoxes}
            maSettings={maSettings}
            cacheKey={cacheKey}
            showAxes
          />
        ) : cachedThumb ? (
          <div className="thumb-canvas">
            <img className="thumb-canvas-image" src={cachedThumb} alt="" />
          </div>
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
    </div>
  );
});

export default StockTile;
