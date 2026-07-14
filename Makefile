.DEFAULT_GOAL := help
COMPOSE     := docker compose
LF_OVERLAY  := -f docker-compose.yml -f docker-compose.langfuse.yml
MCP_OVERLAY := -f docker-compose.yml -f docker-compose.mcp.yml

.PHONY: help keys up ingest logs ps down clean langfuse-up mcp-up full-up smoke

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

keys: ## Generate LibreChat + Langfuse secrets into .env (run once)
	@python3 scripts/gen_keys.py

up: ## Start core stack (clickhouse, ingest, agent, librechat)
	$(COMPOSE) up -d --build

ingest: ## Re-run the TCGA ingestion job
	TCGA_FORCE_REINGEST=true $(COMPOSE) run --rm tcga-ingest

logs: ## Tail agent + librechat logs
	$(COMPOSE) logs -f agent librechat

ps: ## Show running services
	$(COMPOSE) ps

down: ## Stop everything (keep volumes)
	$(COMPOSE) $(LF_OVERLAY) $(MCP_OVERLAY) down

clean: ## Stop everything and delete volumes (destroys ingested data)
	$(COMPOSE) $(LF_OVERLAY) $(MCP_OVERLAY) down -v

langfuse-up: ## Start core stack + self-hosted Langfuse
	$(COMPOSE) $(LF_OVERLAY) up -d --build

mcp-up: ## Start core stack + ClickHouse MCP server
	$(COMPOSE) $(MCP_OVERLAY) up -d --build

full-up: ## Start everything (core + Langfuse + MCP)
	$(COMPOSE) $(LF_OVERLAY) $(MCP_OVERLAY) up -d --build

smoke: ## Hit the agent endpoint with a sample question
	@curl -s http://localhost:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"tcga-analyst","messages":[{"role":"user","content":"Which 5 genes are most frequently mutated in TCGA-PAAD?"}]}' | python3 -m json.tool
