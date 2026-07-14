# TCGA Agentic Stack

> Ask cancer-genomics questions in plain English and get verifiable SQL back.
> A LangGraph validated-analyst agent over ClickHouse — with a ClickHouse MCP
> server, Langfuse tracing, and a LibreChat UI. Self-contained, one command to run.

![License](https://img.shields.io/badge/license-MIT-blue)
![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)
![ClickHouse](https://img.shields.io/badge/ClickHouse-analytics-FFCC01?logo=clickhouse&logoColor=black)
![LangGraph](https://img.shields.io/badge/LangGraph-agent-1C3C3C)
![Langfuse](https://img.shields.io/badge/Langfuse-tracing-000000)
![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-6E56CF)

A self-contained, Docker-based **agentic analytics** stack that turns
natural-language questions into **validated, read-only SQL** over **The Cancer
Genome Atlas (TCGA)** stored in **ClickHouse**. It combines a **LangChain /
LangGraph** text-to-SQL agent, a **ClickHouse MCP** server (Model Context
Protocol), **Langfuse** for LLM observability, and **LibreChat** as the chat
interface. Every answer includes the exact query it ran, so results are
reproducible and trustworthy.

Data source: [TCGA on the AWS Registry of Open Data](https://registry.opendata.aws/tcga/).
Ingestion pulls **open-access** clinical + somatic-mutation (MAF) data via the
public [GDC API](https://gdc.cancer.gov) — **no AWS credentials required**.

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Sample questions](#sample-questions)
- [Guardrails](#guardrails)
- [Optional add-ons](#optional-add-ons)
- [Configuration](#configuration)
- [Repository layout](#repository-layout)
- [Data volume &amp; scope](#data-volume--scope)
- [Caveats &amp; data use](#caveats--data-use)
- [License](#license)

---

## Why this exists

Most "chat with your database" demos fall over the moment a model hallucinates a
column, writes a query that scans terabytes, or states a number it can't back up.
This project is built around those failure modes. The LangGraph pipeline generates
SQL, **statically checks it, validates it with `EXPLAIN`, executes it under a
read-only role with hard resource caps, and returns the query alongside the
answer** — so every result is cheap, safe, and verifiable.

It's a practical reference for **agentic analytics**: text-to-SQL that's reliable
enough to trust, fully traced so nothing is a black box, and served through a
polished chat UI.

## Architecture

```
                 ┌──────────────┐     custom endpoint      ┌──────────────────────┐
   you  ───────▶ │  LibreChat   │ ───────────────────────▶ │  agent (FastAPI)     │
                 │  (chat UI)   │   OpenAI-compatible /v1   │  LangGraph analyst   │
                 └──────┬───────┘                           └──────────┬───────────┘
                        │ (optional) native agent                       │ read-only (agent_ro)
                        │  via MCP tools                                 ▼
                 ┌──────▼───────────┐                        ┌──────────────────────┐
                 │ clickhouse-mcp   │ ─────────────────────▶ │  ClickHouse (tcga.*)  │
                 └──────────────────┘                        └──────────▲───────────┘
                                                                        │ one-shot load
   GDC public API  ───────────────────────────────────────────────────┘ (tcga-ingest)

   every LLM call in `agent` (and LibreChat itself) ───▶  Langfuse  (traces / cost / evals)
```

Two independent paths hit the same read-only ClickHouse credential, so both
inherit identical guardrails:

- **TCGA Analyst** — a custom OpenAI-compatible endpoint backed by the guardrailed
  LangGraph pipeline.
- **Native LibreChat agent + ClickHouse MCP** — generic text-to-SQL over MCP tools.

## Quickstart

**Prerequisites:** Docker + Docker Compose, and an LLM API key (OpenAI, or any
OpenAI-compatible endpoint including a local vLLM/Ollama).

```bash
git clone https://github.com/<you>/tcga-agentic-stack.git
cd tcga-agentic-stack

cp .env.example .env
make keys                      # fills LibreChat + Langfuse secrets

# edit .env: set AGENT_LLM_API_KEY, AGENT_RO_PASSWORD, and Langfuse keys
make up                        # build + start core stack; ingestion runs once

make logs                      # watch ingestion + agent come up
make smoke                     # ask the agent a sample question via curl
```

Then open **LibreChat at http://localhost:3080**, register a local account, pick
**"TCGA Analyst (validated SQL)"**, and start asking questions.

## Sample questions

- *Which 5 genes are most frequently mutated in TCGA-PAAD?*
- *How many patients have a KRAS mutation, and what fraction of the cohort is that?*
- *What are the most common variant classifications?*
- *Compare vital-status counts for patients with vs without a TP53 mutation.*
- *What's the average age at diagnosis, in years, for KRAS-mutated patients?*

Each answer includes the exact SQL it ran, so you can verify it.

## Guardrails

The stack is built around the failure modes documented for production text-to-SQL
agents. The LangGraph pipeline adds:

| Guardrail | Where | What it prevents |
|---|---|---|
| Read-only credential (`readonly=1`) | `clickhouse/init/02_readonly_user.sh` | any write/DDL, even if the model is jailbroken |
| Row / scan / time caps | same | runaway "scan 3 TB because it can" queries and timeouts |
| Static keyword check | `agent/graph.py:guard` | `INSERT/DROP/…` and multi-statement injection |
| `EXPLAIN` validation | `agent/graph.py:guard` | executing invalid SQL; errors are caught before they cost anything |
| Bounded retry with the error | `agent/graph.py:route_after_guard` | one-shot failures; the model self-corrects |
| SQL shown in every answer | `agent/graph.py:summarize` | unverifiable claims |
| Schema glossary from `system.columns` | `agent/schema_context.py` | hallucinated columns; the glossary can't drift from the schema |

Everything above is traced to Langfuse, so you can score answer quality, catch
regressions across prompt/schema changes, and watch cost per session.

## Optional add-ons

**Self-hosted Langfuse** (else use Langfuse Cloud):

```bash
make langfuse-up               # Langfuse at http://localhost:3000
```

Create a project in the Langfuse UI, copy its keys into `.env`
(`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`), set
`LANGFUSE_HOST=http://langfuse-web:3000`, then `make up` again.

**ClickHouse MCP server** (a second, MCP-driven path to the same data):

```bash
make mcp-up                    # ClickHouse MCP on :8001
```

Then build a native **Agent** inside LibreChat and attach the `clickhouse` MCP
server.

## Configuration

All via `.env` (see `.env.example` for the full list):

| Var | Meaning |
|---|---|
| `TCGA_PROJECTS` | comma-separated GDC projects to ingest (e.g. `TCGA-PAAD,TCGA-BRCA`) |
| `TCGA_MAX_MAF_FILES` / `TCGA_MAX_CASES` | slice-size caps per project |
| `AGENT_MODEL` / `AGENT_LLM_API_KEY` / `AGENT_LLM_BASE_URL` | the agent's LLM (any OpenAI-compatible endpoint) |
| `AGENT_RO_PASSWORD` | password for the read-only ClickHouse user |
| `LANGFUSE_*` | Langfuse Cloud or self-hosted keys/host |

Re-ingest a different slice any time:

```bash
# edit TCGA_PROJECTS in .env, then:
make ingest
```

## Repository layout

```
.
├── docker-compose.yml            # core: clickhouse, ingest, agent, librechat, mongo
├── docker-compose.mcp.yml        # overlay: ClickHouse MCP server
├── docker-compose.langfuse.yml   # overlay: self-hosted Langfuse v3
├── Makefile                      # up / ingest / langfuse-up / mcp-up / smoke
├── clickhouse/init/              # schema + read-only user (guardrails)
├── ingest/                       # GDC API -> ClickHouse loader
├── agent/                        # LangGraph validated analyst (OpenAI-compatible API)
├── librechat/librechat.yaml      # wires the agent as a custom endpoint + MCP
└── scripts/gen_keys.py           # generates LibreChat + Langfuse secrets
```

## Data volume &amp; scope

TCGA is ~2.5 PB and mostly file-based genomics behind GDC UUIDs, so this project
ingests a **small, configurable slice** — not a literal full dump. With the
defaults (`TCGA-PAAD`, up to 3 MAF files), you get roughly a few hundred clinical
rows and single-digit-thousands of mutation rows: a few MB raw, well under a
megabyte on disk after ClickHouse compression. Scale it up by raising
`TCGA_MAX_MAF_FILES` or adding projects. Only de-identified, open-access data is
touched; controlled-access buckets are never used.

## Caveats &amp; data use

- **Alternative ingest via anonymous S3.** Instead of the GDC API you can read the
  same open files directly from `s3://tcga-2-open` (us-east-1) with
  `aws s3 ... --no-sign-request`. The API path is used here because it needs no S3
  client and resolves files by project cleanly.
- **Langfuse overlay is version-pinned.** Langfuse's self-host compose evolves; if
  it drifts, the canonical reference is
  [`langfuse/langfuse` `docker-compose.yml`](https://github.com/langfuse/langfuse/blob/main/docker-compose.yml).
- **ClickHouse MCP transport env vars** vary by release — if MCP tools don't appear
  in LibreChat, check the pinned `mcp-clickhouse` version's README.
- **Not for clinical decisions.** This is a demo/education scaffold over public
  research data. TCGA use is governed by the
  [NIH Genomic Data Sharing Policy](https://gdc.cancer.gov/access-data/data-access-policies).

## License

MIT — see [`LICENSE`](LICENSE). TCGA data carries its own NIH terms; see above.

---

<sub>Keywords: agentic analytics · text-to-SQL · natural-language-to-SQL · ClickHouse ·
LangChain · LangGraph · Model Context Protocol (MCP) · Langfuse · LibreChat · LLM
observability · AI agents · cancer genomics · bioinformatics · TCGA · Docker.</sub>
