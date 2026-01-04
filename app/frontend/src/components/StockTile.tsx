import { memo, useEffect, useState } from "react";
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
  onToggleSelect,
  menuOpen = false,
  onToggleMenu,
  onRemoveWatchlist
}: {
  ticker: Ticker;
  timeframe: "monthly" | "weekly" | "daily";
  signals?: SignalChip[];
  trendStrength?: number | null;
  exhaustionRisk?: number | null;
  onOpenDetail: (code: string) => void;
  selected?: boolean;
  onToggleSelect?: (code: string) => void;
  menuOpen?: boolean;
  onToggleMenu?: (code: string) => void;
  onRemoveWatchlist?: (code: string, deleteArtifacts: boolean) => void;
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
  const [deleteArtifacts, setDeleteArtifacts] = useState(true);
  const cacheKey = buildThumbnailCacheKey(ticker.code, timeframe, showBoxes, maSettings);
  const cachedThumb = getThumbnailCache(cacheKey);

  const rawStageLabel = (ticker.stage ?? "").trim();
  const scoreStatus =
    ticker.scoreStatus ?? (Number.isFinite(ticker.score) ? "OK" : "INSUFFICIENT_DATA");
  const scoreOk =
    scoreStatus === "OK" &&
    Number.isFinite(ticker.score) &&
    typeof ticker.score === "number" &&
    ticker.score > 0;
  const stageLabel = rawStageLabel;
  const showStage =
    stageLabel.length > 0 && stageLabel.toUpperCase() !== "UNKNOWN";
  const stageClass = stageLabel.toLowerCase();
  const missingTitle =
    !scoreOk && ticker.missingReasons?.length
      ? `missing: ${ticker.missingReasons.join(", ")}`
      : undefined;
  const scoreText =
    typeof trendStrength === "number"
      ? `TS:${trendStrength >= 0 ? "+" : ""}${Math.round(trendStrength)}`
      : null;
  const riskText =
    typeof exhaustionRisk === "number" ? `ER:${Math.round(exhaustionRisk)}` : null;

  useEffect(() => {
    if (!menuOpen) {
      setDeleteArtifacts(true);
    }
  }, [menuOpen]);

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
              {ticker.dataStatus === "missing" && (
                <span className="badge status-missing">未取得</span>
              )}
            </>
          ) : (
            <>
              <span className="tile-code">{ticker.code}</span>
              <span className="tile-name">{ticker.name}</span>
              {ticker.dataStatus === "missing" && (
                <span className="badge status-missing">未取得</span>
              )}
            </>
          )}
        </div>
        <div className="tile-meta" title={missingTitle}>
          {showStage && <span className={`badge stage-${stageClass}`}>{stageLabel}</span>}
          {scoreOk && <span className="score">{ticker.score?.toFixed(1)}</span>}
          {onToggleMenu && (
            <div className="tile-menu">
              <button
                type="button"
                className="tile-menu-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleMenu(ticker.code);
                }}
                aria-label="ウォッチリスト操作"
              >
                ...
              </button>
              {menuOpen && (
                <div
                  className="tile-menu-panel"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <div className="tile-menu-title">ウォッチリストから削除</div>
                  <label className="tile-menu-check">
                    <input
                      type="checkbox"
                      checked={deleteArtifacts}
                      onChange={(event) => setDeleteArtifacts(event.target.checked)}
                    />
                    データも削除（退避）
                  </label>
                  <button
                    type="button"
                    className="tile-menu-action"
                    onClick={() => {
                      onRemoveWatchlist?.(ticker.code, deleteArtifacts);
                      onToggleMenu(ticker.code);
                    }}
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          )}
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
