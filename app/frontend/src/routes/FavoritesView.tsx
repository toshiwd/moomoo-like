import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useBackendReadyState } from "../backendReady";
import TopNav from "../components/TopNav";
import Toast from "../components/Toast";
import { useStore } from "../store";

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

  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
            <div className="search-field">
              <input
                className="search-input"
                placeholder="コード / 銘柄名で検索"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button type="button" className="search-clear" onClick={() => setSearch("")}
                >
                  クリア
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
      <div className="favorites-shell">
        {loading && <div className="rank-status">読み込み中...</div>}
        {!loading && backendReady && filtered.length === 0 && (
          <div className="rank-status">お気に入りがありません。</div>
        )}
        <div className="favorites-list">
          {filtered.map((item) => (
            <div
              key={item.code}
              className="favorites-item"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/detail/${item.code}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/detail/${item.code}`);
                }
              }}
            >
              <div>
                <div className="favorites-code">{item.code}</div>
                <div className="favorites-name">{item.name ?? item.code}</div>
              </div>
              <button
                type="button"
                className="favorite-toggle active"
                aria-pressed
                aria-label="お気に入り解除"
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemoveFavorite(item.code);
                }}
              >
                ♥
              </button>
            </div>
          ))}
        </div>
      </div>
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
