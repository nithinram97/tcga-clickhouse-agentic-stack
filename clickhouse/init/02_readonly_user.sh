#!/bin/bash
# Creates the read-only user the agent + MCP use. Guardrail layer #1.
set -e
: "${AGENT_RO_PASSWORD:?AGENT_RO_PASSWORD must be set}"
clickhouse-client -n <<-EOSQL
    CREATE USER IF NOT EXISTS agent_ro
        IDENTIFIED WITH plaintext_password BY '${AGENT_RO_PASSWORD}'
        SETTINGS readonly = 1, max_execution_time = 30, max_result_rows = 100000,
                 max_rows_to_read = 200000000, max_bytes_to_read = 20000000000,
                 max_memory_usage = 4000000000;
    CREATE DATABASE IF NOT EXISTS tcga;
    GRANT SELECT ON tcga.*         TO agent_ro;
    GRANT SELECT ON system.columns TO agent_ro;
    GRANT SELECT ON system.tables  TO agent_ro;
EOSQL
echo "read-only user 'agent_ro' created"
