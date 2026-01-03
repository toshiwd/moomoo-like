import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type SortOption = { key: SortKey; label: string };
type SortSection = { title: string; options: SortOption[] };

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
  const [sortOpen, setSortOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [isSorting, setIsSorting] = useState(false);
  const sortRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef<HTMLDivElement | null>(null);
  const lastVisibleCodesRef = useRef<string[]>([]);
  const lastVisibleRangeRef = useRef<{ start: number; stop: number } | null>(null);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    api.get("/health").then((res) => {
      setHealth(res.data as HealthStatus);
    });
  }, []);

  useEffect(() => {
    if (!sortOpen && !displayOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sortRef.current && sortRef.current.contains(target)) return;
      if (displayRef.current && displayRef.current.contains(target)) return;
      setSortOpen(false);
      setDisplayOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortOpen, displayOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      if (event.key === "Escape") {
        setSortOpen(false);
        setDisplayOpen(false);
      } else if (event.key === "1") {
        setGridTimeframe("monthly");
      } else if (event.key === "2") {
        setGridTimeframe("weekly");
      } else if (event.key === "3") {
        setGridTimeframe("daily");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setGridTimeframe]);

  useEffect(() => {
    setIsSorting(true);
    const timer = window.setTimeout(() => setIsSorting(false), 120);
    return () => window.clearTimeout(timer);
  }, [sortKey, sortDir]);

  const sortSections = useMemo<SortSection[]>(
    () => [
      {
        title: "基本",
        options: [
          { key: "code", label: "コード" },
          { key: "name", label: "銘柄名" }
        ]
      },
      {
        title: "騰落率（直近）",
        options: [
          { key: "chg1D", label: "騰落率（1日）" },
          { key: "chg1W", label: "騰落率（1週）" },
          { key: "chg1M", label: "騰落率（1ヶ月）" },
          { key: "chg1Q", label: "騰落率（3ヶ月）" },
          { key: "chg1Y", label: "騰落率（1年）" }
        ]
      },
      {
        title: "騰落率（確定期間）",
        options: [
          { key: "prevWeekChg", label: "前週騰落率" },
          { key: "prevMonthChg", label: "前月騰落率" },
          { key: "prevQuarterChg", label: "前四半期騰落率" },
          { key: "prevYearChg", label: "前年騰落率" }
        ]
      },
      {
        title: "スコア",
        options: [
          { key: "upScore", label: "上昇スコア" },
          { key: "downScore", label: "下落スコア" },
          { key: "overheatUp", label: "過熱（上）" },
          { key: "overheatDown", label: "過熱（下）" }
        ]
      },
      {
        title: "ボックス",
        options: [{ key: "boxState", label: "ボックス状態" }]
      }
    ],
    []
  );

  const sortOptions = useMemo(
    () => sortSections.flatMap((section) => section.options),
    [sortSections]
  );

  const sortLabel = useMemo(
    () => sortOptions.find((option) => option.key === sortKey)?.label ?? "コード",
    [sortOptions, sortKey]
  );

  const sortDirLabel = sortDir === "desc" ? "降順" : "昇順";

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

  const collator = useMemo(
    () => new Intl.Collator("ja-JP", { numeric: true, sensitivity: "base" }),
    []
  );

  const sortedTickers = useMemo(() => {
    const boxOrder: Record<string, number> = {
      BREAKOUT_UP: 3,
      IN_BOX: 2,
      BREAKOUT_DOWN: 1,
      NONE: 0
    };
    const items = scoredTickers.map((item) => {
      const ticker = item.ticker;
      let sortValue: string | number | null = null;
      if ((sortKey === "upScore" || sortKey === "downScore") && ticker.statusLabel === "UNKNOWN") {
        sortValue = null;
      } else if (sortKey === "code") {
        sortValue = ticker.code;
      } else if (sortKey === "name") {
        sortValue = ticker.name ?? "";
      } else if (sortKey === "chg1D") {
        sortValue = ticker.chg1D ?? null;
      } else if (sortKey === "chg1W") {
        sortValue = ticker.chg1W ?? null;
      } else if (sortKey === "chg1M") {
        sortValue = ticker.chg1M ?? null;
      } else if (sortKey === "chg1Q") {
        sortValue = ticker.chg1Q ?? null;
      } else if (sortKey === "chg1Y") {
        sortValue = ticker.chg1Y ?? null;
      } else if (sortKey === "prevWeekChg") {
        sortValue = ticker.prevWeekChg ?? null;
      } else if (sortKey === "prevMonthChg") {
        sortValue = ticker.prevMonthChg ?? null;
      } else if (sortKey === "prevQuarterChg") {
        sortValue = ticker.prevQuarterChg ?? null;
      } else if (sortKey === "prevYearChg") {
        sortValue = ticker.prevYearChg ?? null;
      } else if (sortKey === "upScore") {
        sortValue = ticker.scores?.upScore ?? null;
      } else if (sortKey === "downScore") {
        sortValue = ticker.scores?.downScore ?? null;
      } else if (sortKey === "overheatUp") {
        sortValue = ticker.scores?.overheatUp ?? null;
      } else if (sortKey === "overheatDown") {
        sortValue = ticker.scores?.overheatDown ?? null;
      } else if (sortKey === "boxState") {
        const state = ticker.boxState ?? "NONE";
        sortValue = boxOrder[state] ?? 0;
      }
      return { ...item, sortValue };
    });
    const compare = (a: typeof items[number], b: typeof items[number]) => {
      const av = a.sortValue;
      const bv = b.sortValue;
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
        result = collator.compare(String(av), String(bv));
      } else {
        result = Number(av) - Number(bv);
      }
      if (result === 0) return a.ticker.code.localeCompare(b.ticker.code);
      return sortDir === "desc" ? -result : result;
    };
    items.sort(compare);
    return items;
  }, [scoredTickers, sortKey, sortDir, collator]);

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
    lastVisibleRangeRef.current = { start, stop };
    ensureBarsForVisible(gridTimeframe, codes);
  };

  useEffect(() => {
    if (!lastVisibleCodesRef.current.length) return;
    ensureBarsForVisible(gridTimeframe, lastVisibleCodesRef.current);
  }, [gridTimeframe, maSettings, ensureBarsForVisible]);

  useEffect(() => {
    const range = lastVisibleRangeRef.current;
    if (!range) return;
    const codes: string[] = [];
    for (let index = range.start; index <= range.stop; index += 1) {
      const item = sortedTickers[index];
      if (item) codes.push(item.ticker.code);
    }
    if (!codes.length) return;
    ensureBarsForVisible(gridTimeframe, codes);
  }, [sortedTickers, gridTimeframe, ensureBarsForVisible]);

  const itemKey = useCallback(
    ({ columnIndex, rowIndex, data }: { columnIndex: number; rowIndex: number; data: typeof sortedTickers }) => {
      const index = rowIndex * columns + columnIndex;
      const item = data[index];
      return item ? item.ticker.code : `${rowIndex}-${columnIndex}`;
    },
    [columns]
  );

  const handleOpenDetail = useCallback(
    (code: string) => {
      navigate(`/detail/${code}`);
    },
    [navigate]
  );

  const resetDisplay = useCallback(() => {
    setColumns(3);
    setShowBoxes(true);
  }, [setColumns, setShowBoxes]);

  const updateSetting = (frame: Timeframe, index: number, patch: Partial<MaSetting>) => {
    updateMaSetting(frame, index, patch);
  };

  const resetSettings = (frame: Timeframe) => {
    resetMaSettings(frame);
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-heading">
          <div className="title">Moomoo-like Screener</div>
          <div className="subtitle">Fast grid with canvas sparklines</div>
        </div>
        <div className="top-bar-controls">
          <div className="top-bar-left">
            <div className="segmented timeframe-segment">
              {(["monthly", "weekly", "daily"] as const).map((value) => (
                <button
                  key={value}
                  className={gridTimeframe === value ? "active" : ""}
                  onClick={() => setGridTimeframe(value)}
                >
                  {value === "monthly" ? "月足" : value === "weekly" ? "週足" : "日足"}
                </button>
              ))}
            </div>
            <div className="search-field">
              <input
                className="search-input"
                placeholder="コード / 銘柄名で検索"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button type="button" className="search-clear" onClick={() => setSearch("")}>
                  クリア
                </button>
              )}
            </div>
          </div>
          <div className="top-bar-right">
            <div className="popover-anchor" ref={sortRef}>
              <button
                type="button"
                className={`sort-button ${isSorting ? "is-sorting" : ""}`}
                onClick={() => {
                  setSortOpen((prev) => !prev);
                  setDisplayOpen(false);
                }}
              >
                並び替え：{sortLabel}・{sortDirLabel}
                <span className="caret">▼</span>
              </button>
              {sortOpen && (
                <div className="popover-panel">
                  <div className="popover-section">
                    <div className="popover-title">並び替え項目</div>
                    <div className="popover-groups">
                      {sortSections.map((section) => (
                        <div className="popover-group" key={section.title}>
                          <div className="popover-group-title">{section.title}</div>
                          <div className="popover-group-list">
                            {section.options.map((option) => (
                              <button
                                type="button"
                                key={option.key}
                                className={
                                  sortKey === option.key ? "popover-item active" : "popover-item"
                                }
                                onClick={() => {
                                  setSortKey(option.key);
                                  setSortOpen(false);
                                }}
                              >
                                <span>{option.label}</span>
                                {sortKey === option.key && (
                                  <span className="popover-status">選択中</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="popover-section">
                    <div className="popover-title">順序</div>
                    <div className="segmented">
                      {(["desc", "asc"] as SortDir[]).map((dir) => (
                        <button
                          key={dir}
                          className={sortDir === dir ? "active" : ""}
                          onClick={() => setSortDir(dir)}
                        >
                          {dir === "desc" ? "降順" : "昇順"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="popover-anchor" ref={displayRef}>
              <button
                type="button"
                className="display-button"
                onClick={() => {
                  setDisplayOpen((prev) => !prev);
                  setSortOpen(false);
                }}
              >
                表示
                <span className="caret">▼</span>
              </button>
              {displayOpen && (
                <div className="popover-panel">
                  <div className="popover-section">
                    <div className="popover-title">列数</div>
                    <div className="segmented">
                      {[2, 3, 4].map((count) => (
                        <button
                          key={count}
                          className={columns === count ? "active" : ""}
                          onClick={() => setColumns(count as 2 | 3 | 4)}
                        >
                          {count}列
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="popover-section">
                    <div className="popover-title">チャート表示</div>
                    <div className="popover-list">
                      <button
                        type="button"
                        className={showBoxes ? "popover-item active" : "popover-item"}
                        onClick={() => setShowBoxes(!showBoxes)}
                      >
                        <span>ボックス表示</span>
                        <span className="popover-status">{showBoxes ? "オン" : "オフ"}</span>
                      </button>
                      <button
                        type="button"
                        className="popover-item"
                        onClick={() => {
                          setShowIndicators(true);
                          setDisplayOpen(false);
                        }}
                      >
                        <span>移動平均設定</span>
                        <span className="popover-status">開く</span>
                      </button>
                    </div>
                  </div>
                  <div className="popover-section">
                    <button type="button" className="popover-reset" onClick={resetDisplay}>
                      おすすめに戻す
                    </button>
                  </div>
                </div>
              )}
            </div>
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
              itemData={sortedTickers}
              itemKey={itemKey}
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
                      onOpenDetail={handleOpenDetail}
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
