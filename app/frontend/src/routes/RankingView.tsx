import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useBackendReadyState } from "../backendReady";
import ChartInfoPanel from "../components/ChartInfoPanel";
import DetailChart from "../components/DetailChart";
import Toast from "../components/Toast";
import TopNav from "../components/TopNav";
import { MaSetting, useStore } from "../store";
import {
  buildConsultationPack,
  ConsultationSort,
  ConsultationTimeframe
} from "../utils/consultation";

type RankItem = {
  code: string;
  name?: string;
  total_score?: number;
  badges?: string[];
  series?: number[][];
  is_favorite?: boolean;
};

type RankResponse = {
  items?: RankItem[];
  errors?: string[];
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type VolumePoint = {
  time: number;
  value: number;
};

const RANK_MA_SETTINGS: MaSetting[] = [
  { key: "ma1", label: "MA1", period: 7, visible: true, color: "#ef4444", lineWidth: 1 },
  { key: "ma2", label: "MA2", period: 20, visible: true, color: "#22c55e", lineWidth: 1 },
  { key: "ma3", label: "MA3", period: 60, visible: true, color: "#3b82f6", lineWidth: 1 },
  { key: "ma4", label: "MA4", period: 100, visible: true, color: "#a855f7", lineWidth: 1 },
  { key: "ma5", label: "MA5", period: 200, visible: true, color: "#f59e0b", lineWidth: 1 }
];

const normalizeDateParts = (year: number, month: number, day: number) => {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
};

const normalizeTime = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10_000_000_000_000) return Math.floor(value / 1000);
    if (value > 10_000_000_000) return Math.floor(value / 10);
    if (value >= 10_000_000 && value < 100_000_000) {
      const year = Math.floor(value / 10000);
      const month = Math.floor((value % 10000) / 100);
      const day = value % 100;
      return normalizeDateParts(year, month, day);
    }
    if (value >= 100_000 && value < 1_000_000) {
      const year = Math.floor(value / 100);
      const month = value % 100;
      return normalizeDateParts(year, month, 1);
    }
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{8}$/.test(trimmed)) {
      const year = Number(trimmed.slice(0, 4));
      const month = Number(trimmed.slice(4, 6));
      const day = Number(trimmed.slice(6, 8));
      return normalizeDateParts(year, month, day);
    }
    if (/^\d{6}$/.test(trimmed)) {
      const year = Number(trimmed.slice(0, 4));
      const month = Number(trimmed.slice(4, 6));
      return normalizeDateParts(year, month, 1);
    }
    const match = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      return normalizeDateParts(year, month, day);
    }
  }
  return null;
};

const computeMA = (candles: Candle[], period: number) => {
  if (period <= 1) {
    return candles.map((c) => ({ time: c.time, value: c.close }));
  }
  const data: { time: number; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      data.push({ time: candles[i].time, value: sum / period });
    }
  }
  return data;
};

const buildCandles = (series: number[][]) => {
  const rows: Candle[] = [];
  for (const row of series) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const time = normalizeTime(row[0]);
    if (time == null) continue;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    if (![open, high, low, close].every((value) => Number.isFinite(value))) continue;
    rows.push({ time, open, high, low, close });
  }
  return rows;
};

const useInView = (rootMargin = "220px") => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
      },
      { rootMargin, threshold: 0.1 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
};

type RankChartCardProps = {
  item: RankItem;
  index: number;
  onToggleFavorite: (code: string, isFavorite: boolean) => void;
  onOpenDetail: (code: string) => void;
  selected: boolean;
  onToggleSelect: (code: string) => void;
};

