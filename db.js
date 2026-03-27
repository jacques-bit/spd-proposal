const Database = require('better-sqlite3');
const path = require('path');

let db;

const DEFAULT_WO_TERMS = `WORK ORDER TERMS & CONDITIONS

1. SCOPE: Trade partner agrees to furnish all labor necessary to install the specified materials per the scope outlined in this work order.

2. MATERIALS: All materials will be supplied by Focus Flooring Solutions unless otherwise noted. Trade partner is responsible for proper handling, storage, and installation of all materials from point of delivery.

3. PROFESSIONAL STANDARDS: All work shall be performed in a professional and workmanlike manner in accordance with manufacturer guidelines and industry standards.

4. FOCUS FLOORING APPAREL: Trade partner and all crew members must wear Focus Flooring Solutions-branded apparel (shirt/vest) while on the job site at all times.

5. PERSONAL PROTECTIVE EQUIPMENT: Trade partner shall ensure all crew members maintain proper PPE at all times including safety glasses, knee pads, and appropriate footwear per OSHA standards.

6. SAFETY PROTOCOLS: Trade partner shall follow all site-specific safety protocols and comply with all applicable safety regulations. Any incidents must be immediately reported to the Focus Flooring project manager.

7. SITE CLEANLINESS: Trade partner is responsible for daily cleanup of their work area. All debris, packaging, and waste materials must be properly disposed of at the end of each work day.

8. WAREHOUSE PICKUP: When materials are to be picked up from the Focus Flooring warehouse, trade partner must schedule pickup in advance, bring proper vehicle and equipment, and sign for all materials received.

9. QUALITY CONTROL: All work is subject to inspection by Focus Flooring Solutions. Trade partner must correct any deficiencies at no additional cost. Final payment is contingent upon satisfactory completion and acceptance.

10. PAYMENT TERMS: Payment will be issued within [NET 30] days of receipt of a complete and accurate invoice, upon verification of satisfactory completion of work.

By signing below, Trade Partner acknowledges receipt of this Work Order and agrees to all terms and conditions stated herein.`;

