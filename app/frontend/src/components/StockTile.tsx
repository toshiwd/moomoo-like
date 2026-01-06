import { memo, type MouseEvent } from "react";
import { Ticker, useStore } from "../store";
import type { SignalChip } from "../utils/signals";
import ThumbnailCanvas from "./ThumbnailCanvas";
import { buildThumbnailCacheKey, getThumbnailCache } from "./thumbnailCache";

type StockTileProps = {
  ticker: Ticker;
  timeframe: "monthly" | "weekly" | "daily";
  signals?: SignalChip[];
  active?: boolean;
  kept?: boolean;
  onActivate?: (code: string) => void;
  onOpenDetail: (code: string) => void;
  onToggleKeep?: (code: string) => void;
  onExclude?: (code: string) => void;
};

const StockTile = memo(function StockTile({
  ticker,
  timeframe,
  signals,
  active = false,
  kept = false,
  onActivate,
  onOpenDetail,
  onToggleKeep,
  onExclude
}: StockTileProps) {
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

  const handleActivate = () => onActivate?.(ticker.code);
  const handleOpenDetail = () => onOpenDetail(ticker.code);
  const handleToggleKeep = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleKeep?.(ticker.code);
  };
  const handleExclude = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onExclude?.(ticker.code);
  };
  const handleOpenClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleOpenDetail();
  };

  return (
    <div
      className={`tile ${active ? "is-selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onDoubleClick={handleOpenDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleOpenDetail();
        }
      }}
    >
      <div className="tile-header">
        <div className="tile-id">
          <span className="tile-code">{ticker.code}</span>
          <span className="tile-name">{ticker.name}</span>
          {ticker.dataStatus === "missing" && (
            <span className="badge status-missing">未取込</span>
          )}
        </div>
        <div className="tile-actions">
          <button
            type="button"
            className={`tile-action ${kept ? "active" : ""}`}
            onClick={handleToggleKeep}
            aria-label={kept ? "候補箱から外す" : "候補箱へ追加"}
          >
            +
          </button>
          <button
            type="button"
            className="tile-action danger"
            onClick={handleExclude}
            aria-label="除外"
          >
            x
          </button>
          <button
            type="button"
            className="tile-action"
            onClick={handleOpenClick}
            aria-label="詳細を開く"
          >
            &gt;
          </button>
        </div>
      </div>
      {signals?.length ? (
        <div className="tile-signal-row">
          <div className="signal-chips">
            {signals.slice(0, 4).map((signal) => (
              <span
                key={signal.label}
                className={`signal-chip ${signal.kind === "warning" ? "warning" : "achieved"}`}
              >
                {signal.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
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
              ? "読み込み失敗"
              : barsStatus === "empty"
              ? "データなし"
              : "読み込み中..."}
          </div>
        )}
      </div>
    </div>
  );
});

export default StockTile;
