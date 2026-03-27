const express = require('express');
const router = express.Router();
const { getDb, getDefaultWoTerms } = require('./db');

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeProductTotals(product, assemblies) {
  const q = product.quantity || 0;
  const matCost = q * (product.material_cost || 0);
  const matSell = matCost
    * (1 + (product.material_markup || 0) / 100)
    * (1 + (product.tax_rate || 0) / 100)
    * (1 + (product.vendor_fee || 0) / 100);
  const labCost = q * (product.labor_cost || 0);
  const labSell = labCost * (1 + (product.labor_markup || 0) / 100);

  let asmSell = 0;
  let asmCost = 0;

  const enrichedAssemblies = assemblies.map(a => {
    const unitsNeeded = (a.spread_rate && a.spread_rate > 0)
      ? Math.ceil(q / a.spread_rate)
      : (a.units_needed || 0);

    const asmMatSell = unitsNeeded * (a.material_cost || 0) * (1 + (a.material_markup || 0) / 100);
    const asmLabSell = a.has_labor
      ? unitsNeeded * (a.labor_cost || 0) * (1 + (a.labor_markup || 0) / 100)
      : 0;
    const asmTotalSell = asmMatSell + asmLabSell;
    const asmTotalCost = unitsNeeded * ((a.material_cost || 0) + (a.labor_cost || 0));

    asmSell += asmTotalSell;
    asmCost += asmTotalCost;

    return {
      ...a,
      units_needed_calc: unitsNeeded,
      asm_material_sell: round2(asmMatSell),
      asm_labor_sell: round2(asmLabSell),
      asm_total_sell: round2(asmTotalSell),
      asm_total_cost: round2(asmTotalCost),
    };
  });

  const totalSell = matSell + labSell + asmSell;
  const totalCost = matCost + labCost + asmCost;
  const gpAmount = totalSell - totalCost;
  const gpPct = totalSell > 0 ? (gpAmount / totalSell) * 100 : 0;

  return {
    material_sell: round2(matSell),
    material_cost_true: round2(matCost),
    labor_sell: round2(labSell),
    labor_cost_true: round2(labCost),
    assembly_sell: round2(asmSell),
    assembly_cost: round2(asmCost),
    total_sell: round2(totalSell),
    total_cost: round2(totalCost),
    gp_amount: round2(gpAmount),
    gp_pct: round2(gpPct),
    assemblies: enrichedAssemblies,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ─── Vendors ─────────────────────────────────────────────────────────────────

router.get('/api/vendors', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM vendors ORDER BY name').all());
});

router.post('/api/vendors', (req, res) => {
  const db = getDb();
  const { name, rep_name, phone, email, lead_time_days, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(`
    INSERT INTO vendors (name, rep_name, phone, email, lead_time_days, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, rep_name || null, phone || null, email || null, lead_time_days || 0, notes || null);
  res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/api/vendors/:id', (req, res) => {
  const db = getDb();
  const { name, rep_name, phone, email, lead_time_days, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare(`
    UPDATE vendors SET name=?, rep_name=?, phone=?, email=?, lead_time_days=?, notes=? WHERE id=?
  `).run(name, rep_name || null, phone || null, email || null, lead_time_days || 0, notes || null, req.params.id);
  res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id));
});

router.delete('/api/vendors/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM vendors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Product Catalog ─────────────────────────────────────────────────────────

router.get('/api/product-catalog', (req, res) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT pc.*, v.name as vendor_name
    FROM product_catalog pc
    LEFT JOIN vendors v ON v.id = pc.vendor_id
    ORDER BY pc.category, pc.name
  `).all();
  res.json(items);
});

router.post('/api/product-catalog', (req, res) => {
  const db = getDb();
  const { name, description, category, unit, vendor_id, default_material_cost,
    default_material_markup, default_tax_rate, default_vendor_fee, default_labor_cost, default_labor_markup } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(`
    INSERT INTO product_catalog
      (name, description, category, unit, vendor_id, default_material_cost, default_material_markup,
       default_tax_rate, default_vendor_fee, default_labor_cost, default_labor_markup)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, description || null, category || null, unit || 'SF', vendor_id || null,
    default_material_cost || 0, default_material_markup || 30, default_tax_rate || 7,
    default_vendor_fee || 0, default_labor_cost || 0, default_labor_markup || 20);
  const item = db.prepare(`
    SELECT pc.*, v.name as vendor_name FROM product_catalog pc LEFT JOIN vendors v ON v.id = pc.vendor_id WHERE pc.id = ?
  `).get(result.lastInsertRowid);
  res.json(item);
});

router.put('/api/product-catalog/:id', (req, res) => {
  const db = getDb();
  const { name, description, category, unit, vendor_id, default_material_cost,
    default_material_markup, default_tax_rate, default_vendor_fee, default_labor_cost, default_labor_markup } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare(`
    UPDATE product_catalog SET name=?, description=?, category=?, unit=?, vendor_id=?,
      default_material_cost=?, default_material_markup=?, default_tax_rate=?, default_vendor_fee=?,
      default_labor_cost=?, default_labor_markup=?
    WHERE id=?
  `).run(name, description || null, category || null, unit || 'SF', vendor_id || null,
    default_material_cost || 0, default_material_markup || 30, default_tax_rate || 7,
    default_vendor_fee || 0, default_labor_cost || 0, default_labor_markup || 20, req.params.id);
  const item = db.prepare(`
    SELECT pc.*, v.name as vendor_name FROM product_catalog pc LEFT JOIN vendors v ON v.id = pc.vendor_id WHERE pc.id = ?
  `).get(req.params.id);
  res.json(item);
});

router.delete('/api/product-catalog/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM product_catalog WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Catalog (Assembly Catalog) ───────────────────────────────────────────────

router.get('/api/catalog', (req, res) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT ac.*, v.name as vendor_name FROM assembly_catalog ac
    LEFT JOIN vendors v ON v.id = ac.vendor_id
    ORDER BY ac.name
  `).all();
  res.json(items);
});

router.post('/api/catalog', (req, res) => {
  const db = getDb();
  const { name, description, unit, spread_rate, material_cost, labor_cost, has_labor, vendor_id } = req.body;
  if (!name || !unit) return res.status(400).json({ error: 'name and unit required' });
  const result = db.prepare(`
    INSERT INTO assembly_catalog (name, description, unit, spread_rate, material_cost, labor_cost, has_labor, vendor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, description || null, unit, spread_rate || null, material_cost || 0, labor_cost || 0, has_labor ? 1 : 0, vendor_id || null);
  res.json(db.prepare('SELECT * FROM assembly_catalog WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/api/catalog/:id', (req, res) => {
  const db = getDb();
  const { name, description, unit, spread_rate, material_cost, labor_cost, has_labor, vendor_id } = req.body;
  db.prepare(`
    UPDATE assembly_catalog SET name=?, description=?, unit=?, spread_rate=?, material_cost=?, labor_cost=?, has_labor=?, vendor_id=?
    WHERE id=?
  `).run(name, description || null, unit, spread_rate || null, material_cost || 0, labor_cost || 0, has_labor ? 1 : 0, vendor_id || null, req.params.id);
  res.json(db.prepare('SELECT * FROM assembly_catalog WHERE id = ?').get(req.params.id));
});

router.delete('/api/catalog/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM assembly_catalog WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Trade Partners ───────────────────────────────────────────────────────────

router.get('/api/trade-partners', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM trade_partners ORDER BY name').all());
});

router.post('/api/trade-partners', (req, res) => {
  const db = getDb();
  const { name, contact_name, phone, email, trade } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(`
    INSERT INTO trade_partners (name, contact_name, phone, email, trade)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, contact_name || null, phone || null, email || null, trade || null);
  res.json(db.prepare('SELECT * FROM trade_partners WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/api/trade-partners/:id', (req, res) => {
  const db = getDb();
  const { name, contact_name, phone, email, trade } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare(`
    UPDATE trade_partners SET name=?, contact_name=?, phone=?, email=?, trade=? WHERE id=?
  `).run(name, contact_name || null, phone || null, email || null, trade || null, req.params.id);
  res.json(db.prepare('SELECT * FROM trade_partners WHERE id = ?').get(req.params.id));
});

router.delete('/api/trade-partners/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM trade_partners WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Proposals ───────────────────────────────────────────────────────────────

router.get('/api/proposals', (req, res) => {
  const db = getDb();
  const proposals = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all();
  res.json(proposals);
});

router.post('/api/proposals', (req, res) => {
  const db = getDb();
  const { name, client_name, project_address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(`
    INSERT INTO proposals (name, client_name, project_address, notes)
    VALUES (?, ?, ?, ?)
  `).run(name, client_name || null, project_address || null, notes || null);
  res.json(db.prepare('SELECT * FROM proposals WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/api/proposals/:id', (req, res) => {
  const db = getDb();
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Not found' });

  const products = db.prepare('SELECT pp.*, v.name as vendor_name FROM proposal_products pp LEFT JOIN vendors v ON v.id = pp.vendor_id WHERE pp.proposal_id = ? ORDER BY pp.sort_order, pp.id').all(proposal.id);

  let grandSell = 0, grandCost = 0;

  const enrichedProducts = products.map(p => {
    const assemblies = db.prepare('SELECT pa.*, v.name as vendor_name FROM product_assemblies pa LEFT JOIN vendors v ON v.id = pa.vendor_id WHERE pa.product_id = ? ORDER BY pa.id').all(p.id);
    const totals = computeProductTotals(p, assemblies);
    grandSell += totals.total_sell;
    grandCost += totals.total_cost;
    return { ...p, ...totals };
  });

  const grandGp = grandSell - grandCost;
  const grandGpPct = grandSell > 0 ? (grandGp / grandSell) * 100 : 0;

  res.json({
    ...proposal,
    products: enrichedProducts,
    grand_total_sell: round2(grandSell),
    grand_total_cost: round2(grandCost),
    grand_gp_amount: round2(grandGp),
    grand_gp_pct: round2(grandGpPct),
  });
});

router.put('/api/proposals/:id', (req, res) => {
  const db = getDb();
  const { name, client_name, project_address, status, notes } = req.body;
  db.prepare(`
    UPDATE proposals SET name=?, client_name=?, project_address=?, status=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(name, client_name || null, project_address || null, status || 'draft', notes || null, req.params.id);
  res.json(db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id));
});

router.delete('/api/proposals/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM proposals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Products ────────────────────────────────────────────────────────────────

router.post('/api/proposals/:id/products', (req, res) => {
  const db = getDb();
  const { product_name, description, color, size, quantity, quantity_unit,
    material_cost, material_markup, tax_rate, vendor_fee, labor_cost, labor_markup, sort_order, vendor_id } = req.body;
  if (!product_name) return res.status(400).json({ error: 'product_name required' });
  const result = db.prepare(`
    INSERT INTO proposal_products
      (proposal_id, product_name, scope_type, description, color, size, quantity, quantity_unit,
       material_cost, material_markup, tax_rate, vendor_fee, labor_cost, labor_markup, sort_order, vendor_id, waste_pct, package_qty, lead_time_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id, product_name, req.body.scope_type || null, description || null, color || null, size || null,
    quantity || 0, quantity_unit || 'SF',
    material_cost || 0, material_markup || 0, tax_rate || 0, vendor_fee || 0,
    labor_cost || 0, labor_markup || 0, sort_order || 0, vendor_id || null,
    req.body.waste_pct || 0, req.body.package_qty || 0, req.body.lead_time_days || 0
  );
  res.json(db.prepare('SELECT * FROM proposal_products WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/api/products/:id', (req, res) => {
  const db = getDb();
  const { product_name, description, color, size, quantity, quantity_unit,
    material_cost, material_markup, tax_rate, vendor_fee, labor_cost, labor_markup, sort_order, vendor_id } = req.body;
  db.prepare(`
    UPDATE proposal_products SET
      product_name=?, scope_type=?, description=?, color=?, size=?, quantity=?, quantity_unit=?,
      material_cost=?, material_markup=?, tax_rate=?, vendor_fee=?, labor_cost=?, labor_markup=?, sort_order=?, vendor_id=?, waste_pct=?, package_qty=?, lead_time_days=?
    WHERE id=?
  `).run(
    product_name, req.body.scope_type || null, description || null, color || null, size || null,
    quantity || 0, quantity_unit || 'SF',
    material_cost || 0, material_markup || 0, tax_rate || 0, vendor_fee || 0,
    labor_cost || 0, labor_markup || 0, sort_order || 0, vendor_id || null,
    req.body.waste_pct || 0, req.body.package_qty || 0, req.body.lead_time_days || 0, req.params.id
  );
  const product = db.prepare('SELECT proposal_id FROM proposal_products WHERE id = ?').get(req.params.id);
  if (product) db.prepare(`UPDATE proposals SET updated_at=datetime('now') WHERE id=?`).run(product.proposal_id);
  res.json(db.prepare('SELECT * FROM proposal_products WHERE id = ?').get(req.params.id));
});

router.delete('/api/products/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM proposal_products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Assemblies ──────────────────────────────────────────────────────────────

router.post('/api/products/:id/assemblies', (req, res) => {
  const db = getDb();
  let { catalog_id, name, unit, spread_rate, units_needed, material_cost, material_markup, labor_cost, labor_markup, has_labor, vendor_id } = req.body;

  if (catalog_id) {
    const cat = db.prepare('SELECT * FROM assembly_catalog WHERE id = ?').get(catalog_id);
    if (cat) {
      name = name || cat.name;
      unit = unit || cat.unit;
      spread_rate = spread_rate !== undefined ? spread_rate : cat.spread_rate;
      material_cost = material_cost !== undefined ? material_cost : cat.material_cost;
      labor_cost = labor_cost !== undefined ? labor_cost : cat.labor_cost;
      has_labor = has_labor !== undefined ? has_labor : cat.has_labor;
      vendor_id = vendor_id !== undefined ? vendor_id : cat.vendor_id;
    }
  }

  if (!name) return res.status(400).json({ error: 'name required' });

  const product = db.prepare('SELECT quantity FROM proposal_products WHERE id = ?').get(req.params.id);
  const qty = product ? (product.quantity || 0) : 0;
  if (spread_rate && spread_rate > 0) {
    units_needed = Math.ceil(qty / spread_rate);
  }

  const result = db.prepare(`
    INSERT INTO product_assemblies
      (product_id, catalog_id, name, unit, spread_rate, units_needed, material_cost, material_markup, labor_cost, labor_markup, has_labor, vendor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id, catalog_id || null, name, unit || 'each',
    spread_rate || null, units_needed || 0,
    material_cost || 0, material_markup || 0, labor_cost || 0, labor_markup || 0, has_labor ? 1 : 0,
    vendor_id || null
  );
  res.json(db.prepare('SELECT * FROM product_assemblies WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/api/assemblies/:id', (req, res) => {
  const db = getDb();
  let { name, unit, spread_rate, units_needed, material_cost, material_markup, labor_cost, labor_markup, has_labor, vendor_id } = req.body;

  const asm = db.prepare('SELECT product_id FROM product_assemblies WHERE id = ?').get(req.params.id);
  if (asm) {
    const product = db.prepare('SELECT quantity FROM proposal_products WHERE id = ?').get(asm.product_id);
    const qty = product ? (product.quantity || 0) : 0;
    if (spread_rate && spread_rate > 0) {
      units_needed = Math.ceil(qty / spread_rate);
    }
  }

  db.prepare(`
    UPDATE product_assemblies SET
      name=?, unit=?, spread_rate=?, units_needed=?, material_cost=?, material_markup=?,
      labor_cost=?, labor_markup=?, has_labor=?, vendor_id=?
    WHERE id=?
  `).run(
    name, unit || 'each', spread_rate || null, units_needed || 0,
    material_cost || 0, material_markup || 0, labor_cost || 0, labor_markup || 0,
    has_labor ? 1 : 0, vendor_id || null, req.params.id
  );
  res.json(db.prepare('SELECT * FROM product_assemblies WHERE id = ?').get(req.params.id));
});

router.delete('/api/assemblies/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM product_assemblies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Work Orders ─────────────────────────────────────────────────────────────

router.get('/api/proposals/:id/work-orders', (req, res) => {
  const db = getDb();
  const wos = db.prepare(`
    SELECT wo.*, tp.name as trade_partner_name, tp.contact_name as trade_partner_contact,
      (SELECT COALESCE(SUM(total_labor), 0) FROM work_order_items WHERE work_order_id = wo.id) as total_labor
    FROM work_orders wo
    LEFT JOIN trade_partners tp ON tp.id = wo.trade_partner_id
    WHERE wo.proposal_id = ?
    ORDER BY wo.created_at DESC
  `).all(req.params.id);
  res.json(wos);
});

router.post('/api/proposals/:id/work-orders', (req, res) => {
  const db = getDb();
  const { trade_partner_id, notes } = req.body;

  // Auto-generate WO number: WO-YYYY-NNNN
  const year = new Date().getFullYear();
  const countRow = db.prepare(`SELECT COUNT(*) as c FROM work_orders WHERE wo_number LIKE ?`).get(`WO-${year}-%`);
  const seq = String((countRow.c || 0) + 1).padStart(4, '0');
  const wo_number = `WO-${year}-${seq}`;

  const result = db.prepare(`
    INSERT INTO work_orders (proposal_id, trade_partner_id, wo_number, status, notes, terms)
    VALUES (?, ?, ?, 'draft', ?, ?)
  `).run(req.params.id, trade_partner_id || null, wo_number, notes || null, getDefaultWoTerms());

  res.json(db.prepare('SELECT * FROM work_orders WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/api/work-orders/:id', (req, res) => {
  const db = getDb();
  const wo = db.prepare(`
    SELECT wo.*, tp.name as trade_partner_name, tp.contact_name as trade_partner_contact,
      tp.phone as trade_partner_phone, tp.email as trade_partner_email,
      p.name as proposal_name
    FROM work_orders wo
    LEFT JOIN trade_partners tp ON tp.id = wo.trade_partner_id
    LEFT JOIN proposals p ON p.id = wo.proposal_id
    WHERE wo.id = ?
  `).get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });

  const items = db.prepare('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY id').all(wo.id);
  const totalLabor = items.reduce((sum, i) => sum + (i.total_labor || 0), 0);
  res.json({ ...wo, items, total_labor: round2(totalLabor) });
});

router.put('/api/work-orders/:id', (req, res) => {
  const db = getDb();
  const { status, trade_partner_id, notes, terms } = req.body;
  db.prepare(`
    UPDATE work_orders SET status=?, trade_partner_id=?, notes=?, terms=? WHERE id=?
  `).run(status || 'draft', trade_partner_id || null, notes || null, terms || null, req.params.id);
  res.json(db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id));
});

router.delete('/api/work-orders/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM work_orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/api/work-orders/:id/execute', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE work_orders SET status='executed', executed_at=datetime('now') WHERE id=?`).run(req.params.id);
  res.json(db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id));
});

router.put('/api/work-orders/:id/commit', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE work_orders SET status='committed' WHERE id=?`).run(req.params.id);
  res.json(db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id));
});

// ─── Work Order Items ─────────────────────────────────────────────────────────

router.post('/api/work-orders/:id/items', (req, res) => {
  const db = getDb();
  const { product_name, description, quantity, quantity_unit, unit_labor_rate } = req.body;
  if (!product_name) return res.status(400).json({ error: 'product_name required' });
  const qty = parseFloat(quantity) || 0;
  const rate = parseFloat(unit_labor_rate) || 0;
  const total = round2(qty * rate);
  const result = db.prepare(`
    INSERT INTO work_order_items (work_order_id, product_name, description, quantity, quantity_unit, unit_labor_rate, total_labor)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, product_name, description || null, qty, quantity_unit || 'SF', rate, total);
  res.json(db.prepare('SELECT * FROM work_order_items WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/api/work-order-items/:id', (req, res) => {
  const db = getDb();
  const { product_name, description, quantity, quantity_unit, unit_labor_rate } = req.body;
  const qty = parseFloat(quantity) || 0;
  const rate = parseFloat(unit_labor_rate) || 0;
  const total = round2(qty * rate);
  db.prepare(`
    UPDATE work_order_items SET product_name=?, description=?, quantity=?, quantity_unit=?, unit_labor_rate=?, total_labor=?
    WHERE id=?
  `).run(product_name, description || null, qty, quantity_unit || 'SF', rate, total, req.params.id);
  res.json(db.prepare('SELECT * FROM work_order_items WHERE id = ?').get(req.params.id));
});

router.delete('/api/work-order-items/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM work_order_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────

router.get('/api/proposals/:id/purchase-orders', (req, res) => {
  const db = getDb();
  const pos = db.prepare(`
    SELECT po.*, v.name as vendor_name, v.rep_name as vendor_rep
    FROM purchase_orders po
    LEFT JOIN vendors v ON v.id = po.vendor_id
    WHERE po.proposal_id = ?
    ORDER BY po.created_at DESC
  `).all(req.params.id);
  res.json(pos);
});


router.post('/api/proposals/:id/purchase-orders', (req, res) => {
  const db = getDb();
  const proposalId = parseInt(req.params.id);
  const { vendor_id, notes, items } = req.body;
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id required' });
  if (!items || !items.length) return res.status(400).json({ error: 'items required' });

  const totalCost = items.reduce((s, i) => s + (i.total_cost || 0), 0);
  const poCount = db.prepare('SELECT COUNT(*) as c FROM purchase_orders').get().c;
  const poNumber = `PO-${new Date().getFullYear()}-${String(poCount + 1).padStart(4, '0')}`;

  const po = db.prepare(`
    INSERT INTO purchase_orders (proposal_id, vendor_id, po_number, status, notes, total_cost)
    VALUES (?, ?, ?, 'draft', ?, ?)
  `).run(proposalId, vendor_id, poNumber, notes || null, totalCost);

  const poId = po.lastInsertRowid;
  for (const item of items) {
    db.prepare(`
      INSERT INTO purchase_order_items (po_id, item_type, item_name, quantity, unit, unit_cost, total_cost)
      VALUES (?, 'manual', ?, ?, ?, ?, ?)
    `).run(poId, item.name, item.qty || 0, item.unit || 'each', item.unit_cost || 0, item.total_cost || 0);
  }

  const created = db.prepare('SELECT po.*, v.name as vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.id = ?').get(poId);
  res.status(201).json(created);
});

router.post('/api/proposals/:id/purchase-orders/generate', (req, res) => {
  const db = getDb();
  const proposalId = req.params.id;

  // Get all products with vendors
  const products = db.prepare(`
    SELECT pp.*, v.name as vendor_name FROM proposal_products pp
    LEFT JOIN vendors v ON v.id = pp.vendor_id
    WHERE pp.proposal_id = ?
  `).all(proposalId);

  // Get all assemblies with vendors for these products
  const productIds = products.map(p => p.id);
  const assembliesByProduct = {};
  for (const p of products) {
    assembliesByProduct[p.id] = db.prepare(`
      SELECT pa.*, v.name as vendor_name FROM product_assemblies pa
      LEFT JOIN vendors v ON v.id = pa.vendor_id
      WHERE pa.product_id = ?
    `).all(p.id);
  }

  // Group items by vendor
  const vendorItems = {}; // vendorId -> { vendor, items[] }

  for (const product of products) {
    if (product.vendor_id) {
      if (!vendorItems[product.vendor_id]) {
        vendorItems[product.vendor_id] = { vendor_id: product.vendor_id, vendor_name: product.vendor_name, items: [] };
      }
      vendorItems[product.vendor_id].items.push({
        item_type: 'product',
        item_name: product.product_name,
        description: product.description || '',
        quantity: product.quantity || 0,
        unit: product.quantity_unit || 'SF',
        unit_cost: product.material_cost || 0,
        total_cost: round2((product.quantity || 0) * (product.material_cost || 0)),
      });
    }

    // Process assemblies
    const asms = assembliesByProduct[product.id] || [];
    for (const asm of asms) {
      if (!asm.vendor_id) continue;
      if (!vendorItems[asm.vendor_id]) {
        vendorItems[asm.vendor_id] = { vendor_id: asm.vendor_id, vendor_name: asm.vendor_name, items: [] };
      }
      const qty = asm.spread_rate && asm.spread_rate > 0
        ? Math.ceil((product.quantity || 0) / asm.spread_rate)
        : (asm.units_needed || 0);
      vendorItems[asm.vendor_id].items.push({
        item_type: 'assembly',
        item_name: asm.name,
        description: asm.description || `For: ${product.product_name}`,
        quantity: qty,
        unit: asm.unit || 'each',
        unit_cost: asm.material_cost || 0,
        total_cost: round2(qty * (asm.material_cost || 0)),
      });
    }
  }

  if (Object.keys(vendorItems).length === 0) {
    return res.status(400).json({ error: 'No vendor-assigned products or assemblies found in this proposal' });
  }

  // Generate PO number sequence
  const year = new Date().getFullYear();
  const countRow = db.prepare(`SELECT COUNT(*) as c FROM purchase_orders WHERE po_number LIKE ?`).get(`PO-${year}-%`);
  let seqStart = (countRow.c || 0) + 1;

  const createdPOs = [];

  const createPO = db.transaction(() => {
    for (const [vendorId, data] of Object.entries(vendorItems)) {
      const seq = String(seqStart++).padStart(4, '0');
      const po_number = `PO-${year}-${seq}`;
      const totalCost = data.items.reduce((s, i) => s + i.total_cost, 0);

      const poResult = db.prepare(`
        INSERT INTO purchase_orders (proposal_id, vendor_id, po_number, status, total_cost)
        VALUES (?, ?, ?, 'draft', ?)
      `).run(proposalId, vendorId, po_number, round2(totalCost));

      const poId = poResult.lastInsertRowid;
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (po_id, item_type, item_name, description, quantity, unit, unit_cost, total_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of data.items) {
        insertItem.run(poId, item.item_type, item.item_name, item.description, item.quantity, item.unit, item.unit_cost, item.total_cost);
      }

      const po = db.prepare(`
        SELECT po.*, v.name as vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.id = ?
      `).get(poId);
      createdPOs.push(po);
    }
  });

  createPO();
  res.json(createdPOs);
});

router.get('/api/purchase-orders/:id', (req, res) => {
  const db = getDb();
  const po = db.prepare(`
    SELECT po.*, v.name as vendor_name, v.rep_name as vendor_rep, v.phone as vendor_phone, v.email as vendor_email,
      p.name as proposal_name
    FROM purchase_orders po
    LEFT JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN proposals p ON p.id = po.proposal_id
    WHERE po.id = ?
  `).get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY id').all(po.id);
  res.json({ ...po, items });
});

router.put('/api/purchase-orders/:id', (req, res) => {
  const db = getDb();
  const { status, notes } = req.body;
  db.prepare(`UPDATE purchase_orders SET status=?, notes=? WHERE id=?`).run(status || 'draft', notes || null, req.params.id);
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.delete('/api/purchase-orders/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/api/purchase-orders/:id/send', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE purchase_orders SET status='sent', sent_at=datetime('now') WHERE id=?`).run(req.params.id);
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.put('/api/purchase-orders/:id/confirm', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE purchase_orders SET status='confirmed', confirmed_at=datetime('now') WHERE id=?`).run(req.params.id);
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

router.put('/api/purchase-orders/:id/receive', (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE purchase_orders SET status='received', received_at=datetime('now') WHERE id=?`).run(req.params.id);
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

// ── PDF generation ──────────────────────────────────────────
router.post('/api/generate-pdf', async (req, res) => {
  try {
    const puppeteer = require('puppeteer');
    const { html, filename } = req.body;
    if (!html) return res.status(400).json({ error: 'html required' });

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfData = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      displayHeaderFooter: false
    });
    await browser.close();

    const pdf = Buffer.from(pdfData);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename || 'proposal'}.pdf"`,
      'Content-Length': pdf.length
    });
    res.end(pdf);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
