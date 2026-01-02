export type TradeEvent = {
  date: string;
  code: string;
  name: string;
  side: "buy" | "sell";
  action: "open" | "close";
  units: number;
  price?: number;
  kind?: string;
  raw?: Record<string, unknown>;
};

export type DailyPosition = {
  time: number;
  date: string;
  shortLots: number;
  longLots: number;
  posText: string;
  avgLongPrice: number;
  avgShortPrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  close: number;
};

export type TradeMarker = {
  time: number;
  date: string;
  buyLots: number;
  sellLots: number;
  trades: TradeEvent[];
};

export type PositionSource = {
  getTrades: (code: string) => Promise<TradeEvent[]>;
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const formatDate = (time: number) => {
  const date = new Date(time * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatLots = (value: number) => {
  if (Number.isNaN(value)) return "0";
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
};

const clampLots = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);

export const buildDailyPositions = (bars: Candle[], trades: TradeEvent[]) => {
  const tradeMap = new Map<string, TradeEvent[]>();
  trades.forEach((trade) => {
    if (!trade.date) return;
    const list = tradeMap.get(trade.date) ?? [];
    list.push(trade);
    tradeMap.set(trade.date, list);
  });

  const dateSet = new Set(bars.map((bar) => formatDate(bar.time)));
  const skipped = new Set<string>();
  tradeMap.forEach((items, date) => {
    if (!dateSet.has(date)) {
      skipped.add(date);
    }
  });
  if (skipped.size) {
    console.warn("[trades] skipped dates not in bars", [...skipped]);
  }

  let longLots = 0;
  let shortLots = 0;
  let avgLongPrice = 0;
  let avgShortPrice = 0;
  let realizedPnL = 0;

  const dailyPositions: DailyPosition[] = [];
  const tradeMarkers: TradeMarker[] = [];

  bars.forEach((bar) => {
    const date = formatDate(bar.time);
    const dayTrades = tradeMap.get(date) ?? [];
    let buyLots = 0;
    let sellLots = 0;
    const markerTrades: TradeEvent[] = [];

    dayTrades.forEach((trade) => {
      const lots = clampLots(trade.units);
      const price = Number(trade.price ?? 0);
      const action =
        trade.action ??
        (trade.kind?.includes("open")
          ? "open"
          : trade.kind?.includes("close")
          ? "close"
          : "open");
      const kind = trade.kind ?? "";
      const isMarker =
        kind !== "DELIVERY" && kind !== "TAKE_DELIVERY" && kind !== "INBOUND" && kind !== "OUTBOUND";
      if (isMarker) {
        if (trade.side === "buy") {
          buyLots += lots;
        } else {
          sellLots += lots;
        }
        markerTrades.push(trade);
      }

      if (kind === "DELIVERY") {
        longLots = Math.max(0, longLots - lots);
        shortLots = Math.max(0, shortLots - lots);
        return;
      }
      if (kind === "TAKE_DELIVERY") {
        return;
      }
      if (kind === "INBOUND") {
        const nextLots = longLots + lots;
        const effectivePrice = price > 0 ? price : bar.close;
        avgLongPrice =
          nextLots > 0 ? (avgLongPrice * longLots + effectivePrice * lots) / nextLots : 0;
        longLots = nextLots;
        return;
      }
      if (kind === "OUTBOUND") {
        longLots = Math.max(0, longLots - lots);
        if (longLots === 0) avgLongPrice = 0;
        return;
      }

      const isOpen = action === "open";
      if (trade.side === "buy" && isOpen) {
        const nextLots = longLots + lots;
        avgLongPrice =
          nextLots > 0 ? (avgLongPrice * longLots + price * lots) / nextLots : 0;
        longLots = nextLots;
      } else if (trade.side === "sell" && !isOpen) {
        const closeLots = Math.min(longLots, lots);
        realizedPnL += (price - avgLongPrice) * closeLots * 100;
        longLots = Math.max(0, longLots - closeLots);
        if (longLots === 0) avgLongPrice = 0;
      } else if (trade.side === "sell" && isOpen) {
        const nextLots = shortLots + lots;
        avgShortPrice =
          nextLots > 0 ? (avgShortPrice * shortLots + price * lots) / nextLots : 0;
        shortLots = nextLots;
      } else if (trade.side === "buy" && !isOpen) {
        const closeLots = Math.min(shortLots, lots);
        realizedPnL += (avgShortPrice - price) * closeLots * 100;
        shortLots = Math.max(0, shortLots - closeLots);
        if (shortLots === 0) avgShortPrice = 0;
      }
    });

    const unrealizedLong = longLots > 0 ? (bar.close - avgLongPrice) * longLots * 100 : 0;
    const unrealizedShort = shortLots > 0 ? (avgShortPrice - bar.close) * shortLots * 100 : 0;
    const unrealizedPnL = unrealizedLong + unrealizedShort;
    const totalPnL = realizedPnL + unrealizedPnL;
    const posText = `${formatLots(shortLots)}-${formatLots(longLots)}`;

    dailyPositions.push({
      time: bar.time,
      date,
      shortLots,
      longLots,
      posText,
      avgLongPrice,
      avgShortPrice,
      realizedPnL,
      unrealizedPnL,
      totalPnL,
      close: bar.close
    });

    if (markerTrades.length) {
      tradeMarkers.push({
        time: bar.time,
        date,
        buyLots,
        sellLots,
        trades: markerTrades
      });
    }
  });

  return { dailyPositions, tradeMarkers };
};
