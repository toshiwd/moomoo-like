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
            CREATE TABLE IF NOT EXISTS monthly_bars (
                code TEXT,
                t INTEGER,
                o DOUBLE,
                h DOUBLE,
                l DOUBLE,
                c DOUBLE,
                PRIMARY KEY(code, t)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_bars (
                code TEXT,
                t INTEGER,
                o DOUBLE,
                h DOUBLE,
                l DOUBLE,
                c DOUBLE,
                v BIGINT,
                PRIMARY KEY(code, t)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ticker_meta (
                code TEXT PRIMARY KEY,
                stage TEXT,
                score DOUBLE,
                updated_at TIMESTAMP
            );
            """
        )