function init() {
  db = new Database(path.join(__dirname, 'spd-proposal.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rep_name TEXT,
      phone TEXT,
      email TEXT,
      lead_time_days INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assembly_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      unit TEXT NOT NULL DEFAULT 'each',
      spread_rate REAL,
      material_cost REAL DEFAULT 0,
      labor_cost REAL DEFAULT 0,
      has_labor INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      unit TEXT DEFAULT 'SF',
      vendor_id INTEGER REFERENCES vendors(id),
      default_material_cost REAL DEFAULT 0,
      default_material_markup REAL DEFAULT 30,
      default_tax_rate REAL DEFAULT 7,
      default_vendor_fee REAL DEFAULT 0,
      default_labor_cost REAL DEFAULT 0,
      default_labor_markup REAL DEFAULT 20,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_name TEXT,
      project_address TEXT,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS proposal_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      size TEXT,
      quantity REAL DEFAULT 0,
      quantity_unit TEXT DEFAULT 'SF',
      material_cost REAL DEFAULT 0,
      material_markup REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      vendor_fee REAL DEFAULT 0,
      labor_cost REAL DEFAULT 0,
      labor_markup REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_assemblies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      catalog_id INTEGER,
      name TEXT NOT NULL,
      unit TEXT DEFAULT 'each',
      spread_rate REAL,
      units_needed REAL,
      material_cost REAL DEFAULT 0,
      material_markup REAL DEFAULT 0,
      labor_cost REAL DEFAULT 0,
      labor_markup REAL DEFAULT 0,
      has_labor INTEGER DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES proposal_products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trade_partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      trade TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      trade_partner_id INTEGER,
      wo_number TEXT,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      terms TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      executed_at TEXT,
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      description TEXT,
      quantity REAL DEFAULT 0,
      quantity_unit TEXT DEFAULT 'SF',
      unit_labor_rate REAL DEFAULT 0,
      total_labor REAL DEFAULT 0,
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      vendor_id INTEGER NOT NULL,
      po_number TEXT,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      total_cost REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT,
      confirmed_at TEXT,
      received_at TEXT,
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_name TEXT NOT NULL,
      description TEXT,
      quantity REAL DEFAULT 0,
      unit TEXT DEFAULT 'SF',
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
    );
  `);

  // Migration-safe additions for existing DBs
  const safeAlter = (sql) => { try { db.exec(sql); } catch(e) { /* column likely exists */ } };
  safeAlter(`ALTER TABLE proposals ADD COLUMN status TEXT DEFAULT 'draft'`);
  safeAlter(`ALTER TABLE proposals ADD COLUMN notes TEXT`);
  safeAlter(`ALTER TABLE assembly_catalog ADD COLUMN vendor_id INTEGER REFERENCES vendors(id)`);
  safeAlter(`ALTER TABLE proposal_products ADD COLUMN vendor_id INTEGER REFERENCES vendors(id)`);
  safeAlter(`ALTER TABLE proposal_products ADD COLUMN lead_time_days INTEGER DEFAULT 0`);
  safeAlter(`ALTER TABLE product_assemblies ADD COLUMN vendor_id INTEGER REFERENCES vendors(id)`);

  return db;
}

function seedIfEmpty() {
  // Seed vendors
  const vendorCount = db.prepare('SELECT COUNT(*) as c FROM vendors').get().c;
  if (vendorCount === 0) {
    const insertVendor = db.prepare(`
      INSERT INTO vendors (name, rep_name, phone, email, notes) VALUES (?, ?, ?, ?, ?)
    `);
    const seedVendors = db.transaction(() => {
      insertVendor.run('Shaw Industries', 'Mike Davis', '800-441-7429', 'mdavis@shaw.com', 'tile/carpet/LVT');
      insertVendor.run('Dal-Tile Corporation', 'Lisa Chen', '800-933-8453', 'lchen@daltile.com', 'tile');
      insertVendor.run('Mohawk Group', 'Tom Bradley', '800-622-6227', 'tbradley@mohawkgroup.com', 'carpet/LVT');
      insertVendor.run('Custom Building Products', 'Jim Harris', '800-272-8786', 'jharris@cbpmail.net', 'setting materials');
      insertVendor.run('Bostik', 'Anna White', '800-726-7845', 'awhite@bostik.com', 'adhesives');
      insertVendor.run('Schluter Systems', 'Karl Mueller', '800-472-4588', 'kmueller@schluter.com', 'transitions/trim');
    });
    seedVendors();
  }

  // Seed assembly catalog
  const count = db.prepare('SELECT COUNT(*) as c FROM assembly_catalog').get().c;
  if (count === 0) {
    // Get vendor IDs
    const vendors = {};
    db.prepare('SELECT id, name FROM vendors').all().forEach(v => { vendors[v.name] = v.id; });
    const cbpId = vendors['Custom Building Products'] || null;
    const bostikId = vendors['Bostik'] || null;
    const schluterID = vendors['Schluter Systems'] || null;

    const insert = db.prepare(`
      INSERT INTO assembly_catalog (name, description, unit, spread_rate, material_cost, labor_cost, has_labor, vendor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const items = [
      ['Thinset', '50lb bag', 'bag', 40, 18, 0, 0, cbpId],
      ['Unsanded Grout', '10lb bag', 'bag', 80, 12, 0, 0, cbpId],
      ['Sanded Grout', '25lb bag', 'bag', 50, 14, 0, 0, cbpId],
      ['Schluter Trim', 'Edge trim', 'LF', null, 4.50, 1.20, 1, schluterID],
      ['Floor Protection', 'Ram board / surface protection', 'SY', 9, 0.85, 0, 0, null],
      ['Tile Membrane', 'Uncoupling membrane', 'SF', 1, 1.20, 0, 0, null],
      ['Carpet Adhesive', 'Carpet glue-down adhesive', 'gallon', 35, 22, 0, 0, bostikId],
      ['Carpet Pad', 'Standard carpet pad', 'SY', 9, 3.50, 0, 0, null],
      ['Transition Strip', 'Door transition', 'each', null, 28, 15, 1, schluterID],
      ['LVT Adhesive', 'LVT glue-down adhesive', 'gallon', 50, 18, 0, 0, bostikId],
      ['Reducer/T-Mold', 'Flooring reducer or T-mold', 'LF', null, 6.50, 2, 1, schluterID],
    ];

    const seedMany = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    seedMany(items);
  }

  // Seed product catalog
  const pcCount = db.prepare('SELECT COUNT(*) as c FROM product_catalog').get().c;
  if (pcCount === 0) {
    const vendors = {};
    db.prepare('SELECT id, name FROM vendors').all().forEach(v => { vendors[v.name] = v.id; });
    const shawId = vendors['Shaw Industries'] || null;
    const dalTileId = vendors['Dal-Tile Corporation'] || null;
    const mohawkId = vendors['Mohawk Group'] || null;
    const schluterID = vendors['Schluter Systems'] || null;

    const insertPc = db.prepare(`
      INSERT INTO product_catalog (name, category, unit, vendor_id, default_material_cost, default_material_markup, default_tax_rate, default_vendor_fee, default_labor_cost, default_labor_markup)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const seedPc = db.transaction(() => {
      insertPc.run('24x24 Porcelain Floor Tile', 'tile', 'SF', shawId, 4.20, 30, 7, 0, 0, 20);
      insertPc.run('12x24 Ceramic Wall Tile', 'tile', 'SF', dalTileId, 3.80, 30, 7, 0, 0, 20);
      insertPc.run('LVT Plank 6x48', 'LVT', 'SF', shawId, 3.50, 30, 7, 0, 0, 20);
      insertPc.run('Broadloom Carpet', 'carpet', 'SY', mohawkId, 2.80, 30, 7, 0, 0, 20);
      insertPc.run('Carpet Tile 24x24', 'carpet', 'SF', mohawkId, 3.20, 30, 7, 0, 0, 20);
      insertPc.run('Rubber Base 4in', 'base', 'LF', schluterID, 2.10, 30, 7, 0, 0, 20);
      insertPc.run('Marble Threshold', 'transitions', 'each', dalTileId, 18, 30, 7, 0, 0, 20);
      insertPc.run('T-Mold Transition', 'transitions', 'LF', schluterID, 12, 30, 7, 0, 0, 20);
    });
    seedPc();
  }

  // Seed trade partners if empty
  const tpCount = db.prepare('SELECT COUNT(*) as c FROM trade_partners').get().c;
  if (tpCount === 0) {
    const insertTp = db.prepare(`
      INSERT INTO trade_partners (name, contact_name, trade) VALUES (?, ?, ?)
    `);
    const seedTp = db.transaction(() => {
      insertTp.run('Tile Masters LLC', 'Mike Torres', 'tile');
      insertTp.run('Premier Carpet Installers', 'Sarah Kim', 'carpet');
      insertTp.run('Pro Flooring Solutions', 'Dave Wilson', 'LVT');
    });
    seedTp();
  }
}

function getDb() {
  return db;
}

function getDefaultWoTerms() {
  return DEFAULT_WO_TERMS;
}

module.exports = { init, seedIfEmpty, getDb, getDefaultWoTerms };
