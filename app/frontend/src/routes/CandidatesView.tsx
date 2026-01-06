import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBackendReadyState } from "../backendReady";
import ChartListCard from "../components/ChartListCard";
import TopNav from "../components/TopNav";
import Toast from "../components/Toast";
import { useStore } from "../store";
import { computeSignalMetrics } from "../utils/signals";

type CandidateItem = {
  code: string;
  name?: string;
};

export default function CandidatesView() {
  const navigate = useNavigate();
  const { ready: backendReady } = useBackendReadyState();
  const keepList = useStore((state) => state.keepList);
  const removeKeep = useStore((state) => state.removeKeep);
  const tickers = useStore((state) => state.tickers);
  const loadList = useStore((state) => state.loadList);
  const loadingList = useStore((state) => state.loadingList);
  const ensureBarsForVisible = useStore((state) => state.ensureBarsForVisible);
  const barsCache = useStore((state) => state.barsCache);
  const barsStatus = useStore((state) => state.barsStatus);
  const maSettings = useStore((state) => state.maSettings);

  const [search, setSearch] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"monthly" | "weekly" | "daily">("monthly");
  const [rangeMonths, setRangeMonths] = useState(12);

  useEffect(() => {
    if (!backendReady) return;
    if (tickers.length) return;
    loadList().catch(() => setToastMessage("候補の読み込みに失敗しました。"));
  }, [backendReady, loadList, tickers.length]);

  const tickerMap = useMemo(() => {
    return new Map(tickers.map((ticker) => [ticker.code, ticker.name]));
  }, [tickers]);

  const items = useMemo<CandidateItem[]>(
    () =>
      keepList.map((code) => ({
        code,
        name: tickerMap.get(code)
      })),
    [keepList, tickerMap]
  );

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
    ensureBarsForVisible(timeframe, filteredCodes, "candidates");
  }, [backendReady, ensureBarsForVisible, filteredCodes, timeframe]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-heading">
          <div className="title">候補</div>
          <div className="subtitle">候補に入れた銘柄一覧</div>
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
        {loadingList && <div className="rank-status">読み込み中...</div>}
        {!loadingList && backendReady && filtered.length === 0 && (
          <div className="rank-status">候補がありません。</div>
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
                  label: "候",
                  ariaLabel: "候補から外す",
                  className: "candidate-toggle active",
                  onClick: () => removeKeep(item.code)
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
