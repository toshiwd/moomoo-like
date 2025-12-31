import { useEffect, useMemo, useRef } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { useStore } from "../store";

export default function Sparkline({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<any>(null);
  const monthly = useStore((state) => state.monthlyCache[code] || []);

  const data = useMemo(() =>
    monthly.map((row) => ({
      time: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4]
    })),
  [monthly]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const chart = createChart(containerRef.current, {
      height: 120,
      width: containerRef.current.clientWidth,
      layout: {
        background: { color: "transparent" },
        textColor: "#7c8698"
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" }
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false
    });

    const series = chart.addCandlestickSeries({
      upColor: "#42d392",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#42d392",
      wickDownColor: "#ef4444"
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (seriesRef.current && data.length) {
      seriesRef.current.setData(data);
    }
  }, [data]);

  return <div ref={containerRef} className="sparkline" />;
}