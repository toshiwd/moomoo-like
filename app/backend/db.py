import os
import duckdb

DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "stocks.duckdb")


def get_conn():
    db_path = os.getenv("STOCKS_DB_PATH", DEFAULT_DB_PATH)
    return duckdb.connect(db_path)


def init_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tickers (
                code TEXT PRIMARY KEY,
                name TEXT
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_bars (
                code TEXT,
                date INTEGER,
                o DOUBLE,
                h DOUBLE,
                l DOUBLE,
                c DOUBLE,
                v BIGINT,
                PRIMARY KEY(code, date)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_ma (
                code TEXT,
                date INTEGER,
                ma7 DOUBLE,
                ma20 DOUBLE,
                ma60 DOUBLE,
                PRIMARY KEY(code, date)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS monthly_bars (
                code TEXT,
                month INTEGER,
                o DOUBLE,
                h DOUBLE,
                l DOUBLE,
                c DOUBLE,
                PRIMARY KEY(code, month)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS monthly_ma (
                code TEXT,
                month INTEGER,
                ma7 DOUBLE,
                ma20 DOUBLE,
                ma60 DOUBLE,
                PRIMARY KEY(code, month)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS stock_meta (
                code TEXT PRIMARY KEY,
                name TEXT,
                stage TEXT,
                score DOUBLE,
                reason TEXT,
                score_status TEXT,
                missing_reasons_json TEXT,
                score_breakdown_json TEXT,
                latest_close REAL,
                monthly_box_status TEXT,
                box_duration INTEGER,
                box_upper REAL,
                box_lower REAL,
                ma20_monthly_trend INTEGER,
                days_since_peak INTEGER,
                days_since_bottom INTEGER,
                signal_flags TEXT,
                updated_at TIMESTAMP
            );
            """
        )
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS score_status TEXT;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS missing_reasons_json TEXT;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS score_breakdown_json TEXT;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS latest_close REAL;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS monthly_box_status TEXT;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS box_duration INTEGER;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS box_upper REAL;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS box_lower REAL;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS ma20_monthly_trend INTEGER;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS days_since_peak INTEGER;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS days_since_bottom INTEGER;")
        conn.execute("ALTER TABLE stock_meta ADD COLUMN IF NOT EXISTS signal_flags TEXT;")
