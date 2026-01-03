import { useEffect, useMemo, useRef, useState } from "react";
import { FixedSizeGrid as Grid, GridOnItemsRenderedProps } from "react-window";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { MaSetting, SortDir, SortKey } from "../store";
import { useStore } from "../store";
import StockTile from "../components/StockTile";
import { computeSignalMetrics } from "../utils/signals";

const TILE_HEIGHT = 220;
const GRID_GAP = 12;
type Timeframe = "monthly" | "weekly" | "daily";

function useResizeObserver() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const element = ref.current;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

type HealthStatus = {
  txt_count: number;
  code_count: number;
  last_updated: string | null;
  code_txt_missing: boolean;
};

export default function GridView() {
  const navigate = useNavigate();
  const { ref, size } = useResizeObserver();
  const tickers = useStore((state) => state.tickers);
  const loadList = useStore((state) => state.loadList);
  const ensureBarsForVisible = useStore((state) => state.ensureBarsForVisible);
  const barsCache = useStore((state) => state.barsCache);
  const columns = useStore((state) => state.settings.columns);
  const search = useStore((state) => state.settings.search);
  const gridScrollTop = useStore((state) => state.settings.gridScrollTop);
  const gridTimeframe = useStore((state) => state.settings.gridTimeframe);
  const setColumns = useStore((state) => state.setColumns);
  const setSearch = useStore((state) => state.setSearch);
  const setGridScrollTop = useStore((state) => state.setGridScrollTop);
  const setGridTimeframe = useStore((state) => state.setGridTimeframe);
  const showBoxes = useStore((state) => state.settings.showBoxes);
  const setShowBoxes = useStore((state) => state.setShowBoxes);
  const sortKey = useStore((state) => state.settings.sortKey);
  const sortDir = useStore((state) => state.settings.sortDir);
  const setSortKey = useStore((state) => state.setSortKey);
  const setSortDir = useStore((state) => state.setSortDir);
  const maSettings = useStore((state) => state.maSettings);
  const updateMaSetting = useStore((state) => state.updateMaSetting);
  const resetMaSettings = useStore((state) => state.resetMaSettings);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [showIndicators, setShowIndicators] = useState(false);
  const lastVisibleCodesRef = useRef<string[]>([]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    api.get("/health").then((res) => {
      setHealth(res.data as HealthStatus);
    });
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tickers;
    return tickers.filter((item) => {
      return item.code.toLowerCase().includes(term) || item.name.toLowerCase().includes(term);
    });
  }, [tickers, search]);

  const scoredTickers = useMemo(() => {
    return filtered.map((ticker, index) => {
      const payload = barsCache[gridTimeframe][ticker.code];
      const metrics = payload?.bars?.length ? computeSignalMetrics(payload.bars) : null;
      return { ticker, metrics, index };
    });
  }, [filtered, barsCache, gridTimeframe]);

  const sortedTickers = useMemo(() => {
    const items = [...scoredTickers];
    const boxOrder: Record<string, number> = {
      BREAKOUT_UP: 3,
      IN_BOX: 2,
      BREAKOUT_DOWN: 1,
      NONE: 0
    };
    const getSortValue = (ticker: typeof scoredTickers[number]["ticker"]) => {
      if ((sortKey === "upScore" || sortKey === "downScore") && ticker.statusLabel === "UNKNOWN") {
        return null;
      }
      if (sortKey === "code") return ticker.code;
      if (sortKey === "name") return ticker.name ?? "";
      if (sortKey === "chg1D") return ticker.chg1D ?? null;
      if (sortKey === "chg1W") return ticker.chg1W ?? null;
      if (sortKey === "chg1M") return ticker.chg1M ?? null;
      if (sortKey === "chg1Q") return ticker.chg1Q ?? null;
      if (sortKey === "chg1Y") return ticker.chg1Y ?? null;
      if (sortKey === "upScore") return ticker.scores?.upScore ?? null;
      if (sortKey === "downScore") return ticker.scores?.downScore ?? null;
      if (sortKey === "overheatUp") return ticker.scores?.overheatUp ?? null;
      if (sortKey === "overheatDown") return ticker.scores?.overheatDown ?? null;
      if (sortKey === "boxState") {
        const state = ticker.boxState ?? "NONE";
        return boxOrder[state] ?? 0;
      }
      return null;
    };
    const compare = (a: typeof scoredTickers[number], b: typeof scoredTickers[number]) => {
      const av = getSortValue(a.ticker);
      const bv = getSortValue(b.ticker);
      const aMissing =
        av === null ||
        av === undefined ||
        (typeof av === "number" && !Number.isFinite(av)) ||
        (typeof av === "string" && av.trim() === "");
      const bMissing =
        bv === null ||
        bv === undefined ||
        (typeof bv === "number" && !Number.isFinite(bv)) ||
        (typeof bv === "string" && bv.trim() === "");
      if (aMissing && bMissing) return a.ticker.code.localeCompare(b.ticker.code);
      if (aMissing) return 1;
      if (bMissing) return -1;
      let result = 0;
      if (typeof av === "string" || typeof bv === "string") {
        result = String(av).localeCompare(String(bv));
      } else {
        result = Number(av) - Number(bv);
      }
      if (result === 0) return a.ticker.code.localeCompare(b.ticker.code);
      return sortDir === "desc" ? -result : result;
    };
    items.sort(compare);
    return items;
  }, [scoredTickers, sortKey, sortDir]);

  const gridHeight = Math.max(200, size.height);
  const gridWidth = Math.max(0, size.width);
  const innerHeight = Math.max(0, gridHeight);
  const rowCount = Math.ceil(sortedTickers.length / columns);
  const columnWidth = gridWidth > 0 ? gridWidth / columns : 300;

  const onItemsRendered = ({
    visibleRowStartIndex,
    visibleRowStopIndex,
    visibleColumnStartIndex,
    visibleColumnStopIndex
  }: GridOnItemsRenderedProps) => {
    const rowsPerViewport = Math.max(1, Math.floor(gridHeight / (TILE_HEIGHT + GRID_GAP)));
    const prefetchStop = visibleRowStopIndex + rowsPerViewport;
    const start = visibleRowStartIndex * columns + visibleColumnStartIndex;
    const stop = Math.min(sortedTickers.length - 1, prefetchStop * columns + visibleColumnStopIndex);

    if (start > stop) return;
    const codes: string[] = [];
    for (let index = start; index <= stop; index += 1) {
      const item = sortedTickers[index];
      if (item) codes.push(item.ticker.code);
    }
    lastVisibleCodesRef.current = codes;
    ensureBarsForVisible(gridTimeframe, codes);
  };

  useEffect(() => {
    if (!lastVisibleCodesRef.current.length) return;
    ensureBarsForVisible(gridTimeframe, lastVisibleCodesRef.current);
  }, [gridTimeframe, maSettings, ensureBarsForVisible]);

  const updateSetting = (frame: Timeframe, index: number, patch: Partial<MaSetting>) => {
    updateMaSetting(frame, index, patch);
  };

  const resetSettings = (frame: Timeframe) => {
    resetMaSettings(frame);
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <div className="title">Moomoo-like Screener</div>
          <div className="subtitle">Fast grid with canvas sparklines</div>
        </div>
        <div className="controls">
          <div className="segmented">
            {["monthly", "weekly", "daily"].map((value) => (
              <button
                key={value}
                className={gridTimeframe === value ? "active" : ""}
                onClick={() => setGridTimeframe(value as "monthly" | "weekly" | "daily")}
              >
                {value === "monthly" ? "Monthly" : value === "weekly" ? "Weekly" : "Daily"}
              </button>
            ))}
          </div>
          <input
            className="search"
            placeholder="Search code or name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="sort-select"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
          >
            <option value="code">Code</option>
            <option value="name">Name</option>
            <option value="chg1D">Chg 1D</option>
            <option value="chg1W">Chg 1W</option>
            <option value="chg1M">Chg 1M</option>
            <option value="chg1Q">Chg 1Q</option>
            <option value="chg1Y">Chg 1Y</option>
            <option value="upScore">Up Score</option>
            <option value="downScore">Down Score</option>
            <option value="overheatUp">Overheat Up</option>
            <option value="overheatDown">Overheat Down</option>
            <option value="boxState">Box State</option>
          </select>
          <div className="segmented">
            {(["asc", "desc"] as SortDir[]).map((dir) => (
              <button
                key={dir}
                className={sortDir === dir ? "active" : ""}
                onClick={() => setSortDir(dir)}
              >
                {dir.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            className={showBoxes ? "indicator-button active" : "indicator-button"}
            onClick={() => setShowBoxes(!showBoxes)}
          >
            Boxes
          </button>
          <button className="indicator-button" onClick={() => setShowIndicators(true)}>
            Indicators
          </button>
          <div className="segmented">
            {[2, 3, 4].map((count) => (
              <button
                key={count}
                className={columns === count ? "active" : ""}
                onClick={() => setColumns(count as 2 | 3 | 4)}
              >
                {count} cols
              </button>
            ))}
          </div>
        </div>
      </header>
      {health && health.txt_count === 0 && (
        <div className="data-warning">
          TXTが見つかりません。PANROLLINGで出力したTXTを `data/txt` に配置してください。
        </div>
      )}
      {health && health.code_txt_missing && health.txt_count > 0 && (
        <div className="data-warning subtle">
          code.txt がありません。ファイル名から銘柄コードを推定しています（code.txt推奨）。
        </div>
      )}
      <div className="grid-shell" ref={ref}>
        {size.width > 0 && (
          <div className="grid-inner">
            <Grid
              key={gridTimeframe}
              columnCount={columns}
              columnWidth={columnWidth}
              height={innerHeight}
              rowCount={rowCount}
              rowHeight={TILE_HEIGHT + GRID_GAP}
              width={gridWidth}
              overscanRowCount={2}
              onItemsRendered={onItemsRendered}
              initialScrollTop={gridScrollTop}
              onScroll={({ scrollTop }) => setGridScrollTop(scrollTop)}
            >
              {({ columnIndex, rowIndex, style }) => {
                const index = rowIndex * columns + columnIndex;
                const item = sortedTickers[index];
                if (!item) return null;
                const cellStyle = {
                  ...style,
                  padding: GRID_GAP / 2,
                  boxSizing: "border-box"
                };
                return (
                  <div style={cellStyle}>
                    <StockTile
                      ticker={item.ticker}
                      timeframe={gridTimeframe}
                      signals={item.metrics?.signals ?? []}
                      trendStrength={item.metrics?.trendStrength ?? null}
                      exhaustionRisk={item.metrics?.exhaustionRisk ?? null}
                      onDoubleClick={() => navigate(`/detail/${item.ticker.code}`)}
                    />
                  </div>
                );
              }}
            </Grid>
          </div>
        )}
      </div>
      {showIndicators && (
        <div className="indicator-overlay" onClick={() => setShowIndicators(false)}>
          <div className="indicator-panel" onClick={(event) => event.stopPropagation()}>
            <div className="indicator-header">
              <div className="indicator-title">Indicators</div>
              <button className="indicator-close" onClick={() => setShowIndicators(false)}>
                Close
              </button>
            </div>
            {(["daily", "weekly", "monthly"] as Timeframe[]).map((frame) => (
              <div className="indicator-section" key={frame}>
                <div className="indicator-subtitle">Moving Averages ({frame})</div>
                <div className="indicator-rows">
                  {maSettings[frame].map((setting, index) => (
                    <div className="indicator-row" key={setting.key}>
                      <input
                        type="checkbox"
                        checked={setting.visible}
                        onChange={() => updateSetting(frame, index, { visible: !setting.visible })}
                      />
                      <div className="indicator-label">{setting.label}</div>
                      <input
                        className="indicator-input"
                        type="number"
                        min={1}
                        value={setting.period}
                        onChange={(event) =>
                          updateSetting(frame, index, { period: Number(event.target.value) || 1 })
                        }
                      />
                      <input
                        className="indicator-input indicator-width"
                        type="number"
                        min={1}
                        max={6}
                        value={setting.lineWidth}
                        onChange={(event) =>
                          updateSetting(frame, index, { lineWidth: Number(event.target.value) })
                        }
                      />
                      <input
                        className="indicator-color-input"
                        type="color"
                        value={setting.color}
                        onChange={(event) => updateSetting(frame, index, { color: event.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <button className="indicator-reset" onClick={() => resetSettings(frame)}>
                  Reset {frame}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
