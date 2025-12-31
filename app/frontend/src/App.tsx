import { Route, Routes } from "react-router-dom";
import GridView from "./routes/GridView";
import DetailView from "./routes/DetailView";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GridView />} />
      <Route path="/detail/:code" element={<DetailView />} />
    </Routes>
  );
}