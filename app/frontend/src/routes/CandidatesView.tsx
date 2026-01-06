import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBackendReadyState } from "../backendReady";
import ChartListCard from "../components/ChartListCard";
import TopNav from "../components/TopNav";
import Toast from "../components/Toast";
import { useStore } from "../store";

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
  const timeframe = "monthly" as const;

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
