import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import DetailChart from "../components/DetailChart";

export default function DetailView() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<number[][]>([]);

  useEffect(() => {
    if (!code) return;
    api.get(`/daily/${code}`).then((res) => {
      setData(res.data as number[][]);
    });
  }, [code]);

  const candles = useMemo(() => data.map((row) => ({
    time: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4]
  })), [data]);

  const volume = useMemo(() => data.map((row) => ({
    time: row[0],
    value: row[5]
  })), [data]);

  return (
    <div className="detail-shell">
      <div className="detail-header">
        <button className="back" onClick={() => navigate(-1)}>
          Back
        </button>
        <div>
          <div className="title">{code}</div>
          <div className="subtitle">Daily candles with volume</div>
        </div>
        <div className="ma-toggle">
          <label>
            <input type="checkbox" disabled />
            MA20
          </label>
          <label>
            <input type="checkbox" disabled />
            MA50
          </label>
          <label>
            <input type="checkbox" disabled />
            MA200
          </label>
        </div>
      </div>
      <div className="detail-chart">
        <DetailChart candles={candles} volume={volume} />
      </div>
    </div>
  );
}