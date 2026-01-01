import { useEffect, useMemo, useRef } from "react";
import { BarsPayload } from "../store";

const COLORS = {
  up: "#42d392",
  down: "#ef4444",
  ma7: "#38bdf8",
  ma20: "#f59e0b",
  ma60: "#22c55e"
};

const HEIGHT = 120;

function toValueMap(series: number[][]) {
  const map = new Map<number, number | null>();
  series.forEach(([t, v]) => {
    map.set(t, v === null ? null : Number(v));
  });
  return map;
}

function drawChart(
  canvas: HTMLCanvasElement,
  payload: BarsPayload,
  width: number,
  height: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const bars = payload.bars;
  if (!bars.length) {
    ctx.clearRect(0, 0, width, height);
    return;
  }

  const pad = 6;
  const hi = Math.max(...bars.map((b) => b[2]));
  const lo = Math.min(...bars.map((b) => b[3]));
  const min = Math.min(lo, ...payload.ma.ma7.map((m) => m[1] ?? lo), ...payload.ma.ma20.map((m) => m[1] ?? lo), ...payload.ma.ma60.map((m) => m[1] ?? lo));
  const max = Math.max(hi, ...payload.ma.ma7.map((m) => m[1] ?? hi), ...payload.ma.ma20.map((m) => m[1] ?? hi), ...payload.ma.ma60.map((m) => m[1] ?? hi));
  const range = Math.max(1e-6, max - min);

  const toY = (value: number) => {
    return pad + (height - pad * 2) * (1 - (value - min) / range);
  };

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;

  const step = width / bars.length;
  const candleWidth = Math.max(1, Math.min(6, step * 0.6));

  bars.forEach((bar, index) => {
    const [t, o, h, l, c] = bar;
    const x = step * index + step / 2;
    const color = c >= o ? COLORS.up : COLORS.down;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    const yHigh = toY(h);
    const yLow = toY(l);
    const yOpen = toY(o);
    const yClose = toY(c);

    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();

    const rectY = Math.min(yOpen, yClose);
    const rectH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x - candleWidth / 2, rectY, candleWidth, rectH);
  });

  const ma7 = toValueMap(payload.ma.ma7);
  const ma20 = toValueMap(payload.ma.ma20);
  const ma60 = toValueMap(payload.ma.ma60);

  const drawMa = (map: Map<number, number | null>, color: string) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    let started = false;
    bars.forEach((bar, index) => {
      const t = bar[0];
      const value = map.get(t);
      if (value === null || value === undefined) {
        return;
      }
      const x = step * index + step / 2;
      const y = toY(value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (started) ctx.stroke();
  };

  drawMa(ma7, COLORS.ma7);
  drawMa(ma20, COLORS.ma20);
  drawMa(ma60, COLORS.ma60);
}

export default function ThumbnailCanvas({ payload }: { payload: BarsPayload }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastKeyRef = useRef<string>("");

  const renderKey = useMemo(() => {
    const bars = payload.bars;
    const last = bars[bars.length - 1];
    return `${bars.length}-${bars[0]?.[0]}-${last?.[0]}-${last?.[4]}`;
  }, [payload]);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const resize = () => {
      const width = Math.floor(containerRef.current?.clientWidth || 0);
      const height = HEIGHT;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      drawChart(canvas, payload, width, height);
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [payload, renderKey]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    if (lastKeyRef.current === renderKey) return;
    lastKeyRef.current = renderKey;
    drawChart(canvasRef.current, payload, canvasRef.current.clientWidth, HEIGHT);
  }, [payload, renderKey]);

  return (
    <div ref={containerRef} className="thumb-canvas">
      <canvas ref={canvasRef} />
    </div>
  );
}