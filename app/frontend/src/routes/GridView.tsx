import { useEffect, useMemo, useRef, useState } from "react";
import { FixedSizeGrid as Grid, GridOnItemsRenderedProps } from "react-window";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import StockTile from "../components/StockTile";

const TILE_HEIGHT = 230;
const HEADER_HEIGHT = 88;

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
  const columns = useStore((state) => state.settings.columns);
  const search = useStore((state) => state.settings.search);
  const gridScrollTop = useStore((state) => state.settings.gridScrollTop);
  const gridTimeframe = useStore((state) => state.settings.gridTimeframe);
  const setColumns = useStore((state) => state.setColumns);
  const setSearch = useStore((state) => state.setSearch);
  const setGridScrollTop = useStore((state) => state.setGridScrollTop);
  const setGridTimeframe = useStore((state) => state.setGridTimeframe);

  const [health, setHealth] = useState<HealthStatus | null>(null);

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

  const rowCount = Math.ceil(filtered.length / columns);
  const columnWidth = size.width > 0 ? Math.floor(size.width / columns) : 300;
  const gridHeight = Math.max(200, size.height - HEADER_HEIGHT);

  const onItemsRendered = ({
    visibleRowStartIndex,
    visibleRowStopIndex,
    visibleColumnStartIndex,
    visibleColumnStopIndex
  }: GridOnItemsRenderedProps) => {
    const rowsPerViewport = Math.max(1, Math.floor(gridHeight / TILE_HEIGHT));
    const prefetchStop = visibleRowStopIndex + rowsPerViewport;
    const start = visibleRowStartIndex * columns + visibleColumnStartIndex;
    const stop = Math.min(filtered.length - 1, prefetchStop * columns + visibleColumnStopIndex);

    if (start > stop) return;
    const codes: string[] = [];
    for (let index = start; index <= stop; index += 1) {
      const item = filtered[index];
      if (item) codes.push(item.code);
    }
    ensureBarsForVisible(gridTimeframe, codes);
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
            {["monthly", "daily"].map((value) => (
              <button
                key={value}
                className={gridTimeframe === value ? "active" : ""}
                onClick={() => setGridTimeframe(value as "monthly" | "daily")}
              >
                {value === "monthly" ? "Monthly" : "Daily"}
              </button>
            ))}
          </div>
          <input
            className="search"
            placeholder="Search code or name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
          <Grid
            key={gridTimeframe}
            columnCount={columns}
            columnWidth={columnWidth}
            height={gridHeight}
            rowCount={rowCount}
            rowHeight={TILE_HEIGHT}
            width={size.width}
            overscanRowCount={2}
            onItemsRendered={onItemsRendered}
            initialScrollTop={gridScrollTop}
            onScroll={({ scrollTop }) => setGridScrollTop(scrollTop)}
          >
            {({ columnIndex, rowIndex, style }) => {
              const index = rowIndex * columns + columnIndex;
              const item = filtered[index];
              if (!item) return null;
              return (
                <div style={style}>
                  <StockTile
                    ticker={item}
                    timeframe={gridTimeframe}
                    onDoubleClick={() => navigate(`/detail/${item.code}`)}
                  />
                </div>
              );
            }}
          </Grid>
        )}
      </div>
    </div>
  );
}
