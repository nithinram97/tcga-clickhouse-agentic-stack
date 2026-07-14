"""Thin ClickHouse wrapper. The agent ALWAYS connects as the read-only user."""
from __future__ import annotations
import os, clickhouse_connect

CH_HOST = os.getenv("CLICKHOUSE_HOST", "clickhouse")
CH_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CH_USER = os.getenv("CLICKHOUSE_RO_USER", "agent_ro")
CH_PASSWORD = os.getenv("AGENT_RO_PASSWORD", "")

def get_client():
    return clickhouse_connect.get_client(host=CH_HOST, port=CH_PORT,
        username=CH_USER, password=CH_PASSWORD, query_limit=0)

def explain(sql: str):
    """Validate a query with EXPLAIN. No rows are read."""
    try:
        get_client().query(f"EXPLAIN {sql}"); return True, ""
    except Exception as exc:
        return False, str(exc)

def run(sql: str):
    """Execute a validated SELECT. Row/scan/time caps enforced by agent_ro."""
    res = get_client().query(sql)
    return list(res.column_names), [list(r) for r in res.result_rows]
