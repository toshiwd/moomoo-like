import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import DetailChart from "../components/DetailChart";

export default function DetailView() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<number[][]>([]);
  const [maVisible, setMaVisible] = useState({
    ma7: true,
    ma20: true,
    ma60: false
  });

  useEffect(() => {
    if (!code) return;
    api.get(`/ticker/daily`, { params: { code, limit: 400 } }).then((res) => {
      setData(res.data as number[][]);
    });
  }, [code]);

  const candles = useMemo(
    () =>
      data.map((row) => ({
        time: row[0],
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4]
      })),
    [data]
  );

  const volume = useMemo(
    () =>
      data.map((row) => ({
        time: row[0],
        value: row[5]
      })),
    [data]
  );

  const ma7 = useMemo(
    () => data.map((row) => ({ time: row[0], value: row[6] })),
    [data]
  );

  const ma20 = useMemo(
    () => data.map((row) => ({ time: row[0], value: row[7] })),
    [data]
  );

  const ma60 = useMemo(
    () => data.map((row) => ({ time: row[0], value: row[8] })),
    [data]
  );

  return (
    <div className="detail-shell">
      <div className="detail-header">
        <button className="back" onClick={() => navigate(-1)}>
          Back
        </button>
        <div>
          <div className="title">{code}</div>
          <div className="subtitle">Daily candles with volume and MAs</div>
        </div>
        <div className="ma-toggle">
          {([
            { key: "ma7", label: "MA7" },
            { key: "ma20", label: "MA20" },
            { key: "ma60", label: "MA60" }
          ] as const).map((item) => (
            <label key={item.key} className={maVisible[item.key] ? "active" : ""}>
              <input
                type="checkbox"
                checked={maVisible[item.key]}
                onChange={() =>
                  setMaVisible((prev) => ({
                    ...prev,
                    [item.key]: !prev[item.key]
                  }))
                }
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>
      <div className="detail-chart">
        <DetailChart
          candles={candles}
          volume={volume}
          ma7={ma7}
          ma20={ma20}
          ma60={ma60}
          maVisible={maVisible}
        />
      </div>
    </div>
  );
}