const RankChartCard = memo(function RankChartCard({
  item,
  index,
  onToggleFavorite,
  onOpenDetail,
  selected,
  onToggleSelect
}: RankChartCardProps) {
  const { ref, inView } = useInView();
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const hoverPendingRef = useRef<number | null>(null);
  const hoverValueRef = useRef<number | null>(null);

  const candles = useMemo(() => buildCandles(item.series ?? []), [item.series]);
  const volume = useMemo<VolumePoint[]>(() => [], []);
  const maLines = useMemo(
    () =>
      RANK_MA_SETTINGS.map((setting) => ({
        key: setting.key,
        color: setting.color,
        visible: setting.visible,
        lineWidth: setting.lineWidth,
        data: computeMA(candles, setting.period)
      })),
    [candles]
  );

  const barsForInfo = useMemo(
    () => candles.map((bar) => ({ time: bar.time, close: bar.close })),
    [candles]
  );

  const scheduleHoverTime = useCallback((time: number | null) => {
    hoverPendingRef.current = time;
    if (hoverRafRef.current !== null) return;
    hoverRafRef.current = window.requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const next = hoverPendingRef.current ?? null;
      if (hoverValueRef.current === next) return;
      hoverValueRef.current = next;
      setHoverTime(next);
    });
  }, []);

  useEffect(
    () => () => {
      if (hoverRafRef.current !== null) {
        window.cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
    },
    []
  );

  const scoreText = Number.isFinite(item.total_score ?? NaN) ? item.total_score?.toFixed(1) : "--";
  const badges = item.badges ?? [];
  const isFavorite = Boolean(item.is_favorite);
  return (
    <div
      ref={ref}
      className={`tile rank-tile ${selected ? "is-selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(item.code)}
    >
      <div className="rank-tile-header">
        <div className="rank-tile-left">
          <span className="rank-badge">{index + 1}</span>
          <div className="tile-id">
            <label
              className="tile-select-toggle"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(item.code)}
                aria-label={`${item.code} を選択`}
              />
              <span className="tile-code">{item.code}</span>
            </label>
            <span className="tile-name">{item.name ?? item.code}</span>
          </div>
        </div>
        <div className="rank-tile-right">
          <span className="rank-score-badge">スコア {scoreText}</span>
          <button
            type="button"
            className={`favorite-toggle ${isFavorite ? "active" : ""}`}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "お気に入り解除" : "お気に入り追加"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(item.code, isFavorite);
            }}
          >
            ?
          </button>
        </div>
      </div>
      {badges.length > 0 && (
        <div className="rank-badges">
          {badges.slice(0, 6).map((badge) => (
            <span className="signal-chip" key={`${item.code}-${badge}`}>
              {badge}
            </span>
          ))}
        </div>
      )}
      <div className="tile-chart">
        {!inView && <div className="rank-chart-placeholder" />}
        {inView && candles.length === 0 && <div className="tile-loading">No data</div>}
        {inView && candles.length > 0 && (
          <>
            <DetailChart
              candles={candles}
              volume={volume}
              maLines={maLines}
              showVolume={false}
              boxes={[]}
              showBoxes={false}
              onCrosshairMove={scheduleHoverTime}
            />
            <ChartInfoPanel bars={barsForInfo} hoverTime={hoverTime} />
          </>
        )}
      </div>
    </div>
  );
});


export default function RankingView() {
  const navigate = useNavigate();
  const { ready: backendReady } = useBackendReadyState();
  const setFavoriteLocal = useStore((state) => state.setFavoriteLocal);
  const ensureBarsForVisible = useStore((state) => state.ensureBarsForVisible);
  const barsCache = useStore((state) => state.barsCache);
  const boxesCache = useStore((state) => state.boxesCache);

  const [dir, setDir] = useState<"up" | "down">("up");
  const [items, setItems] = useState<RankItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [consultVisible, setConsultVisible] = useState(false);
  const [consultExpanded, setConsultExpanded] = useState(false);
  const [consultTab, setConsultTab] = useState<"selection" | "position">("selection");
  const [consultText, setConsultText] = useState("");
  const [consultSort, setConsultSort] = useState<ConsultationSort>("score");
  const [consultBusy, setConsultBusy] = useState(false);
  const [consultMeta, setConsultMeta] = useState<{ omitted: number }>({ omitted: 0 });
  const consultTimeframe: ConsultationTimeframe = "monthly";
  const consultBarsCount = 60;
  const consultPaddingClass = consultVisible
    ? consultExpanded
      ? "consult-padding-expanded"
      : "consult-padding-mini"
    : "";

  useEffect(() => {
    if (!backendReady) return;
    setLoading(true);
    setErrorMessage(null);
    api
      .get("/rank", { params: { dir, limit: 50 } })
      .then((res) => {
        const payload = res.data as RankResponse;
        const list = Array.isArray(payload.items) ? payload.items : [];
        setItems(list);
        if (payload.errors?.length) {
          setErrorMessage(payload.errors[0]);
        }
      })
      .catch(() => {
        setItems([]);
        setErrorMessage("ランキングの取得に失敗しました。");
      })
      .finally(() => setLoading(false));
  }, [backendReady, dir]);

  useEffect(() => {
    if (!items.length) {
      setSelectedCodes([]);
      return;
    }
    setSelectedCodes((prev) => prev.filter((code) => items.some((item) => item.code === code)));
  }, [items]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && consultVisible) {
        setConsultVisible(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [consultVisible]);

  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes]);

  const toggleSelect = useCallback((code: string) => {
    setSelectedCodes((prev) => {
      if (prev.includes(code)) return prev.filter((item) => item !== code);
      return [...prev, code];
    });
  }, []);

  const handleToggleFavorite = useCallback(
    async (code: string, isFavorite: boolean) => {
      setItems((current) =>
        current.map((item) =>
          item.code === code ? { ...item, is_favorite: !isFavorite } : item
        )
      );
      setFavoriteLocal(code, !isFavorite);
      try {
        if (isFavorite) {
          await api.delete(`/favorites/${encodeURIComponent(code)}`);
        } else {
          await api.post(`/favorites/${encodeURIComponent(code)}`);
        }
      } catch {
        setItems((current) =>
          current.map((item) =>
            item.code === code ? { ...item, is_favorite: isFavorite } : item
          )
        );
        setFavoriteLocal(code, isFavorite);
        setToastMessage("お気に入りの更新に失敗しました。");
      }
    },
    [setFavoriteLocal]
  );

  const buildConsultation = useCallback(async () => {
    if (!selectedCodes.length) return;
    setConsultBusy(true);
    try {
      try {
        await ensureBarsForVisible(consultTimeframe, selectedCodes, "consult-pack");
      } catch {
        // Use available cache even if fetch fails.
      }
      const itemsForPack = selectedCodes.map((code) => {
        const rankItem = items.find((item) => item.code === code);
        const payload = barsCache[consultTimeframe][code];
        const boxes = boxesCache[consultTimeframe][code] ?? [];
        return {
          code,
          name: rankItem?.name ?? null,
          market: null,
          sector: null,
          bars: payload?.bars ?? null,
          boxes,
          boxState: null,
          hasBox: null,
          buyState: null,
          buyStateScore: null,
          buyStateReason: null,
          buyStateDetails: null
        };
      });
      const result = buildConsultationPack(
        {
          createdAt: new Date(),
          timeframe: consultTimeframe,
          barsCount: consultBarsCount
        },
        itemsForPack,
        consultSort
      );
      setConsultText(result.text);
      setConsultMeta({ omitted: result.omittedCount });
      setConsultVisible(true);
      setConsultExpanded(true);
      setConsultTab("selection");
    } finally {
      setConsultBusy(false);
    }
  }, [
    selectedCodes,
    ensureBarsForVisible,
    consultTimeframe,
    items,
    barsCache,
    boxesCache,
    consultSort
  ]);

  const handleCopyConsult = useCallback(async () => {
    if (!consultText) {
      setToastMessage("相談パックがまだありません。");
      return;
    }
    try {
      await navigator.clipboard.writeText(consultText);
      setToastMessage("相談パックをコピーしました。");
    } catch {
      setToastMessage("コピーに失敗しました。");
    }
  }, [consultText]);

  const selectedChips = useMemo(() => {
    const limit = 6;
    const visible = selectedCodes.slice(0, limit);
    const extra = Math.max(0, selectedCodes.length - visible.length);
    return { visible, extra };
  }, [selectedCodes]);

  const showSkeleton = backendReady && loading && items.length === 0;

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-heading">
          <div className="title">ランキング</div>
          <div className="subtitle">上昇/下落 Top50 を切替</div>
          <TopNav />
        </div>
        <div className="top-bar-controls">
          <div className="top-bar-left">
            <div className="segmented">
              <button
                className={dir === "up" ? "active" : ""}
                onClick={() => setDir("up")}
              >
                上昇Top50
              </button>
              <button
                className={dir === "down" ? "active" : ""}
                onClick={() => setDir("down")}
              >
                下落Top50
              </button>
            </div>
          </div>
          <div className="top-bar-right">
            <button
              type="button"
              className="consult-trigger"
              onClick={() => {
                setConsultVisible(true);
                setConsultExpanded(false);
              }}
            >
              相談
            </button>
          </div>
        </div>
      </header>
      <div className={`rank-shell ${consultPaddingClass}`}>
        {showSkeleton && (
          <div className="rank-skeleton">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="tile skeleton-card" key={`rank-skeleton-${index}`}>
                <div className="skeleton-line wide" />
                <div className="skeleton-line" />
                <div className="skeleton-block tall" />
              </div>
            ))}
          </div>
        )}
        {!showSkeleton && (
          <>
            {errorMessage && <div className="rank-status">{errorMessage}</div>}
            {!loading && backendReady && items.length === 0 && !errorMessage && (
              <div className="rank-status">ランキングがありません。</div>
            )}
            <div className="rank-grid">
              {items.map((item, index) => (
                <RankChartCard
                  key={item.code}
                  item={item}
                  index={index}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenDetail={(code) => navigate(`/detail/${code}`)}
                  selected={selectedSet.has(item.code)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <div
        className={`consult-sheet ${consultVisible ? "is-visible" : "is-hidden"} ${
          consultExpanded ? "is-expanded" : "is-mini"
        }`}
      >
        <button
          type="button"
          className="consult-handle"
          onClick={() => {
            if (!consultVisible) return;
            setConsultExpanded((prev) => !prev);
          }}
          aria-label={consultExpanded ? "相談バーを折りたたむ" : "相談バーを展開する"}
        />
        {!consultExpanded && (
          <div className="consult-mini">
            <div className="consult-mini-left">
              <div className="consult-mini-count">選択 {selectedCodes.length}件</div>
              <div className="consult-chips">
                {selectedChips.visible.map((code) => (
                  <span key={code} className="consult-chip">
                    {code}
                  </span>
                ))}
                {selectedChips.extra > 0 && (
                  <span className="consult-chip">+{selectedChips.extra}</span>
                )}
              </div>
            </div>
            <div className="consult-mini-actions">
              <button
                type="button"
                className="consult-primary"
                onClick={buildConsultation}
                disabled={!selectedCodes.length || consultBusy}
              >
                {consultBusy ? "作成中..." : "相談作成"}
              </button>
              <button type="button" onClick={handleCopyConsult} disabled={!consultText}>
                コピー
              </button>
              <button type="button" onClick={() => setConsultVisible(false)}>
                閉じる
              </button>
            </div>
          </div>
        )}
        {consultExpanded && (
          <div className="consult-expanded">
            <div className="consult-expanded-header">
              <div className="consult-tabs">
                <button
                  type="button"
                  className={consultTab === "selection" ? "active" : ""}
                  onClick={() => setConsultTab("selection")}
                >
                  選定相談
                </button>
                <button
                  type="button"
                  className={consultTab === "position" ? "active" : ""}
                  onClick={() => setConsultTab("position")}
                >
                  建玉相談
                </button>
              </div>
              <div className="consult-expanded-actions">
                <button
                  type="button"
                  className="consult-primary"
                  onClick={buildConsultation}
                  disabled={!selectedCodes.length || consultBusy}
                >
                  {consultBusy ? "作成中..." : "相談作成"}
                </button>
                <button type="button" onClick={handleCopyConsult} disabled={!consultText}>
                  コピー
                </button>
                <button type="button" onClick={() => setConsultVisible(false)}>
                  閉じる
                </button>
              </div>
            </div>
            <div className="consult-expanded-body">
              <div className="consult-expanded-meta-row">
                <div className="consult-expanded-meta">
                  選択 {selectedCodes.length}件
                  {consultMeta.omitted
                    ? ` / 表示外 ${consultMeta.omitted}件`
                    : " / 最大10件まで表示"}
                </div>
                <div className="consult-sort">
                  <span>並び順</span>
                  <div className="segmented segmented-compact">
                    {(["score", "code"] as ConsultationSort[]).map((key) => (
                      <button
                        key={key}
                        className={consultSort === key ? "active" : ""}
                        onClick={() => setConsultSort(key)}
                      >
                        {key === "score" ? "スコア順" : "コード順"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {consultTab === "selection" ? (
                <textarea className="consult-drawer-body" value={consultText} readOnly />
              ) : (
                <div className="consult-placeholder">建玉相談は準備中です。</div>
              )}
            </div>
          </div>
        )}
      </div>
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
