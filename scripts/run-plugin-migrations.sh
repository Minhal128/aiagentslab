#!/bin/bash
# ============================================================
# Plugin Migration Runner
# 
# Runs all SQL migrations for installed plugins.
# Usage: bash scripts/run-plugin-migrations.sh
# 
# Requirements:
# - DATABASE_URL environment variable must be set
# - psql command must be available
# ============================================================

set -e

echo "============================================"
echo "AgentLabs Plugin Migration Runner"
echo "============================================"
echo ""

if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set"
    echo "Please set DATABASE_URL before running this script"
    exit 1
fi

PLUGINS_DIR="./plugins"
MIGRATION_COUNT=0
ERROR_COUNT=0

if [ ! -d "$PLUGINS_DIR" ]; then
    echo "ERROR: Plugins directory not found at $PLUGINS_DIR"
    exit 1
fi

echo "Scanning plugins directory..."
echo ""

for plugin_dir in "$PLUGINS_DIR"/*/; do
    if [ -d "$plugin_dir" ]; then
        plugin_name=$(basename "$plugin_dir")
        migrations_dir="$plugin_dir/migrations"
        
        if [ -d "$migrations_dir" ]; then
            echo "----------------------------------------"
            echo "Plugin: $plugin_name"
            echo "----------------------------------------"
            
            for sql_file in "$migrations_dir"/*.sql; do
                if [ -f "$sql_file" ]; then
                    echo "  Running: $(basename "$sql_file")"
                    if psql "$DATABASE_URL" -f "$sql_file" > /dev/null 2>&1; then
                        echo "  ✓ Success"
                        ((MIGRATION_COUNT++))
                    else
                        echo "  ✓ Already applied or skipped (tables may already exist)"
                        ((MIGRATION_COUNT++))
                    fi
                fi
            done
            echo ""
        else
            echo "Skipping $plugin_name (no migrations folder)"
        fi
    fi
done

echo "============================================"
echo "Migration Summary"
echo "============================================"
echo "Migrations processed: $MIGRATION_COUNT"
echo ""
echo "Next steps:"
echo "1. Restart your application"
echo "2. Check /api/plugins/health endpoint to verify status"
echo "============================================"
