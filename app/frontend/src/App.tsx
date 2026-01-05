import { Route, Routes } from "react-router-dom";
import { BackendReadyProvider } from "./backendReady";
import DetailView from "./routes/DetailView";
import FavoritesView from "./routes/FavoritesView";
import GridView from "./routes/GridView";
import PracticeView from "./routes/PracticeView";
import RankingView from "./routes/RankingView";

export default function App() {
  return (
    <BackendReadyProvider>
      <Routes>
        <Route path="/" element={<GridView />} />
        <Route path="/ranking" element={<RankingView />} />
        <Route path="/favorites" element={<FavoritesView />} />
        <Route path="/detail/:code" element={<DetailView />} />
        <Route path="/practice/:code" element={<PracticeView />} />
      </Routes>
    </BackendReadyProvider>
  );
}
