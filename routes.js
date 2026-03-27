const express = require('express');
const router = express.Router();
const { db, getDefaultWoTerms } = require('./db');

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

router.get('/api/vendors', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM vendors ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/vendors', async (req, res) => {
  try {
    const { name, rep_name, phone, email, lead_time_days, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await db.run(
      `INSERT INTO vendors (name, rep_name, phone, email, lead_time_days, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, rep_name || null, phone || null, email || null, lead_time_days || 0, notes || null]
    );
    const row = await db.get('SELECT * FROM vendors WHERE id = ?', [result.lastInsertRowid]);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/vendors/:id', async (req, res) => {
  try {
    const { name, rep_name, phone, email, lead_time_days, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    await db.run(
      `UPDATE vendors SET name=?, rep_name=?, phone=?, email=?, lead_time_days=?, notes=? WHERE id=?`,
      [name, rep_name || null, phone || null, email || null, lead_time_days || 0, notes || null, req.params.id]
    );
    res.json(await db.get('SELECT * FROM vendors WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/vendors/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM vendors WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Product Catalog ─────────────────────────────────────────────────────────

router.get('/api/product-catalog', async (req, res) => {
  try {
    const items = await db.all(`
      SELECT pc.*, v.name as vendor_name
      FROM product_catalog pc
      LEFT JOIN vendors v ON v.id = pc.vendor_id
      ORDER BY pc.category, pc.name
    `);
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/product-catalog', async (req, res) => {
  try {
    const { name, description, category, unit, vendor_id, default_material_cost,
      default_material_markup, default_tax_rate, default_vendor_fee, default_labor_cost, default_labor_markup } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await db.run(
      `INSERT INTO product_catalog
        (name, description, category, unit, vendor_id, default_material_cost, default_material_markup,
         default_tax_rate, default_vendor_fee, default_labor_cost, default_labor_markup)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description || null, category || null, unit || 'SF', vendor_id || null,
        default_material_cost || 0, default_material_markup || 30, default_tax_rate || 7,
        default_vendor_fee || 0, default_labor_cost || 0, default_labor_markup || 20]
    );
    const item = await db.get(
      `SELECT pc.*, v.name as vendor_name FROM product_catalog pc LEFT JOIN vendors v ON v.id = pc.vendor_id WHERE pc.id = ?`,
      [result.lastInsertRowid]
    );
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/product-catalog/:id', async (req, res) => {
  try {
    const { name, description, category, unit, vendor_id, default_material_cost,
      default_material_markup, default_tax_rate, default_vendor_fee, default_labor_cost, default_labor_markup } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    await db.run(
      `UPDATE product_catalog SET name=?, description=?, category=?, unit=?, vendor_id=?,
        default_material_cost=?, default_material_markup=?, default_tax_rate=?, default_vendor_fee=?,
        default_labor_cost=?, default_labor_markup=?
       WHERE id=?`,
      [name, description || null, category || null, unit || 'SF', vendor_id || null,
        default_material_cost || 0, default_material_markup || 30, default_tax_rate || 7,
        default_vendor_fee || 0, default_labor_cost || 0, default_labor_markup || 20, req.params.id]
    );
    const item = await db.get(
      `SELECT pc.*, v.name as vendor_name FROM product_catalog pc LEFT JOIN vendors v ON v.id = pc.vendor_id WHERE pc.id = ?`,
      [req.params.id]
    );
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/product-catalog/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM product_catalog WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Catalog (Assembly Catalog) ───────────────────────────────────────────────

router.get('/api/catalog', async (req, res) => {
  try {
    const items = await db.all(`
      SELECT ac.*, v.name as vendor_name FROM assembly_catalog ac
      LEFT JOIN vendors v ON v.id = ac.vendor_id
      ORDER BY ac.name
    `);
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/catalog', async (req, res) => {
  try {
    const { name, description, unit, spread_rate, material_cost, labor_cost, has_labor, vendor_id } = req.body;
    if (!name || !unit) return res.status(400).json({ error: 'name and unit required' });
    const result = await db.run(
      `INSERT INTO assembly_catalog (name, description, unit, spread_rate, material_cost, labor_cost, has_labor, vendor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description || null, unit, spread_rate || null, material_cost || 0, labor_cost || 0, has_labor ? 1 : 0, vendor_id || null]
    );
    res.json(await db.get('SELECT * FROM assembly_catalog WHERE id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/catalog/:id', async (req, res) => {
  try {
    const { name, description, unit, spread_rate, material_cost, labor_cost, has_labor, vendor_id } = req.body;
    await db.run(
      `UPDATE assembly_catalog SET name=?, description=?, unit=?, spread_rate=?, material_cost=?, labor_cost=?, has_labor=?, vendor_id=? WHERE id=?`,
      [name, description || null, unit, spread_rate || null, material_cost || 0, labor_cost || 0, has_labor ? 1 : 0, vendor_id || null, req.params.id]
    );
    res.json(await db.get('SELECT * FROM assembly_catalog WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/catalog/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM assembly_catalog WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Trade Partners ───────────────────────────────────────────────────────────

router.get('/api/trade-partners', async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM trade_partners ORDER BY name'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/trade-partners', async (req, res) => {
  try {
    const { name, contact_name, phone, email, trade } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await db.run(
      `INSERT INTO trade_partners (name, contact_name, phone, email, trade) VALUES (?, ?, ?, ?, ?)`,
      [name, contact_name || null, phone || null, email || null, trade || null]
    );
    res.json(await db.get('SELECT * FROM trade_partners WHERE id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/trade-partners/:id', async (req, res) => {
  try {
    const { name, contact_name, phone, email, trade } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    await db.run(
      `UPDATE trade_partners SET name=?, contact_name=?, phone=?, email=?, trade=? WHERE id=?`,
      [name, contact_name || null, phone || null, email || null, trade || null, req.params.id]
    );
    res.json(await db.get('SELECT * FROM trade_partners WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/trade-partners/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM trade_partners WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Proposals ───────────────────────────────────────────────────────────────

router.get('/api/proposals', async (req, res) => {
  try {
    const proposals = await db.all('SELECT * FROM proposals ORDER BY created_at DESC');
    res.json(proposals);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/proposals', async (req, res) => {
  try {
    const { name, client_name, project_address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await db.run(
      `INSERT INTO proposals (name, client_name, project_address, notes) VALUES (?, ?, ?, ?)`,
      [name, client_name || null, project_address || null, notes || null]
    );
    res.json(await db.get('SELECT * FROM proposals WHERE id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/proposals/:id', async (req, res) => {
  try {
    const proposal = await db.get('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    if (!proposal) return res.status(404).json({ error: 'Not found' });

    const products = await db.all(
      'SELECT pp.*, v.name as vendor_name FROM proposal_products pp LEFT JOIN vendors v ON v.id = pp.vendor_id WHERE pp.proposal_id = ? ORDER BY pp.sort_order, pp.id',
      [proposal.id]
    );

    let grandSell = 0, grandCost = 0;

    const enrichedProducts = await Promise.all(products.map(async p => {
      const assemblies = await db.all(
        'SELECT pa.*, v.name as vendor_name FROM product_assemblies pa LEFT JOIN vendors v ON v.id = pa.vendor_id WHERE pa.product_id = ? ORDER BY pa.id',
        [p.id]
      );
      const totals = computeProductTotals(p, assemblies);
      grandSell += totals.total_sell;
      grandCost += totals.total_cost;
      return { ...p, ...totals };
    }));

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/proposals/:id', async (req, res) => {
  try {
    const { name, client_name, project_address, status, notes } = req.body;
    await db.run(
      `UPDATE proposals SET name=?, client_name=?, project_address=?, status=?, notes=?, updated_at=NOW() WHERE id=?`,
      [name, client_name || null, project_address || null, status || 'draft', notes || null, req.params.id]
    );
    res.json(await db.get('SELECT * FROM proposals WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/proposals/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM proposals WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Products ────────────────────────────────────────────────────────────────

router.post('/api/proposals/:id/products', async (req, res) => {
  try {
    const { product_name, description, color, size, quantity, quantity_unit,
      material_cost, material_markup, tax_rate, vendor_fee, labor_cost, labor_markup, sort_order, vendor_id } = req.body;
    if (!product_name) return res.status(400).json({ error: 'product_name required' });
    const result = await db.run(
      `INSERT INTO proposal_products
        (proposal_id, product_name, scope_type, description, color, size, quantity, quantity_unit,
         material_cost, material_markup, tax_rate, vendor_fee, labor_cost, labor_markup, sort_order, vendor_id, waste_pct, package_qty, lead_time_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, product_name, req.body.scope_type || null, description || null, color || null, size || null,
        quantity || 0, quantity_unit || 'SF',
        material_cost || 0, material_markup || 0, tax_rate || 0, vendor_fee || 0,
        labor_cost || 0, labor_markup || 0, sort_order || 0, vendor_id || null,
        req.body.waste_pct || 0, req.body.package_qty || 0, req.body.lead_time_days || 0]
    );
    res.json(await db.get('SELECT * FROM proposal_products WHERE id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/products/:id', async (req, res) => {
  try {
    const { product_name, description, color, size, quantity, quantity_unit,
      material_cost, material_markup, tax_rate, vendor_fee, labor_cost, labor_markup, sort_order, vendor_id } = req.body;
    await db.run(
      `UPDATE proposal_products SET
        product_name=?, scope_type=?, description=?, color=?, size=?, quantity=?, quantity_unit=?,
        material_cost=?, material_markup=?, tax_rate=?, vendor_fee=?, labor_cost=?, labor_markup=?, sort_order=?, vendor_id=?, waste_pct=?, package_qty=?, lead_time_days=?
       WHERE id=?`,
      [product_name, req.body.scope_type || null, description || null, color || null, size || null,
        quantity || 0, quantity_unit || 'SF',
        material_cost || 0, material_markup || 0, tax_rate || 0, vendor_fee || 0,
        labor_cost || 0, labor_markup || 0, sort_order || 0, vendor_id || null,
        req.body.waste_pct || 0, req.body.package_qty || 0, req.body.lead_time_days || 0, req.params.id]
    );
    const product = await db.get('SELECT proposal_id FROM proposal_products WHERE id = ?', [req.params.id]);
    if (product) await db.run(`UPDATE proposals SET updated_at=NOW() WHERE id=?`, [product.proposal_id]);
    res.json(await db.get('SELECT * FROM proposal_products WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/products/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM proposal_products WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Assemblies ──────────────────────────────────────────────────────────────

router.post('/api/products/:id/assemblies', async (req, res) => {
  try {
    let { catalog_id, name, unit, spread_rate, units_needed, material_cost, material_markup, labor_cost, labor_markup, has_labor, vendor_id } = req.body;

    if (catalog_id) {
      const cat = await db.get('SELECT * FROM assembly_catalog WHERE id = ?', [catalog_id]);
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

    const product = await db.get('SELECT quantity FROM proposal_products WHERE id = ?', [req.params.id]);
    const qty = product ? (product.quantity || 0) : 0;
    if (spread_rate && spread_rate > 0) {
      units_needed = Math.ceil(qty / spread_rate);
    }

    const result = await db.run(
      `INSERT INTO product_assemblies
        (product_id, catalog_id, name, unit, spread_rate, units_needed, material_cost, material_markup, labor_cost, labor_markup, has_labor, vendor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, catalog_id || null, name, unit || 'each',
        spread_rate || null, units_needed || 0,
        material_cost || 0, material_markup || 0, labor_cost || 0, labor_markup || 0, has_labor ? 1 : 0,
        vendor_id || null]
    );
    res.json(await db.get('SELECT * FROM product_assemblies WHERE id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/assemblies/:id', async (req, res) => {
  try {
    let { name, unit, spread_rate, units_needed, material_cost, material_markup, labor_cost, labor_markup, has_labor, vendor_id } = req.body;

    const asm = await db.get('SELECT product_id FROM product_assemblies WHERE id = ?', [req.params.id]);
    if (asm) {
      const product = await db.get('SELECT quantity FROM proposal_products WHERE id = ?', [asm.product_id]);
      const qty = product ? (product.quantity || 0) : 0;
      if (spread_rate && spread_rate > 0) {
        units_needed = Math.ceil(qty / spread_rate);
      }
    }

    await db.run(
      `UPDATE product_assemblies SET
        name=?, unit=?, spread_rate=?, units_needed=?, material_cost=?, material_markup=?,
        labor_cost=?, labor_markup=?, has_labor=?, vendor_id=?
       WHERE id=?`,
      [name, unit || 'each', spread_rate || null, units_needed || 0,
        material_cost || 0, material_markup || 0, labor_cost || 0, labor_markup || 0,
        has_labor ? 1 : 0, vendor_id || null, req.params.id]
    );
    res.json(await db.get('SELECT * FROM product_assemblies WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/assemblies/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM product_assemblies WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Work Orders ─────────────────────────────────────────────────────────────

router.get('/api/proposals/:id/work-orders', async (req, res) => {
  try {
    const wos = await db.all(`
      SELECT wo.*, tp.name as trade_partner_name, tp.contact_name as trade_partner_contact,
        (SELECT COALESCE(SUM(total_labor), 0) FROM work_order_items WHERE work_order_id = wo.id) as total_labor
      FROM work_orders wo
      LEFT JOIN trade_partners tp ON tp.id = wo.trade_partner_id
      WHERE wo.proposal_id = ?
      ORDER BY wo.created_at DESC
    `, [req.params.id]);
    res.json(wos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/proposals/:id/work-orders', async (req, res) => {
  try {
    const { trade_partner_id, notes } = req.body;

    const year = new Date().getFullYear();
    const countRow = await db.get(`SELECT COUNT(*) as c FROM work_orders WHERE wo_number LIKE ?`, [`WO-${year}-%`]);
    const seq = String((parseInt(countRow.c, 10) || 0) + 1).padStart(4, '0');
    const wo_number = `WO-${year}-${seq}`;

    const result = await db.run(
      `INSERT INTO work_orders (proposal_id, trade_partner_id, wo_number, status, notes, terms) VALUES (?, ?, ?, 'draft', ?, ?)`,
      [req.params.id, trade_partner_id || null, wo_number, notes || null, getDefaultWoTerms()]
    );
    res.json(await db.get('SELECT * FROM work_orders WHERE id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/work-orders/:id', async (req, res) => {
  try {
    const wo = await db.get(`
      SELECT wo.*, tp.name as trade_partner_name, tp.contact_name as trade_partner_contact,
        tp.phone as trade_partner_phone, tp.email as trade_partner_email,
        p.name as proposal_name
      FROM work_orders wo
      LEFT JOIN trade_partners tp ON tp.id = wo.trade_partner_id
      LEFT JOIN proposals p ON p.id = wo.proposal_id
      WHERE wo.id = ?
    `, [req.params.id]);
    if (!wo) return res.status(404).json({ error: 'Not found' });

    const items = await db.all('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY id', [wo.id]);
    const totalLabor = items.reduce((sum, i) => sum + (i.total_labor || 0), 0);
    res.json({ ...wo, items, total_labor: round2(totalLabor) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/work-orders/:id', async (req, res) => {
  try {
    const { status, trade_partner_id, notes, terms } = req.body;
    await db.run(
      `UPDATE work_orders SET status=?, trade_partner_id=?, notes=?, terms=? WHERE id=?`,
      [status || 'draft', trade_partner_id || null, notes || null, terms || null, req.params.id]
    );
    res.json(await db.get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/work-orders/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM work_orders WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/work-orders/:id/execute', async (req, res) => {
  try {
    await db.run(`UPDATE work_orders SET status='executed', executed_at=NOW() WHERE id=?`, [req.params.id]);
    res.json(await db.get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/work-orders/:id/commit', async (req, res) => {
  try {
    await db.run(`UPDATE work_orders SET status='committed' WHERE id=?`, [req.params.id]);
    res.json(await db.get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Work Order Items ─────────────────────────────────────────────────────────

router.post('/api/work-orders/:id/items', async (req, res) => {
  try {
    const { product_name, description, quantity, quantity_unit, unit_labor_rate } = req.body;
    if (!product_name) return res.status(400).json({ error: 'product_name required' });
    const qty = parseFloat(quantity) || 0;
    const rate = parseFloat(unit_labor_rate) || 0;
    const total = round2(qty * rate);
    const result = await db.run(
      `INSERT INTO work_order_items (work_order_id, product_name, description, quantity, quantity_unit, unit_labor_rate, total_labor) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, product_name, description || null, qty, quantity_unit || 'SF', rate, total]
    );
    res.json(await db.get('SELECT * FROM work_order_items WHERE id = ?', [result.lastInsertRowid]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/work-order-items/:id', async (req, res) => {
  try {
    const { product_name, description, quantity, quantity_unit, unit_labor_rate } = req.body;
    const qty = parseFloat(quantity) || 0;
    const rate = parseFloat(unit_labor_rate) || 0;
    const total = round2(qty * rate);
    await db.run(
      `UPDATE work_order_items SET product_name=?, description=?, quantity=?, quantity_unit=?, unit_labor_rate=?, total_labor=? WHERE id=?`,
      [product_name, description || null, qty, quantity_unit || 'SF', rate, total, req.params.id]
    );
    res.json(await db.get('SELECT * FROM work_order_items WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/work-order-items/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM work_order_items WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────

router.get('/api/proposals/:id/purchase-orders', async (req, res) => {
  try {
    const pos = await db.all(`
      SELECT po.*, v.name as vendor_name, v.rep_name as vendor_rep
      FROM purchase_orders po
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.proposal_id = ?
      ORDER BY po.created_at DESC
    `, [req.params.id]);
    res.json(pos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/proposals/:id/purchase-orders', async (req, res) => {
  try {
    const proposalId = parseInt(req.params.id);
    const { vendor_id, notes, items } = req.body;
    if (!vendor_id) return res.status(400).json({ error: 'vendor_id required' });
    if (!items || !items.length) return res.status(400).json({ error: 'items required' });

    const totalCost = items.reduce((s, i) => s + (i.total_cost || 0), 0);
    const countRow = await db.get('SELECT COUNT(*) as c FROM purchase_orders');
    const poNumber = `PO-${new Date().getFullYear()}-${String(parseInt(countRow.c, 10) + 1).padStart(4, '0')}`;

    const po = await db.run(
      `INSERT INTO purchase_orders (proposal_id, vendor_id, po_number, status, notes, total_cost) VALUES (?, ?, ?, 'draft', ?, ?)`,
      [proposalId, vendor_id, poNumber, notes || null, totalCost]
    );

    const poId = po.lastInsertRowid;
    for (const item of items) {
      await db.run(
        `INSERT INTO purchase_order_items (po_id, item_type, item_name, quantity, unit, unit_cost, total_cost) VALUES (?, 'manual', ?, ?, ?, ?, ?)`,
        [poId, item.name, item.qty || 0, item.unit || 'each', item.unit_cost || 0, item.total_cost || 0]
      );
    }

    const created = await db.get(
      'SELECT po.*, v.name as vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.id = ?',
      [poId]
    );
    res.status(201).json(created);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/proposals/:id/purchase-orders/generate', async (req, res) => {
  try {
    const proposalId = req.params.id;

    const products = await db.all(`
      SELECT pp.*, v.name as vendor_name FROM proposal_products pp
      LEFT JOIN vendors v ON v.id = pp.vendor_id
      WHERE pp.proposal_id = ?
    `, [proposalId]);

    const assembliesByProduct = {};
    for (const p of products) {
      assembliesByProduct[p.id] = await db.all(`
        SELECT pa.*, v.name as vendor_name FROM product_assemblies pa
        LEFT JOIN vendors v ON v.id = pa.vendor_id
        WHERE pa.product_id = ?
      `, [p.id]);
    }

    const vendorItems = {};

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

    const year = new Date().getFullYear();
    const countRow = await db.get(`SELECT COUNT(*) as c FROM purchase_orders WHERE po_number LIKE ?`, [`PO-${year}-%`]);
    let seqStart = (parseInt(countRow.c, 10) || 0) + 1;

    const createdPOs = [];

    for (const [vendorId, data] of Object.entries(vendorItems)) {
      const seq = String(seqStart++).padStart(4, '0');
      const po_number = `PO-${year}-${seq}`;
      const totalCost = data.items.reduce((s, i) => s + i.total_cost, 0);

      const poResult = await db.run(
        `INSERT INTO purchase_orders (proposal_id, vendor_id, po_number, status, total_cost) VALUES (?, ?, ?, 'draft', ?)`,
        [proposalId, vendorId, po_number, round2(totalCost)]
      );

      const poId = poResult.lastInsertRowid;
      for (const item of data.items) {
        await db.run(
          `INSERT INTO purchase_order_items (po_id, item_type, item_name, description, quantity, unit, unit_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [poId, item.item_type, item.item_name, item.description, item.quantity, item.unit, item.unit_cost, item.total_cost]
        );
      }

      const po = await db.get(
        `SELECT po.*, v.name as vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.id = ?`,
        [poId]
      );
      createdPOs.push(po);
    }

    res.json(createdPOs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/purchase-orders/:id', async (req, res) => {
  try {
    const po = await db.get(`
      SELECT po.*, v.name as vendor_name, v.rep_name as vendor_rep, v.phone as vendor_phone, v.email as vendor_email,
        p.name as proposal_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON v.id = po.vendor_id
      LEFT JOIN proposals p ON p.id = po.proposal_id
      WHERE po.id = ?
    `, [req.params.id]);
    if (!po) return res.status(404).json({ error: 'Not found' });
    const items = await db.all('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY id', [po.id]);
    res.json({ ...po, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/purchase-orders/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    await db.run(`UPDATE purchase_orders SET status=?, notes=? WHERE id=?`, [status || 'draft', notes || null, req.params.id]);
    res.json(await db.get('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/purchase-orders/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM purchase_orders WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/purchase-orders/:id/send', async (req, res) => {
  try {
    await db.run(`UPDATE purchase_orders SET status='sent', sent_at=NOW() WHERE id=?`, [req.params.id]);
    res.json(await db.get('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/purchase-orders/:id/confirm', async (req, res) => {
  try {
    await db.run(`UPDATE purchase_orders SET status='confirmed', confirmed_at=NOW() WHERE id=?`, [req.params.id]);
    res.json(await db.get('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/api/purchase-orders/:id/receive', async (req, res) => {
  try {
    await db.run(`UPDATE purchase_orders SET status='received', received_at=NOW() WHERE id=?`, [req.params.id]);
    res.json(await db.get('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
