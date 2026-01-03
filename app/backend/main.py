from datetime import datetime, timedelta
import csv
import os
import re

from fastapi import Body, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from db import get_conn, init_schema
from box_detector import detect_boxes

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "txt"))
DEFAULT_TRADE_CSV_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "楽天証券取引履歴.csv")
)
TRADE_CSV_PATH = os.getenv("TRADE_CSV_PATH") or DEFAULT_TRADE_CSV_PATH
USE_CODE_TXT = os.getenv("USE_CODE_TXT", "0") == "1"
DEFAULT_DB_PATH = os.getenv("STOCKS_DB_PATH", os.path.join(os.path.dirname(__file__), "stocks.duckdb"))


_trade_cache = {"mtime": None, "path": None, "rows": [], "warnings": []}
_screener_cache = {"mtime": None, "rows": []}


def find_code_txt_path(data_dir: str) -> str | None:
    direct = os.path.join(data_dir, "code.txt")
    if os.path.exists(direct):
        return direct
    parent = os.path.join(os.path.dirname(data_dir), "code.txt")
    if os.path.exists(parent):
        return parent
    return None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.on_event("startup")
def on_startup():
    init_schema()


def _parse_trade_csv() -> dict:
    warnings: list[dict] = []
    path = TRADE_CSV_PATH
    if not os.path.isfile(path):
        warnings.append({"type": "trade_csv_missing", "message": f"trade_csv_missing:{path}"})
        return {"rows": [], "warnings": warnings}
    mtime = os.path.getmtime(path)
    if _trade_cache["mtime"] == mtime and _trade_cache["path"] == path:
        return {"rows": _trade_cache["rows"], "warnings": _trade_cache["warnings"]}

    rows: list[dict] = []
    unknown_labels_by_code: dict[str, set[str]] = {}
    try:
        handle = open(path, "r", encoding="cp932", newline="")
    except OSError as exc:
        warnings.append({"type": "trade_csv_read_failed", "message": f"trade_csv_read_failed:{exc}"})
        return {"rows": [], "warnings": warnings}

    rows_all: list[list[str]] = []
    encoding_used = "cp932"
    try:
        with handle:
            reader = csv.reader(handle)
            rows_all = list(reader)
    except UnicodeDecodeError:
        try:
            with open(path, "r", encoding="utf-8-sig", newline="") as fallback:
                reader = csv.reader(fallback)
                rows_all = list(reader)
                encoding_used = "utf-8-sig"
                warnings.append(
                    {"type": "trade_csv_encoding_fallback", "message": "trade_csv_encoding_fallback:utf-8-sig"}
                )
        except OSError as exc:
            warnings.append({"type": "trade_csv_read_failed", "message": f"trade_csv_read_failed:{exc}"})
            return {"rows": [], "warnings": warnings}

    header = rows_all[0] if rows_all else None
    if not header:
        _trade_cache["mtime"] = mtime
        _trade_cache["path"] = path
        _trade_cache["rows"] = []
        _trade_cache["warnings"] = warnings
        return {"rows": [], "warnings": warnings}

    header = [cell.strip() for cell in header]

    def find_col(*names: str) -> int | None:
        for name in names:
            if name in header:
                return header.index(name)
        return None

    col_date = find_col("約定日", "約定日付")
    col_code = find_col("銘柄コード", "銘柄ｺｰﾄﾞ")
    col_name = find_col("銘柄名")
    col_kind = find_col("売買区分")
    col_type = find_col("取引区分")
    col_qty = find_col("数量［株］", "数量[株]", "数量")
    col_price = find_col("単価［円］", "単価[円]", "単価")
    col_amount = find_col("受渡金額", "受渡金額［円］", "受渡金額[円]")

    dedup_keys: set[str] = set()
    duplicate_counts: dict[str, int] = {}

    def normalize_text(value: str | None) -> str:
        if value is None:
            return ""
        text = str(value).replace("\ufeff", "")
        if text.strip().lower() in ("nan", "none"):
            return ""
        text = text.replace("\u3000", " ")
        return text.strip()

    def normalize_label(value: str | None) -> str:
        text = normalize_text(value)
        if not text:
            return ""
        return re.sub(r"\s+", "", text)

    for row_index, line in enumerate(rows_all[1:], start=1):
        if not line or col_date is None or col_code is None:
            continue
        date_raw = line[col_date].strip()
        code_raw = line[col_code].strip()
        if not date_raw or not code_raw:
            continue

        date_value = None
        for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y%m%d"):
            try:
                date_value = datetime.strptime(date_raw, fmt).strftime("%Y-%m-%d")
                break
            except ValueError:
                continue
        if date_value is None:
            continue

        code_match = re.search(r"\d{4}", code_raw)
        if not code_match:
            continue
        code = code_match.group(0)

        name = normalize_text(line[col_name]) if col_name is not None and col_name < len(line) else ""
        kind_raw = normalize_text(line[col_kind]) if col_kind is not None and col_kind < len(line) else ""
        type_raw = normalize_text(line[col_type]) if col_type is not None and col_type < len(line) else ""
        qty_raw = normalize_text(line[col_qty]) if col_qty is not None and col_qty < len(line) else ""
        price_raw = normalize_text(line[col_price]) if col_price is not None and col_price < len(line) else ""
        amount_raw = normalize_text(line[col_amount]) if col_amount is not None and col_amount < len(line) else ""

        def to_float(value: str) -> float:
            try:
                return float(value.replace(",", ""))
            except ValueError:
                return 0.0

        qty_shares = to_float(qty_raw)
        price = to_float(price_raw)
        if qty_shares <= 0:
            continue

        if qty_shares % 100 != 0:
            warnings.append(
                {
                    "type": "non_100_shares",
                    "message": f"non_100_shares:{code}:{date_value}:{qty_shares}",
                    "code": code
                }
            )

        trade_type = normalize_label(type_raw)
        trade_kind = normalize_label(kind_raw)

        is_new = "信用新規" in trade_type or (trade_type and "新規" in trade_type)
        is_close = "信用返済" in trade_type or (trade_type and "返済" in trade_type)
        is_spot = "現物" in trade_type
        is_delivery = trade_type == "現渡" or trade_kind == "現渡"
        is_take_delivery = trade_type == "現引" or trade_kind == "現引"
        is_inbound = trade_type == "入庫" or trade_kind == "入庫"
        is_outbound = trade_type == "出庫" or trade_kind == "出庫"

        event_kind = None
        if is_inbound:
            event_kind = "INBOUND"
        elif is_outbound:
            event_kind = "OUTBOUND"
        elif is_delivery:
            event_kind = "DELIVERY"
        elif is_take_delivery:
            event_kind = "TAKE_DELIVERY"
        elif is_new and "買建" in trade_kind:
            event_kind = "BUY_OPEN"
        elif is_new and "売建" in trade_kind:
            event_kind = "SELL_OPEN"
        elif is_close and "買埋" in trade_kind:
            event_kind = "BUY_CLOSE"
        elif is_close and "売埋" in trade_kind:
            event_kind = "SELL_CLOSE"
        elif is_spot and ("買" in trade_kind or "買付" in trade_kind):
            event_kind = "BUY_OPEN"
        elif is_spot and ("売" in trade_kind or "売付" in trade_kind):
            event_kind = "SELL_CLOSE"

        if event_kind is None:
            if "買建" in trade_kind:
                event_kind = "BUY_OPEN"
            elif "売建" in trade_kind:
                event_kind = "SELL_OPEN"
            elif "買埋" in trade_kind:
                event_kind = "BUY_CLOSE"
            elif "売埋" in trade_kind:
                event_kind = "SELL_CLOSE"
            elif "現物買" in trade_kind or "買付" in trade_kind:
                event_kind = "BUY_OPEN"
            elif "現物売" in trade_kind or "売付" in trade_kind:
                event_kind = "SELL_CLOSE"
            elif trade_type == "入庫" or trade_kind == "入庫":
                event_kind = "INBOUND"
            elif trade_type == "出庫" or trade_kind == "出庫":
                event_kind = "OUTBOUND"
            elif trade_type == "現渡" or trade_kind == "現渡":
                event_kind = "DELIVERY"
            elif trade_type == "現引" or trade_kind == "現引":
                event_kind = "TAKE_DELIVERY"

        if event_kind is None:
            sample = f"取引区分={trade_type or '(blank)'}, 売買区分={trade_kind or '(blank)'}"
            unknown_labels_by_code.setdefault(code, set()).add(sample)
            continue

        dedup_key = "|".join(
            [
                code,
                date_value,
                trade_type,
                trade_kind,
                qty_raw,
                price_raw,
                amount_raw
            ]
        )
        if dedup_key in dedup_keys:
            duplicate_counts[code] = duplicate_counts.get(code, 0) + 1
            continue
        dedup_keys.add(dedup_key)

        if event_kind == "BUY_OPEN":
            side = "buy"
            action = "open"
        elif event_kind == "BUY_CLOSE":
            side = "buy"
            action = "close"
        elif event_kind == "SELL_OPEN":
            side = "sell"
            action = "open"
        elif event_kind == "SELL_CLOSE":
            side = "sell"
            action = "close"
        else:
            side = "buy"
            action = "open"

        if event_kind in ("BUY_OPEN", "SELL_OPEN"):
            event_order = 0
        elif event_kind in ("SELL_CLOSE", "BUY_CLOSE"):
            event_order = 1
        else:
            event_order = 2

        rows.append(
            {
                "date": date_value,
                "code": code,
                "name": name,
                "side": side,
                "action": action,
                "kind": event_kind,
                "qtyShares": qty_shares,
                "units": int(qty_shares // 100),
                "price": price if price > 0 else None,
                "_row_index": row_index,
                "_event_order": event_order,
                "raw": {
                    "date": date_raw,
                    "code": code_raw,
                    "name": name,
                    "trade": kind_raw,
                    "type": type_raw,
                    "qty": qty_raw,
                    "price": price_raw,
                    "amount": amount_raw,
                    "encoding": encoding_used
                }
            }
        )

    for code, count in duplicate_counts.items():
        warnings.append(
            {"type": "duplicate_rows", "message": f"duplicate_rows:{code}:{count}", "code": code}
        )

    for code, samples_set in unknown_labels_by_code.items():
        samples = sorted(list(samples_set))[:5]
        warnings.append(
            {
                "type": "unrecognized_labels",
                "count": len(samples_set),
                "samples": samples,
                "code": code
            }
        )
    rows.sort(
        key=lambda item: (item.get("date", ""), item.get("_event_order", 2), item.get("_row_index", 0))
    )

    _trade_cache["mtime"] = mtime
    _trade_cache["path"] = path
    _trade_cache["rows"] = rows
    _trade_cache["warnings"] = warnings
    return {"rows": rows, "warnings": warnings}


def _build_daily_positions(trades: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for trade in trades:
        date = trade.get("date")
        if not date:
            continue
        grouped.setdefault(date, []).append(trade)

    long_shares = 0.0
    short_shares = 0.0
    positions: list[dict] = []

    def sort_key(item: dict) -> tuple[int, int]:
        return (item.get("_event_order", 2), item.get("_row_index", 0))

    for date in sorted(grouped.keys()):
        for trade in sorted(grouped[date], key=sort_key):
            qty_shares = float(trade.get("qtyShares") or 0)
            kind = trade.get("kind")
            if kind == "BUY_OPEN":
                long_shares += qty_shares
            elif kind == "SELL_CLOSE":
                long_shares = max(0.0, long_shares - qty_shares)
            elif kind == "SELL_OPEN":
                short_shares += qty_shares
            elif kind == "BUY_CLOSE":
                short_shares = max(0.0, short_shares - qty_shares)
            elif kind == "DELIVERY":
                long_shares = max(0.0, long_shares - qty_shares)
                short_shares = max(0.0, short_shares - qty_shares)
            elif kind == "TAKE_DELIVERY":
                continue
            elif kind == "INBOUND":
                continue
            elif kind == "OUTBOUND":
                continue

        positions.append(
            {
                "date": date,
                "buyShares": long_shares,
                "sellShares": short_shares,
                "buyUnits": long_shares / 100,
                "sellUnits": short_shares / 100,
                "text": f"{short_shares/100:g}-{long_shares/100:g}"
            }
        )

    return positions


def _strip_internal(row: dict) -> dict:
    return {key: value for key, value in row.items() if not key.startswith("_")}


def _build_warning_payload(warnings: list[dict], code: str | None = None) -> dict:
    items: list[str] = []
    unrecognized_count = 0
    unrecognized_samples: list[str] = []

    for warning in warnings:
        warning_code = warning.get("code")
        if code is not None and warning_code not in (None, code):
            continue
        if warning.get("type") == "unrecognized_labels":
            count = int(warning.get("count") or 0)
            samples = warning.get("samples") or []
            unrecognized_count += count
            for sample in samples:
                if sample in unrecognized_samples:
                    continue
                unrecognized_samples.append(sample)
                if len(unrecognized_samples) >= 5:
                    break
        else:
            message = warning.get("message") or warning.get("type") or ""
            if message:
                items.append(message)

    payload = {"items": items}
    if unrecognized_count:
        payload["unrecognized_labels"] = {
            "count": unrecognized_count,
            "samples": unrecognized_samples
        }
    return payload


def _parse_daily_date(value: int | str | None) -> datetime | None:
    if value is None:
        return None
    try:
        raw = str(int(value)).zfill(8)
        year = int(raw[:4])
        month = int(raw[4:6])
        day = int(raw[6:8])
        return datetime(year, month, day)
    except (ValueError, TypeError):
        return None


def _parse_month_value(value: int | str | None) -> datetime | None:
    if value is None:
        return None
    try:
        raw = str(int(value)).zfill(6)
        year = int(raw[:4])
        month = int(raw[4:6])
        return datetime(year, month, 1)
    except (ValueError, TypeError):
        return None


def _format_month_label(value: int | str | None) -> str | None:
    month = _parse_month_value(value)
    if not month:
        return None
    return f"{month.year:04d}-{month.month:02d}"


def _pct_change(latest: float | None, prev: float | None) -> float | None:
    if latest is None or prev is None:
        return None
    if prev == 0:
        return None
    return (latest - prev) / prev * 100


def _build_weekly_bars(daily_rows: list[tuple]) -> list[dict]:
    items: list[dict] = []
    current_key = None
    for row in daily_rows:
        if len(row) < 5:
            continue
        date_value, open_, high, low, close = row[:5]
        if open_ is None or high is None or low is None or close is None:
            continue
        dt = _parse_daily_date(date_value)
        if not dt:
            continue
        week_start = (dt - timedelta(days=dt.weekday())).date()
        if current_key != week_start:
            items.append(
                {
                    "week_start": week_start,
                    "o": float(open_),
                    "h": float(high),
                    "l": float(low),
                    "c": float(close),
                    "last_date": dt.date()
                }
            )
            current_key = week_start
        else:
            current = items[-1]
            current["h"] = max(current["h"], float(high))
            current["l"] = min(current["l"], float(low))
            current["c"] = float(close)
            current["last_date"] = dt.date()
    return items


def _drop_incomplete_weekly(weekly: list[dict], last_daily: datetime | None) -> list[dict]:
    if not weekly or not last_daily:
        return weekly
    last_week_start = (last_daily - timedelta(days=last_daily.weekday())).date()
    if weekly[-1]["week_start"] == last_week_start and last_daily.weekday() < 4:
        return weekly[:-1]
    return weekly


def _drop_incomplete_monthly(monthly_rows: list[tuple], last_daily: datetime | None) -> list[tuple]:
    if not monthly_rows or not last_daily:
        return monthly_rows
    last_month = _parse_month_value(monthly_rows[-1][0] if monthly_rows else None)
    if last_month and last_month.year == last_daily.year and last_month.month == last_daily.month:
        return monthly_rows[:-1]
    return monthly_rows


def _build_quarterly_bars(monthly_rows: list[tuple]) -> list[dict]:
    items: list[dict] = []
    current_key: tuple[int, int] | None = None
    for row in monthly_rows:
        if len(row) < 5:
            continue
        month_value, open_, high, low, close = row[:5]
        dt = _parse_month_value(month_value)
        if not dt:
            continue
        quarter = (dt.month - 1) // 3 + 1
        key = (dt.year, quarter)
        if current_key != key:
            items.append(
                {
                    "year": dt.year,
                    "quarter": quarter,
                    "o": float(open_),
                    "h": float(high),
                    "l": float(low),
                    "c": float(close)
                }
            )
            current_key = key
        else:
            current = items[-1]
            current["h"] = max(current["h"], float(high))
            current["l"] = min(current["l"], float(low))
            current["c"] = float(close)
    return items


def _build_yearly_bars(monthly_rows: list[tuple]) -> list[dict]:
    items: list[dict] = []
    current_year = None
    for row in monthly_rows:
        if len(row) < 5:
            continue
        month_value, open_, high, low, close = row[:5]
        dt = _parse_month_value(month_value)
        if not dt:
            continue
        if current_year != dt.year:
            items.append(
                {
                    "year": dt.year,
                    "o": float(open_),
                    "h": float(high),
                    "l": float(low),
                    "c": float(close)
                }
            )
            current_year = dt.year
        else:
            current = items[-1]
            current["h"] = max(current["h"], float(high))
            current["l"] = min(current["l"], float(low))
            current["c"] = float(close)
    return items


def _build_ma_series(values: list[float], period: int) -> list[float | None]:
    if period <= 0:
        return [None for _ in values]
    result: list[float | None] = []
    total = 0.0
    for index, value in enumerate(values):
        total += value
        if index >= period:
            total -= values[index - period]
        if index >= period - 1:
            result.append(total / period)
        else:
            result.append(None)
    return result


def _count_streak(
    values: list[float],
    averages: list[float | None],
    direction: str
) -> int | None:
    count = 0
    opposite = 0
    has_values = False
    for value, avg in zip(values, averages):
        if avg is None:
            continue
        has_values = True
        if direction == "up":
            if value > avg:
                count += 1
                opposite = 0
            elif value < avg:
                opposite += 1
                if opposite >= 2:
                    count = 0
            else:
                opposite = 0
        else:
            if value < avg:
                count += 1
                opposite = 0
            elif value > avg:
                opposite += 1
                if opposite >= 2:
                    count = 0
            else:
                opposite = 0
    return None if not has_values else count


def _build_box_metrics(monthly_rows: list[tuple], last_close: float | None) -> tuple[dict | None, str]:
    if not monthly_rows:
        return None, "NONE"
    boxes = detect_boxes(monthly_rows)
    if not boxes:
        return None, "NONE"

    bars = []
    for row in monthly_rows:
        if len(row) < 5:
            continue
        month_value, open_, high, low, close = row[:5]
        if open_ is None or close is None:
            continue
        bars.append(
            {
                "month": month_value,
                "open": float(open_),
                "close": float(close)
            }
        )

    active_box = None
    for box in boxes:
        months = box["endIndex"] - box["startIndex"] + 1
        if months < 3:
            continue
        active_box = {**box, "months": months}

    if not active_box:
        return None, "NONE"

    start_index = active_box["startIndex"]
    end_index = active_box["endIndex"]
    body_low = None
    body_high = None
    for bar in bars[start_index : end_index + 1]:
        low = min(bar["open"], bar["close"])
        high = max(bar["open"], bar["close"])
        body_low = low if body_low is None else min(body_low, low)
        body_high = high if body_high is None else max(body_high, high)

    if body_low is None or body_high is None:
        return None, "NONE"

    base = max(abs(body_low), 1e-9)
    range_pct = (body_high - body_low) / base
    start_label = _format_month_label(active_box["startTime"])
    end_label = _format_month_label(active_box["endTime"])

    box_state = "NONE"
    if last_close is not None:
        if last_close > body_high:
            box_state = "BREAKOUT_UP"
        elif last_close < body_low:
            box_state = "BREAKOUT_DOWN"
        else:
            box_state = "IN_BOX"

    payload = {
        "startDate": start_label,
        "endDate": end_label,
        "bodyLow": body_low,
        "bodyHigh": body_high,
        "months": active_box["months"],
        "rangePct": range_pct,
        "isActive": box_state == "IN_BOX"
    }
    return payload, box_state


def _compute_screener_metrics(
    daily_rows: list[tuple],
    monthly_rows: list[tuple]
) -> dict:
    reasons: list[str] = []
    daily_rows = sorted(daily_rows, key=lambda item: item[0])
    monthly_rows = sorted(monthly_rows, key=lambda item: item[0])

    last_daily = _parse_daily_date(daily_rows[-1][0]) if daily_rows else None
    closes = [float(row[4]) for row in daily_rows if len(row) >= 5 and row[4] is not None]
    last_close = closes[-1] if closes else None
    if last_close is None:
        reasons.append("missing_last_close")

    chg1d = _pct_change(closes[-1], closes[-2]) if len(closes) >= 2 else None

    weekly = _build_weekly_bars(daily_rows)
    weekly = _drop_incomplete_weekly(weekly, last_daily)
    weekly_closes = [item["c"] for item in weekly]
    chg1w = _pct_change(weekly_closes[-1], weekly_closes[-2]) if len(weekly_closes) >= 2 else None

    confirmed_monthly = _drop_incomplete_monthly(monthly_rows, last_daily)
    monthly_closes = [float(row[4]) for row in confirmed_monthly if len(row) >= 5 and row[4] is not None]
    chg1m = _pct_change(monthly_closes[-1], monthly_closes[-2]) if len(monthly_closes) >= 2 else None

    quarterly = _build_quarterly_bars(confirmed_monthly)
    quarterly_closes = [item["c"] for item in quarterly]
    chg1q = _pct_change(quarterly_closes[-1], quarterly_closes[-2]) if len(quarterly_closes) >= 2 else None

    yearly = _build_yearly_bars(confirmed_monthly)
    yearly_closes = [item["c"] for item in yearly]
    chg1y = _pct_change(yearly_closes[-1], yearly_closes[-2]) if len(yearly_closes) >= 2 else None

    ma7_series = _build_ma_series(closes, 7)
    ma20_series = _build_ma_series(closes, 20)
    ma60_series = _build_ma_series(closes, 60)
    ma100_series = _build_ma_series(closes, 100)

    ma7 = ma7_series[-1] if ma7_series else None
    ma20 = ma20_series[-1] if ma20_series else None
    ma60 = ma60_series[-1] if ma60_series else None
    ma100 = ma100_series[-1] if ma100_series else None

    prev_ma20 = ma20_series[-2] if len(ma20_series) >= 2 else None
    slope20 = ma20 - prev_ma20 if ma20 is not None and prev_ma20 is not None else None

    up7 = _count_streak(closes, ma7_series, "up")
    down7 = _count_streak(closes, ma7_series, "down")
    up20 = _count_streak(closes, ma20_series, "up")
    down20 = _count_streak(closes, ma20_series, "down")
    up60 = _count_streak(closes, ma60_series, "up")
    down60 = _count_streak(closes, ma60_series, "down")
    up100 = _count_streak(closes, ma100_series, "up")
    down100 = _count_streak(closes, ma100_series, "down")

    if ma20 is None:
        reasons.append("missing_ma20")
    if ma60 is None:
        reasons.append("missing_ma60")
    if ma100 is None:
        reasons.append("missing_ma100")
    if chg1m is None:
        reasons.append("missing_chg1m")
    if chg1q is None:
        reasons.append("missing_chg1q")
    if chg1y is None:
        reasons.append("missing_chg1y")

    box_monthly, box_state = _build_box_metrics(monthly_rows, last_close)

    status_label = "UNKNOWN"
    essential_missing = last_close is None or ma20 is None or ma60 is None
    if not essential_missing:
        if last_close > ma20 and ma20 > ma60:
            status_label = "UP"
        elif last_close < ma20 and ma20 < ma60:
            status_label = "DOWN"
        else:
            status_label = "RANGE"

    up_score = None
    down_score = None
    overheat_up = None
    overheat_down = None

    if status_label != "UNKNOWN" and last_close is not None and ma20 is not None and ma60 is not None:
        up_score = 0
        down_score = 0

        if last_close > ma20:
            up_score += 10
        if ma20 > ma60:
            up_score += 10
        if slope20 is not None and slope20 > 0:
            up_score += 10

        if up7 is not None:
            if up7 >= 14:
                up_score += 20
            elif up7 >= 7:
                up_score += 10

        if box_state == "BREAKOUT_UP":
            up_score += 30
        elif box_state == "IN_BOX" and box_monthly and box_monthly.get("months", 0) >= 3:
            up_score += 10

        if chg1m is not None and chg1m > 0:
            up_score += 10
        if chg1q is not None and chg1q > 0:
            up_score += 10

        if last_close < ma20:
            down_score += 10
        if ma20 < ma60:
            down_score += 10
        if slope20 is not None and slope20 < 0:
            down_score += 10

        if down7 is not None:
            if down7 >= 14:
                down_score += 20
            elif down7 >= 7:
                down_score += 10

        if box_state == "BREAKOUT_DOWN":
            down_score += 30

        if chg1m is not None and chg1m < 0:
            down_score += 10
        if chg1q is not None and chg1q < 0:
            down_score += 10

        up_score = min(100, max(0, up_score))
        down_score = min(100, max(0, down_score))

        if up20 is not None:
            overheat_up = min(1.0, max(0.0, (up20 - 16) / 4))
        if down20 is not None:
            overheat_down = min(1.0, max(0.0, (down20 - 16) / 4))

    return {
        "lastClose": last_close,
        "chg1D": chg1d,
        "chg1W": chg1w,
        "chg1M": chg1m,
        "chg1Q": chg1q,
        "chg1Y": chg1y,
        "ma7": ma7,
        "ma20": ma20,
        "ma60": ma60,
        "ma100": ma100,
        "slope20": slope20,
        "counts": {
            "up7": up7,
            "down7": down7,
            "up20": up20,
            "down20": down20,
            "up60": up60,
            "down60": down60,
            "up100": up100,
            "down100": down100
        },
        "boxMonthly": box_monthly,
        "boxState": box_state,
        "scores": {
            "upScore": up_score,
            "downScore": down_score,
            "overheatUp": overheat_up,
            "overheatDown": overheat_down
        },
        "statusLabel": status_label,
        "reasons": reasons
    }


def _build_screener_rows() -> list[dict]:
    with get_conn() as conn:
        codes = [row[0] for row in conn.execute("SELECT DISTINCT code FROM daily_bars ORDER BY code").fetchall()]
        meta_rows = conn.execute(
            "SELECT code, name, stage, score, reason FROM stock_meta"
        ).fetchall()
        daily_rows = conn.execute(
            """
            SELECT code, date, o, h, l, c, v
            FROM (
                SELECT
                    code,
                    date,
                    o,
                    h,
                    l,
                    c,
                    v,
                    ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
                FROM daily_bars
            )
            WHERE rn <= 260
            ORDER BY code, date
            """
        ).fetchall()
        monthly_rows = conn.execute(
            """
            SELECT code, month, o, h, l, c
            FROM monthly_bars
            ORDER BY code, month
            """
        ).fetchall()

    meta_map = {row[0]: row for row in meta_rows}
    daily_map: dict[str, list[tuple]] = {}
    monthly_map: dict[str, list[tuple]] = {}

    for row in daily_rows:
        code = row[0]
        daily_map.setdefault(code, []).append(row[1:])

    for row in monthly_rows:
        code = row[0]
        monthly_map.setdefault(code, []).append(row[1:])

    items: list[dict] = []
    for code in codes:
        meta = meta_map.get(code) or (code, code, "UNKNOWN", 0.0, "TXT_ONLY")
        name = meta[1] or code
        stage = meta[2] or "UNKNOWN"
        score = meta[3] if meta[3] is not None else 0.0
        reason = meta[4] or ""
        metrics = _compute_screener_metrics(daily_map.get(code, []), monthly_map.get(code, []))
        items.append(
            {
                "code": code,
                "name": name,
                "stage": stage,
                "score": score,
                "reason": reason,
                **metrics
            }
        )
    return items


def _get_screener_rows() -> list[dict]:
    mtime = None
    if os.path.isfile(DEFAULT_DB_PATH):
        mtime = os.path.getmtime(DEFAULT_DB_PATH)
    if _screener_cache["mtime"] == mtime and _screener_cache["rows"]:
        return _screener_cache["rows"]

    rows = _build_screener_rows()
    _screener_cache["mtime"] = mtime
    _screener_cache["rows"] = rows
    return rows


def get_txt_status() -> dict:
    if not os.path.isdir(DATA_DIR):
        return {
            "txt_count": 0,
            "code_txt_missing": False,
            "last_updated": None
        }

    txt_files = [
        os.path.join(DATA_DIR, name)
        for name in os.listdir(DATA_DIR)
        if name.endswith(".txt") and name.lower() != "code.txt"
    ]
    code_txt_missing = False
    if USE_CODE_TXT:
        code_txt_missing = find_code_txt_path(DATA_DIR) is None
    last_updated = None
    if txt_files:
        last_updated = max(os.path.getmtime(path) for path in txt_files)
        last_updated = datetime.utcfromtimestamp(last_updated).isoformat() + "Z"

    return {
        "txt_count": len(txt_files),
        "code_txt_missing": code_txt_missing,
        "last_updated": last_updated
    }


@app.get("/api/health")
def health():
    status = get_txt_status()
    with get_conn() as conn:
        code_count = conn.execute("SELECT COUNT(DISTINCT code) FROM daily_bars").fetchone()[0]
    return {
        "ok": True,
        "txt_count": status["txt_count"],
        "code_count": code_count,
        "last_updated": status["last_updated"],
        "code_txt_missing": status["code_txt_missing"],
        "errors": []
    }


@app.get("/api/trades/{code}")
def trades_by_code(code: str):
    try:
        parsed = _parse_trade_csv()
        items = [row for row in parsed["rows"] if row.get("code") == code]
        events = [_strip_internal(row) for row in items]
        warnings = _build_warning_payload(parsed["warnings"], code)
        daily_positions = _build_daily_positions(items)
        current_position = daily_positions[-1] if daily_positions else None
        return JSONResponse(
            content={
                "events": events,
                "dailyPositions": daily_positions,
                "currentPosition": current_position,
                "warnings": warnings,
                "errors": []
            }
        )
    except Exception as exc:
        return JSONResponse(
            content={
                "events": [],
                "dailyPositions": [],
                "currentPosition": None,
                "warnings": {"items": []},
                "errors": [f"trades_by_code_failed:{exc}"]
            }
        )


@app.get("/api/trades")
def trades(code: str | None = None):
    try:
        parsed = _parse_trade_csv()
        items = parsed["rows"]
        if code:
            items = [row for row in items if row.get("code") == code]
        warnings = _build_warning_payload(parsed["warnings"], code)
        events = [_strip_internal(row) for row in items]
        daily_positions = _build_daily_positions(items)
        current_position = daily_positions[-1] if daily_positions else None
        return JSONResponse(
            content={
                "events": events,
                "dailyPositions": daily_positions,
                "currentPosition": current_position,
                "warnings": warnings,
                "errors": []
            }
        )
    except Exception as exc:
        return JSONResponse(
            content={
                "events": [],
                "dailyPositions": [],
                "currentPosition": None,
                "warnings": {"items": []},
                "errors": [f"trades_failed:{exc}"]
            }
        )


@app.get("/api/list")
def list_tickers():
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT d.code,
                   COALESCE(m.name, d.code) AS name,
                   COALESCE(m.stage, 'UNKNOWN') AS stage,
                   COALESCE(m.score, 0) AS score,
                   COALESCE(m.reason, 'TXT_ONLY') AS reason
            FROM (SELECT DISTINCT code FROM daily_bars) d
            LEFT JOIN stock_meta m ON d.code = m.code
            ORDER BY d.code
            """
        ).fetchall()
    return JSONResponse(content=rows)


@app.get("/api/screener")
def screener():
    try:
        rows = _get_screener_rows()
        return JSONResponse(content={"items": rows, "errors": []})
    except Exception as exc:
        return JSONResponse(content={"items": [], "errors": [f"screener_failed:{exc}"]})


@app.post("/api/batch_bars")
def batch_bars(payload: dict = Body(default={})):  # { timeframe, codes, limit }
    timeframe = payload.get("timeframe", "monthly")
    codes = payload.get("codes", [])
    limit = min(int(payload.get("limit", 60)), 2000)

    if not codes:
        return JSONResponse(content={"timeframe": timeframe, "limit": limit, "items": {}})

    if timeframe == "daily":
        bars_table = "daily_bars"
        ma_table = "daily_ma"
        time_col = "date"
    else:
        bars_table = "monthly_bars"
        ma_table = "monthly_ma"
        time_col = "month"

    placeholders = ",".join(["?"] * len(codes))
    query = f"""
        WITH base AS (
            SELECT b.code,
                   b.{time_col} AS t,
                   b.o,
                   b.h,
                   b.l,
                   b.c,
                   m.ma7,
                   m.ma20,
                   m.ma60,
                   ROW_NUMBER() OVER (PARTITION BY b.code ORDER BY b.{time_col} DESC) AS rn
            FROM {bars_table} b
            LEFT JOIN {ma_table} m
              ON b.code = m.code AND b.{time_col} = m.{time_col}
            WHERE b.code IN ({placeholders})
        )
        SELECT code, t, o, h, l, c, ma7, ma20, ma60
        FROM base
        WHERE rn <= ?
        ORDER BY code, t
    """

    with get_conn() as conn:
        rows = conn.execute(query, codes + [limit]).fetchall()
        monthly_rows = conn.execute(
            f"""
            SELECT code, month, o, h, l, c
            FROM monthly_bars
            WHERE code IN ({placeholders})
            ORDER BY code, month
            """,
            codes
        ).fetchall()

    monthly_by_code: dict[str, list[tuple]] = {}
    for code, month, o, h, l, c in monthly_rows:
        monthly_by_code.setdefault(code, []).append((month, o, h, l, c))

    boxes_by_code = {code: detect_boxes(monthly_by_code.get(code, [])) for code in codes}

    items: dict[str, dict[str, list]] = {
        code: {"bars": [], "ma": {"ma7": [], "ma20": [], "ma60": []}, "boxes": boxes_by_code.get(code, [])}
        for code in codes
    }
    for code, t, o, h, l, c, ma7, ma20, ma60 in rows:
        payload = items.setdefault(code, {"bars": [], "ma": {"ma7": [], "ma20": [], "ma60": []}, "boxes": boxes_by_code.get(code, [])})
        payload["bars"].append([t, o, h, l, c])
        payload["ma"]["ma7"].append([t, ma7])
        payload["ma"]["ma20"].append([t, ma20])
        payload["ma"]["ma60"].append([t, ma60])

    return JSONResponse(content={"timeframe": timeframe, "limit": limit, "items": items})


@app.get("/api/ticker/daily")
def daily(code: str, limit: int = 400):
    query_with_ma = """
        WITH base AS (
            SELECT
                b.date,
                b.o,
                b.h,
                b.l,
                b.c,
                b.v,
                m.ma7,
                m.ma20,
                m.ma60
            FROM daily_bars b
            LEFT JOIN daily_ma m
              ON b.code = m.code AND b.date = m.date
            WHERE b.code = ?
            ORDER BY b.date
        ),
        tail AS (
            SELECT *
            FROM base
            ORDER BY date DESC
            LIMIT ?
        )
        SELECT date, o, h, l, c, v, ma7, ma20, ma60
        FROM tail
        ORDER BY date
    """
    query_basic = """
        WITH base AS (
            SELECT
                b.date,
                b.o,
                b.h,
                b.l,
                b.c,
                b.v
            FROM daily_bars b
            WHERE b.code = ?
            ORDER BY b.date
        ),
        tail AS (
            SELECT *
            FROM base
            ORDER BY date DESC
            LIMIT ?
        )
        SELECT date, o, h, l, c, v
        FROM tail
        ORDER BY date
    """
    errors: list[str] = []
    try:
        with get_conn() as conn:
            rows = conn.execute(query_with_ma, [code, limit]).fetchall()
        return JSONResponse(content={"data": rows, "errors": []})
    except Exception as exc:
        errors.append(f"daily_query_failed:{exc}")
        try:
            with get_conn() as conn:
                rows = conn.execute(query_basic, [code, limit]).fetchall()
            return JSONResponse(content={"data": rows, "errors": []})
        except Exception as fallback_exc:
            errors.append(f"daily_query_fallback_failed:{fallback_exc}")
            return JSONResponse(content={"data": [], "errors": errors})


@app.get("/api/ticker/monthly")
def monthly(code: str, limit: int = 240):
    try:
        with get_conn() as conn:
            rows = conn.execute(
                """
                WITH base AS (
                    SELECT
                        month,
                        o,
                        h,
                        l,
                        c
                    FROM monthly_bars
                    WHERE code = ?
                    ORDER BY month DESC
                    LIMIT ?
                )
                SELECT month, o, h, l, c
                FROM base
                ORDER BY month
                """,
                [code, limit]
            ).fetchall()

        return JSONResponse(content={"data": rows, "errors": []})
    except Exception as exc:
        return JSONResponse(content={"data": [], "errors": [f"monthly_query_failed:{exc}"]})


@app.get("/api/ticker/boxes")
def ticker_boxes(code: str):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT month, o, h, l, c
            FROM monthly_bars
            WHERE code = ?
            ORDER BY month
            """,
            [code]
        ).fetchall()

    return JSONResponse(content=detect_boxes(rows))
