from datetime import datetime
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


_trade_cache = {"mtime": None, "path": None, "rows": [], "warnings": []}


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
        warnings.append({"message": f"trade_csv_missing:{path}"})
        return {"rows": [], "warnings": warnings}
    mtime = os.path.getmtime(path)
    if _trade_cache["mtime"] == mtime and _trade_cache["path"] == path:
        return {"rows": _trade_cache["rows"], "warnings": _trade_cache["warnings"]}

    rows: list[dict] = []
    unknown_labels_by_code: dict[str, set[str]] = {}
    try:
        handle = open(path, "r", encoding="cp932", newline="")
    except OSError as exc:
        warnings.append({"message": f"trade_csv_read_failed:{exc}"})
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
                warnings.append({"message": "trade_csv_encoding_fallback:utf-8-sig"})
        except OSError as exc:
            warnings.append({"message": f"trade_csv_read_failed:{exc}"})
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
        text = str(value)
        if text.lower() == "nan":
            return ""
        text = text.replace("\ufeff", "")
        text = text.replace("　", "")
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
                {"message": f"non_100_shares:{code}:{date_value}:{qty_shares}", "code": code}
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
            warnings.append(
                {
                    "message": f"unrecognized_trade:{code}:{date_value}:{sample}",
                    "code": code
                }
            )
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
                "units": qty_shares / 100,
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
        warnings.append({"message": f"duplicate_rows:{code}:{count}", "code": code})

    for code, samples_set in unknown_labels_by_code.items():
        samples = sorted(list(samples_set))[:5]
        warnings.append(
            {
                "message": f"unrecognized_labels:{len(samples_set)}",
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
                long_shares += qty_shares
            elif kind == "OUTBOUND":
                long_shares = max(0.0, long_shares - qty_shares)

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


def _format_warning(warning: dict) -> str:
    message = warning.get("message", "")
    samples = warning.get("samples")
    if samples:
        sample_text = ", ".join(samples)
        return f"{message} samples=[{sample_text}]"
    return message


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
    parsed = _parse_trade_csv()
    items = [row for row in parsed["rows"] if row.get("code") == code]
    events = [_strip_internal(row) for row in items]
    warnings = [
        _format_warning(warning)
        for warning in parsed["warnings"]
        if warning.get("code") in (None, code)
    ]
    daily_positions = _build_daily_positions(items)
    current_position = daily_positions[-1] if daily_positions else None
    return JSONResponse(
        content={
            "events": events,
            "dailyPositions": daily_positions,
            "currentPosition": current_position,
            "warnings": warnings
        }
    )


@app.get("/api/trades")
def trades(code: str | None = None):
    parsed = _parse_trade_csv()
    items = parsed["rows"]
    if code:
        items = [row for row in items if row.get("code") == code]
        warnings = [
            _format_warning(warning)
            for warning in parsed["warnings"]
            if warning.get("code") in (None, code)
        ]
    else:
        warnings = [_format_warning(warning) for warning in parsed["warnings"]]
    events = [_strip_internal(row) for row in items]
    daily_positions = _build_daily_positions(items)
    current_position = daily_positions[-1] if daily_positions else None
    return JSONResponse(
        content={
            "events": events,
            "dailyPositions": daily_positions,
            "currentPosition": current_position,
            "warnings": warnings
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
    try:
        with get_conn() as conn:
            rows = conn.execute(query_with_ma, [code, limit]).fetchall()
        return JSONResponse(content=rows)
    except Exception as exc:
        try:
            with get_conn() as conn:
                rows = conn.execute(query_basic, [code, limit]).fetchall()
            return JSONResponse(content=rows)
        except Exception as fallback_exc:
            return JSONResponse(
                status_code=404,
                content={"error": "daily_query_failed", "detail": str(fallback_exc)}
            )


@app.get("/api/ticker/monthly")
def monthly(code: str, limit: int = 240):
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

    return JSONResponse(content=rows)


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
