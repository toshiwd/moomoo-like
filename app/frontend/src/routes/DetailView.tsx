import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import DetailChart from "../components/DetailChart";

type Timeframe = "daily" | "monthly";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type MaSetting = {
  key: string;
  label: string;
  period: number;
  visible: boolean;
  color: string;
};

const MA_COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b"];
const DEFAULT_PERIODS: Record<Timeframe, number[]> = {
  daily: [5, 10, 20, 50, 100],
  monthly: [3, 6, 12, 24, 60]
};

const DEFAULT_LIMITS: Record<Timeframe, number> = {
  daily: 2000,
  monthly: 240
};

const LIMIT_STEP: Record<Timeframe, number> = {
  daily: 1000,
  monthly: 120
};

const makeDefaultSettings = (timeframe: Timeframe): MaSetting[] =>
  DEFAULT_PERIODS[timeframe].map((period, index) => ({
    key: `ma${index + 1}`,
    label: `MA${index + 1}`,
    period,
    visible: index < 3,
    color: MA_COLORS[index]
  }));

const normalizeSettings = (timeframe: Timeframe, input: unknown): MaSetting[] => {
  const defaults = makeDefaultSettings(timeframe);
  if (!Array.isArray(input)) return defaults;
  return defaults.map((item, index) => {
    const candidate = input[index] as Partial<MaSetting> | undefined;
    const period = Number(candidate?.period);
    return {
      ...item,
      period: Number.isFinite(period) && period > 0 ? Math.floor(period) : item.period,
      visible: typeof candidate?.visible === "boolean" ? candidate.visible : item.visible
    };
  });
};

const loadSettings = (timeframe: Timeframe): MaSetting[] => {
  if (typeof window === "undefined") return makeDefaultSettings(timeframe);
  const raw = window.localStorage.getItem(`maSettings:${timeframe}`);
  if (!raw) return makeDefaultSettings(timeframe);
  try {
    return normalizeSettings(timeframe, JSON.parse(raw));
  } catch {
    return makeDefaultSettings(timeframe);
  }
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

export default function DetailView() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [data, setData] = useState<number[][]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showIndicators, setShowIndicators] = useState(false);
  const [maSettings, setMaSettings] = useState(() => ({
    daily: loadSettings("daily"),
    monthly: loadSettings("monthly")
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    (Object.keys(maSettings) as Timeframe[]).forEach((key) => {
      const payload = maSettings[key].map((item) => ({
        period: item.period,
        visible: item.visible
      }));
      window.localStorage.setItem(`maSettings:${key}`, JSON.stringify(payload));
    });
  }, [maSettings]);

  useEffect(() => {
    if (!code) return;
    const limit = limits[timeframe];
    setLoading(true);
    api
      .get(`/ticker/${timeframe}`, { params: { code, limit } })
      .then((res) => {
        const rows = (res.data || []) as number[][];
        setData(rows);
        setHasMore(rows.length >= limit);
      })
      .finally(() => setLoading(false));
  }, [code, timeframe, limits]);

  const candles = useMemo(() => {
    return data
      .filter((row) => row.length >= 5)
      .map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4])
      }))
      .filter((row) => Number.isFinite(row.time));
  }, [data]);

  const volume = useMemo(() => {
    return data
      .filter((row) => row.length >= 6 && row[5] != null)
      .map((row) => ({
        time: Number(row[0]),
        value: Number(row[5])
      }))
      .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.value));
  }, [data]);

  const maLines = useMemo(() => {
    return maSettings[timeframe].map((setting) => ({
      key: setting.key,
      color: setting.color,
      visible: setting.visible,
      data: computeMA(candles, setting.period)
    }));
  }, [candles, maSettings, timeframe]);

  const showVolume = timeframe === "daily" && volume.length > 0;
  const subtitle = timeframe === "daily" ? "Daily candles with volume" : "Monthly candles";

  const loadMore = () => {
    setLimits((prev) => ({
      ...prev,
      [timeframe]: prev[timeframe] + LIMIT_STEP[timeframe]
    }));
  };

  const updateSetting = (index: number, patch: Partial<MaSetting>) => {
    setMaSettings((prev) => {
      const next = [...prev[timeframe]];
      next[index] = { ...next[index], ...patch };
      return { ...prev, [timeframe]: next };
    });
  };

  const resetSettings = () => {
    setMaSettings((prev) => ({
      ...prev,
      [timeframe]: makeDefaultSettings(timeframe)
    }));
  };

  return (
    <div className="detail-shell">
      <div className="detail-header">
        <button className="back" onClick={() => navigate(-1)}>
          Back
        </button>
        <div>
          <div className="title">{code}</div>
          <div className="subtitle">{subtitle}</div>
        </div>
        <div className="detail-controls">
          <div className="segmented">
            {["daily", "monthly"].map((value) => (
              <button
                key={value}
                className={timeframe === value ? "active" : ""}
                onClick={() => setTimeframe(value as Timeframe)}
              >
                {value === "daily" ? "Daily" : "Monthly"}
              </button>
            ))}
          </div>
          <button className="indicator-button" onClick={() => setShowIndicators(true)}>
            Indicators
          </button>
        </div>
      </div>
      <div className="detail-chart">
        <DetailChart candles={candles} volume={volume} maLines={maLines} showVolume={showVolume} />
      </div>
      <div className="detail-footer">
        <button className="load-more" onClick={loadMore} disabled={loading || !hasMore}>
          {loading ? "Loading..." : hasMore ? "Load more" : "All data loaded"}
        </button>
        <div className="detail-hint">{candles.length} bars loaded</div>
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
            <div className="indicator-section">
              <div className="indicator-subtitle">Moving Averages ({timeframe})</div>
              <div className="indicator-rows">
                {maSettings[timeframe].map((setting, index) => (
                  <div className="indicator-row" key={setting.key}>
                    <input
                      type="checkbox"
                      checked={setting.visible}
                      onChange={() => updateSetting(index, { visible: !setting.visible })}
                    />
                    <div className="indicator-label">{setting.label}</div>
                    <input
                      className="indicator-input"
                      type="number"
                      min={1}
                      value={setting.period}
                      onChange={(event) =>
                        updateSetting(index, { period: Number(event.target.value) || 1 })
                      }
                    />
                    <span className="indicator-color" style={{ background: setting.color }} />
                  </div>
                ))}
              </div>
              <button className="indicator-reset" onClick={resetSettings}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
