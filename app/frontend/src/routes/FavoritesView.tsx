import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useBackendReadyState } from "../backendReady";
import ChartListCard from "../components/ChartListCard";
import TopNav from "../components/TopNav";
import Toast from "../components/Toast";
import { useStore } from "../store";
import { computeSignalMetrics } from "../utils/signals";

type FavoriteItem = {
  code: string;
  name?: string;
};

type FavoritesResponse = {
  items?: FavoriteItem[];
  errors?: string[];
};

export default function FavoritesView() {
  const navigate = useNavigate();
  const { ready: backendReady } = useBackendReadyState();
  const setFavoriteLocal = useStore((state) => state.setFavoriteLocal);
  const replaceFavorites = useStore((state) => state.replaceFavorites);
  const ensureBarsForVisible = useStore((state) => state.ensureBarsForVisible);
  const barsCache = useStore((state) => state.barsCache);
  const barsStatus = useStore((state) => state.barsStatus);
  const maSettings = useStore((state) => state.maSettings);

  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"monthly" | "weekly" | "daily">("monthly");
  const [rangeMonths, setRangeMonths] = useState(12);

  useEffect(() => {
    if (!backendReady) return;
    setLoading(true);
    api
      .get("/favorites")
      .then((res) => {
        const payload = res.data as FavoritesResponse;
        const list = Array.isArray(payload.items) ? payload.items : [];
        setItems(list);
        replaceFavorites(list.map((item) => item.code));
      })
      .catch(() => {
        setItems([]);
        replaceFavorites([]);
        setToastMessage("お気に入りの取得に失敗しました。");
      })
      .finally(() => setLoading(false));
  }, [replaceFavorites, backendReady]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      const codeMatch = item.code.toLowerCase().includes(term);
      const nameMatch = (item.name ?? "").toLowerCase().includes(term);
      return codeMatch || nameMatch;
    });
  }, [items, search]);

  const filteredCodes = useMemo(() => filtered.map((item) => item.code), [filtered]);
  const signalMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeSignalMetrics>["signals"]>();
    filtered.forEach((item) => {
      const payload = barsCache[timeframe][item.code];
      if (!payload?.bars?.length) return;
      const signals = computeSignalMetrics(payload.bars, 4).signals;
      if (signals.length) {
        map.set(item.code, signals);
      }
    });
    return map;
  }, [filtered, barsCache, timeframe]);

  const rangeOptions = [
    { label: "3M", months: 3 },
    { label: "6M", months: 6 },
    { label: "1Y", months: 12 },
    { label: "2Y", months: 24 }
  ];

  useEffect(() => {
    if (!backendReady) return;
    if (!filteredCodes.length) return;
    ensureBarsForVisible(timeframe, filteredCodes, "favorites");
  }, [backendReady, filteredCodes, ensureBarsForVisible, timeframe]);

  const handleRemoveFavorite = async (code: string) => {
    const prevItems = items;
    setItems((current) => current.filter((item) => item.code !== code));
    setFavoriteLocal(code, false);
    try {
      await api.delete(`/favorites/${encodeURIComponent(code)}`);
    } catch {
      setItems(prevItems);
      setFavoriteLocal(code, true);
      setToastMessage("お気に入りの更新に失敗しました。");
    }
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-heading">
          <div className="title">お気に入り</div>
          <div className="subtitle">登録済みの銘柄一覧</div>
          <TopNav />
        </div>
        <div className="top-bar-controls">
          <div className="top-bar-left">
            <div className="segmented timeframe-segment">
              {(["monthly", "weekly", "daily"] as const).map((value) => (
                <button
                  key={value}
                  className={timeframe === value ? "active" : ""}
                  onClick={() => setTimeframe(value)}
                >
                  {value === "monthly" ? "月足" : value === "weekly" ? "週足" : "日足"}
                </button>
              ))}
            </div>
            <div className="segmented segmented-compact range-segment">
              {rangeOptions.map((option) => (
                <button
                  key={option.label}
                  className={rangeMonths === option.months ? "active" : ""}
                  onClick={() => setRangeMonths(option.months)}
                >
                  {option.label}
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
        </div>
      </header>
      <div className="rank-shell">
        {loading && <div className="rank-status">読み込み中...</div>}
        {!loading && backendReady && filtered.length === 0 && (
          <div className="rank-status">お気に入りがありません。</div>
        )}
        <div className="rank-grid">
          {filtered.map((item) => {
            const payload = barsCache[timeframe][item.code] ?? null;
            const status = barsStatus[timeframe][item.code];
            return (
              <ChartListCard
                key={item.code}
                code={item.code}
                name={item.name ?? item.code}
                payload={payload}
                status={status}
                maSettings={maSettings[timeframe]}
                rangeMonths={rangeMonths}
                signals={signalMap.get(item.code) ?? []}
                onOpenDetail={(code) => navigate(`/detail/${code}`)}
                action={{
                  label: "♥",
                  ariaLabel: "お気に入り解除",
                  className: "favorite-toggle active",
                  onClick: () => handleRemoveFavorite(item.code)
                }}
              />
            );
          })}
        </div>
      </div>
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
