"""Builds the schema + glossary block for the SQL-generation prompt, read live
from system.columns so it can never drift from the actual schema."""
from __future__ import annotations
from functools import lru_cache
from clickhouse_client import get_client

_ALLOWED_TABLES = ["clinical", "mutations", "gene_mutation_counts"]

@lru_cache(maxsize=1)
def schema_block() -> str:
    client = get_client()
    lines = ["Database: tcga", ""]
    for table in _ALLOWED_TABLES:
        rows = client.query(
            "SELECT name, type, comment FROM system.columns "
            "WHERE database='tcga' AND table=%(t)s ORDER BY position",
            parameters={"t": table}).result_rows
        if not rows: continue
        lines.append(f"TABLE tcga.{table}")
        for name, ctype, comment in rows:
            c = f"  - {name} ({ctype})"
            if comment: c += f"  -- {comment}"
            lines.append(c)
        lines.append("")
    return "\n".join(lines)

SQL_RULES = """\
Rules for the SQL you write:
- ClickHouse SQL dialect only.
- Exactly ONE statement, and it MUST be a SELECT (or WITH ... SELECT). Never
  write INSERT/ALTER/CREATE/DROP/DELETE/TRUNCATE/OPTIMIZE/SET.
- Only reference tables in the tcga database listed above.
- To link mutations to patients, join on the 12-char patient barcode:
  mutations.patient_barcode = clinical.submitter_id
- age_at_diagnosis_days is in DAYS; divide by 365.25 for years.
- Always add a sensible LIMIT (<= 500) unless the question is a single aggregate.
- Prefer explicit column lists over SELECT *.
"""
