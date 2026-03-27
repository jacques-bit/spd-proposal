#!/usr/bin/env node
// Migration script: copies all data from SQLite -> PostgreSQL
// Run: DATABASE_URL=<pg_url> node migrate-sqlite-to-pg.js

const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) {
  console.error('Set DATABASE_URL env var to the PostgreSQL connection string');
  process.exit(1);
}

const sqlite = new Database(path.join(__dirname, 'spd-proposal.db'));
const pool = new Pool({ connectionString: PG_URL });

function pgSql(sql) {
  sql = sql.replace(/datetime\('now'\)/g, 'NOW()');
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);
  return sql;
}

async function migrateTable(tableName, columns) {
  const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (skipping)`);
    return;
  }

  // Clear existing data
  await pool.query(`DELETE FROM ${tableName}`);

  // Reset sequence
  await pool.query(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), 1, false)`).catch(() => {});

  let inserted = 0;
  for (const row of rows) {
    const vals = columns.map(c => row[c] !== undefined ? row[c] : null);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const colList = columns.join(', ');
    await pool.query(
      `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
      vals
    );
    inserted++;
  }

  // Update sequence to max id
  await pool.query(
    `SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE(MAX(id), 1)) FROM ${tableName}`
  ).catch(() => {});

  console.log(`  ${tableName}: ${inserted} rows migrated`);
}

async function main() {
  console.log('Starting SQLite -> PostgreSQL migration...\n');

  try {
    // Disable FK constraints, clear all tables, re-enable
    await pool.query('SET session_replication_role = replica');

    await migrateTable('vendors', ['id', 'name', 'rep_name', 'phone', 'email', 'lead_time_days', 'notes', 'created_at']);
    await migrateTable('assembly_catalog', ['id', 'name', 'description', 'unit', 'spread_rate', 'material_cost', 'labor_cost', 'has_labor', 'vendor_id', 'created_at']);
    await migrateTable('product_catalog', ['id', 'name', 'description', 'category', 'unit', 'vendor_id', 'default_material_cost', 'default_material_markup', 'default_tax_rate', 'default_vendor_fee', 'default_labor_cost', 'default_labor_markup', 'created_at']);
    await migrateTable('proposals', ['id', 'name', 'client_name', 'project_address', 'status', 'notes', 'created_at', 'updated_at']);
    await migrateTable('proposal_products', ['id', 'proposal_id', 'product_name', 'scope_type', 'description', 'color', 'size', 'quantity', 'quantity_unit', 'material_cost', 'material_markup', 'tax_rate', 'vendor_fee', 'labor_cost', 'labor_markup', 'sort_order', 'vendor_id', 'lead_time_days', 'waste_pct', 'package_qty']);
    await migrateTable('product_assemblies', ['id', 'product_id', 'catalog_id', 'name', 'unit', 'spread_rate', 'units_needed', 'material_cost', 'material_markup', 'labor_cost', 'labor_markup', 'has_labor', 'vendor_id']);
    await migrateTable('trade_partners', ['id', 'name', 'contact_name', 'phone', 'email', 'trade', 'created_at']);
    await migrateTable('work_orders', ['id', 'proposal_id', 'trade_partner_id', 'wo_number', 'status', 'notes', 'terms', 'created_at', 'executed_at']);
    await migrateTable('work_order_items', ['id', 'work_order_id', 'product_name', 'description', 'quantity', 'quantity_unit', 'unit_labor_rate', 'total_labor']);
    await migrateTable('purchase_orders', ['id', 'proposal_id', 'vendor_id', 'po_number', 'status', 'notes', 'total_cost', 'created_at', 'sent_at', 'confirmed_at', 'received_at']);
    await migrateTable('purchase_order_items', ['id', 'po_id', 'item_type', 'item_name', 'description', 'quantity', 'unit', 'unit_cost', 'total_cost']);

    await pool.query('SET session_replication_role = DEFAULT');

    console.log('\nMigration complete!');
  } catch (e) {
    console.error('Migration error:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
    sqlite.close();
  }
}

main();
