import argparse
import os
import random
from datetime import datetime, timedelta

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "txt"))


def generate_ohlc(prev_close: float) -> tuple[float, float, float, float]:
    drift = random.uniform(-0.03, 0.03)
    open_price = prev_close * (1 + random.uniform(-0.01, 0.01))
    close_price = max(1.0, open_price * (1 + drift))
    high_price = max(open_price, close_price) * (1 + random.uniform(0.0, 0.02))
    low_price = min(open_price, close_price) * (1 - random.uniform(0.0, 0.02))
    return round(open_price, 2), round(high_price, 2), round(low_price, 2), round(close_price, 2)


def generate_dummy_txt(tickers: int, days: int) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    random.seed(42)
    code_list = []
    today = datetime.utcnow().date()

    for idx in range(tickers):
        code = f"T{idx:04d}"
        code_list.append(code)
        price = random.uniform(10, 200)
        rows = []
        dt = today - timedelta(days=days * 2)
        count = 0
        while count < days:
            if dt.weekday() < 5:
                o, h, l, c = generate_ohlc(price)
                price = c
                volume = random.randint(80_000, 2_500_000)
                rows.append(f"{code},{dt.strftime('%Y/%m/%d')},{o},{h},{l},{c},{volume}")
                count += 1
            dt += timedelta(days=1)

        path = os.path.join(DATA_DIR, f"{code}.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(rows))

    watchlist_path = os.path.join(DATA_DIR, "code.txt")
    with open(watchlist_path, "w", encoding="utf-8") as f:
        f.write("\n".join(code_list))

    print(f"Generated {tickers} tickers in {DATA_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", type=int, default=320)
    parser.add_argument("--days", type=int, default=420)
    args = parser.parse_args()

    generate_dummy_txt(args.tickers, args.days)


if __name__ == "__main__":
    main()