import random
from datetime import datetime, timedelta, timezone

import pandas as pd

from db import get_conn, init_schema

TICKER_COUNT = 320
MONTHLY_BARS = 60
DAILY_BARS = 400
STAGES = ["box", "breakout"]


def add_months(dt: datetime, months: int) -> datetime:
    year = dt.year + (dt.month - 1 + months) // 12
    month = (dt.month - 1 + months) % 12 + 1
    day = min(dt.day, 28)
    return dt.replace(year=year, month=month, day=day)


def to_unix(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp())


def generate_ohlc(prev_close: float) -> tuple[float, float, float, float]:
    drift = random.uniform(-0.03, 0.03)
    open_price = prev_close * (1 + random.uniform(-0.01, 0.01))
    close_price = max(1.0, open_price * (1 + drift))
    high_price = max(open_price, close_price) * (1 + random.uniform(0.0, 0.02))
    low_price = min(open_price, close_price) * (1 - random.uniform(0.0, 0.02))
    return round(open_price, 2), round(high_price, 2), round(low_price, 2), round(close_price, 2)


def build_dummy_data():
    random.seed(42)
    now = datetime.now(tz=timezone.utc)

    ticker_rows = []
    meta_rows = []
    monthly_rows = []
    daily_rows = []

    for idx in range(TICKER_COUNT):
        code = f"T{idx:04d}"
        name = f"Demo Corp {idx:04d}"
        ticker_rows.append((code, name))

        stage = random.choice(STAGES)
        score = round(random.uniform(0, 100), 2)
        meta_rows.append((code, stage, score, now))

        monthly_start = add_months(now.replace(day=1), -(MONTHLY_BARS - 1))
        price = random.uniform(20, 200)
        for m in range(MONTHLY_BARS):
            dt = add_months(monthly_start, m)
            o, h, l, c = generate_ohlc(price)
            price = c
            monthly_rows.append((code, to_unix(dt), o, h, l, c))

        daily_start = now - timedelta(days=DAILY_BARS * 2)
        price = max(5.0, price)
        count = 0
        dt = daily_start
        while count < DAILY_BARS:
            if dt.weekday() < 5:
                o, h, l, c = generate_ohlc(price)
                price = c
                volume = random.randint(100_000, 2_000_000)
                daily_rows.append((code, to_unix(dt), o, h, l, c, volume))
                count += 1
            dt += timedelta(days=1)

    return ticker_rows, meta_rows, monthly_rows, daily_rows


def main() -> None:
    init_schema()
    ticker_rows, meta_rows, monthly_rows, daily_rows = build_dummy_data()

    with get_conn() as conn:
        conn.execute("DELETE FROM monthly_bars")
        conn.execute("DELETE FROM daily_bars")
        conn.execute("DELETE FROM ticker_meta")
        conn.execute("DELETE FROM tickers")

        conn.executemany("INSERT INTO tickers VALUES (?, ?)", ticker_rows)
        conn.executemany("INSERT INTO ticker_meta VALUES (?, ?, ?, ?)", meta_rows)
        conn.executemany("INSERT INTO monthly_bars VALUES (?, ?, ?, ?, ?, ?)", monthly_rows)
        conn.executemany("INSERT INTO daily_bars VALUES (?, ?, ?, ?, ?, ?, ?)", daily_rows)

    print(f"Inserted {len(ticker_rows)} tickers")
    print(f"Inserted {len(monthly_rows)} monthly bars")
    print(f"Inserted {len(daily_rows)} daily bars")


if __name__ == "__main__":
    main()