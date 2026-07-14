"""
The "validated analyst" LangGraph.

    generate_sql -> guard --(ok)--> execute -> summarize -> END
                      |  (bad SQL, attempts left) -> generate_sql
                      |  (out of attempts)        -> give_up -> END

Guardrails: read-only creds + static keyword check + EXPLAIN validation +
bounded retry + SQL shown in every answer. Every LLM call is Langfuse-traced.
"""
from __future__ import annotations
import os, re
from typing import TypedDict
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from clickhouse_client import explain, run
from schema_context import SQL_RULES, schema_block

MAX_ATTEMPTS = int(os.getenv("AGENT_MAX_SQL_ATTEMPTS", "2"))

llm = ChatOpenAI(
    model=os.getenv("AGENT_MODEL", "gpt-4o-mini"),
    api_key=os.getenv("AGENT_LLM_API_KEY", "sk-none"),
    base_url=os.getenv("AGENT_LLM_BASE_URL") or None,
    temperature=0,
)

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|alter|create|drop|truncate|optimize|attach|"
    r"detach|rename|grant|revoke|system|set)\b", re.IGNORECASE)

class AnalystState(TypedDict, total=False):
    question: str; sql: str; error: str; attempts: int
    columns: list; rows: list; answer: str

def _extract_sql(text: str) -> str:
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    return (m.group(1) if m else text).strip().rstrip(";").strip()

def generate_sql(state):
    prior = state.get("error")
    sys = SystemMessage(content=(
        "You are a careful data analyst for a TCGA cancer-genomics warehouse in "
        "ClickHouse. Translate the user's question into one ClickHouse SELECT.\n\n"
        f"{schema_block()}\n{SQL_RULES}\n"
        "Respond with ONLY the SQL in a ```sql code block."))
    txt = state["question"]
    if prior:
        txt += f"\n\nYour previous query failed validation with this error:\n{prior}\nFix it and return corrected SQL."
    resp = llm.invoke([sys, HumanMessage(content=txt)])
    return {"sql": _extract_sql(resp.content), "attempts": state.get("attempts", 0) + 1}

def guard(state):
    sql = state.get("sql", "")
    if not re.match(r"^\s*(with|select)\b", sql, re.IGNORECASE):
        return {"error": "Query must be a single SELECT/WITH statement."}
    if ";" in sql.strip().rstrip(";"):
        return {"error": "Only one statement is allowed."}
    if _FORBIDDEN.search(sql):
        return {"error": "Query contains a forbidden (non-read) keyword."}
    ok, err = explain(sql)
    return {"error": ""} if ok else {"error": f"EXPLAIN failed: {err}"}

def route_after_guard(state):
    if not state.get("error"): return "execute"
    if state.get("attempts", 0) < MAX_ATTEMPTS: return "generate_sql"
    return "give_up"

def execute(state):
    try:
        cols, rows = run(state["sql"]); return {"columns": cols, "rows": rows, "error": ""}
    except Exception as exc:
        return {"error": f"Execution error: {exc}"}

def summarize(state):
    cols, rows = state.get("columns", []), state.get("rows", [])
    preview = [dict(zip(cols, r)) for r in rows[:50]]
    sys = SystemMessage(content=(
        "You are a data analyst. Answer the user's question from the query result "
        "in clear prose. State the key numbers. Do NOT invent values beyond the data."))
    human = HumanMessage(content=(
        f"Question: {state['question']}\n\nSQL used:\n{state['sql']}\n\n"
        f"Result rows (up to 50 shown, {len(rows)} total): {preview}"))
    resp = llm.invoke([sys, human])
    answer = f"{resp.content}\n\n---\n**Query used (verifiable):**\n```sql\n{state['sql']}\n```"
    return {"answer": answer}

def give_up(state):
    return {"answer": (
        f"I couldn't produce a valid, safe query for that question after "
        f"{state.get('attempts', 0)} attempts.\n\nLast error: {state.get('error','unknown')}\n\n"
        "Try rephrasing, or ask about mutations (genes, variants) or clinical "
        "fields (stage, vital status, age) for a TCGA project like TCGA-PAAD.")}

def build_graph():
    g = StateGraph(AnalystState)
    g.add_node("generate_sql", generate_sql); g.add_node("guard", guard)
    g.add_node("execute", execute); g.add_node("summarize", summarize); g.add_node("give_up", give_up)
    g.set_entry_point("generate_sql")
    g.add_edge("generate_sql", "guard")
    g.add_conditional_edges("guard", route_after_guard,
        {"execute": "execute", "generate_sql": "generate_sql", "give_up": "give_up"})
    g.add_edge("execute", "summarize")
    g.add_edge("summarize", END); g.add_edge("give_up", END)
    return g.compile()

analyst_graph = build_graph()
