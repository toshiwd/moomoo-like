import { useEffect, useLayoutEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type VolumePoint = {
  time: number;
  value: number;
};

type MaLine = {
  key: string;
  color: string;
  data: { time: number; value: number }[];
  visible: boolean;
};

export default function DetailChart({
  candles,
  volume,
  maLines,
  showVolume
}: {
  candles: Candle[];
  volume: VolumePoint[];
  maLines: MaLine[];
  showVolume: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const lineSeriesRef = useRef<any[]>([]);
  const dataRef = useRef({ candles, volume, maLines, showVolume });

  const applyData = (next: typeof dataRef.current) => {
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(next.candles);
    }
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(next.showVolume ? next.volume : []);
      volumeSeriesRef.current.applyOptions({ visible: next.showVolume });
    }
    next.maLines.forEach((line, index) => {
      const series = lineSeriesRef.current[index];
      if (!series) return;
      series.applyOptions({ color: line.color, visible: line.visible });
      series.setData(line.data);
    });
    if (chartRef.current && next.candles.length) {
      chartRef.current.timeScale().fitContent();
    }
  };

  useEffect(() => {
    dataRef.current = { candles, volume, maLines, showVolume };
    applyData(dataRef.current);
  }, [candles, volume, maLines, showVolume]);

  useLayoutEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const element = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    let rafId = 0;

    const init = () => {
      if (chartRef.current) return;
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      if (width <= 0 || height <= 0) {
        rafId = window.requestAnimationFrame(init);
        return;
      }

      const chart = createChart(element, {
        height,
        width,
        layout: {
          background: { color: "#0f1628" },
          textColor: "#cbd5f5"
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.06)" },
          horzLines: { color: "rgba(255,255,255,0.06)" }
        },
        rightPriceScale: {
          visible: true,
          borderVisible: false,
          scaleMargins: { top: 0.05, bottom: 0.2 }
        },
        timeScale: { borderVisible: false }
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#42d392",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#42d392",
        wickDownColor: "#ef4444"
      });

      const volumeSeries = chart.addHistogramSeries({
        priceScaleId: "volume",
        color: "rgba(79, 109, 255, 0.6)",
        priceFormat: { type: "volume" },
        lastValueVisible: false
      });

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
        visible: false,
        borderVisible: false
      });

      const lineSeries = maLines.map((line) =>
        chart.addLineSeries({
          color: line.color,
          lineWidth: 2,
          priceLineVisible: false
        })
      );

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      lineSeriesRef.current = lineSeries;

      applyData(dataRef.current);

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          chart.applyOptions({
            width: Math.floor(entry.contentRect.width),
            height: Math.floor(entry.contentRect.height)
          });
        }
      });
      resizeObserver.observe(element);
    };

    init();

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (resizeObserver) resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
      }
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lineSeriesRef.current = [];
    };
  }, []);

  return <div className="detail-chart-inner" ref={containerRef} />;
}
