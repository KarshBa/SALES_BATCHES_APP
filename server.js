import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';          // if not already imported here

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR        = path.join(__dirname, 'data');
const BATCHES_PATH    = path.join(DATA_DIR, 'batches.json');
const MASTER_JSON_PATH = path.join(DATA_DIR, 'master_items.json');

/* Remote CSV (same as Inventory Counts pattern) */
// Set this in Render: MASTER_SOURCE_URL="https://item-list-handler.onrender.com/item_list.csv"
// (fallback to legacy ITEM_CSV_URL if you already set that)
const MASTER_SOURCE_URL = process.env.MASTER_SOURCE_URL || process.env.ITEM_CSV_URL;

let masterItemsMap = new Map();   // in‑memory UPC → item
let masterRefreshTimer = null;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BATCHES_PATH)) fs.writeFileSync(BATCHES_PATH, '[]', 'utf8');

// --- helpers ------------------------------------------------------
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

/*** Convert raw CSV text from master server into array of objects: * [{ upc, brand, description, reg_price }, ...] */
function parseMasterCsvToJson(csvText){
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  const out = [];
  const map = new Map();
  const norm = s => String(s||'').trim();

  // Attempt header aliases
  // (Adjust if your actual headers differ – reuse what Inventory Counts used.)
  const aliases = {
    upc:        ['main code','code','upc','item code'],
    brand:      ['main item-brand','brand'],
    description:['main item-description','description','item description'],
    reg_price:  ['price-regular-price','reg price','regular price','price']
  };
  const pick = (row, keys) => {
    for(const k of Object.keys(row)){
      const lk = k.toLowerCase().trim();
      if(keys.includes(lk)) return row[k];
    }
    return '';
  };

  rows.forEach(r=>{
    const upcRaw = norm(pick(r, aliases.upc));
    if(!upcRaw) return;
    const upcDigits = upcRaw.replace(/\D/g,'');
    if(!upcDigits) return;
    const item = {
      upc: upcDigits,
      brand: norm(pick(r, aliases.brand)),
      description: norm(pick(r, aliases.description)),
      reg_price: parseFloat(pick(r, aliases.reg_price)) || 0
    };
    out.push(item);
    map.set(upcDigits, item);
  });
  masterItemsMap = map;
  return out;
}

/*** Refresh master list from remote CSV. * Writes JSON to disk atomically and updates in‑memory map. */
async function refreshMasterItems(source='auto'){
  if(!MASTER_SOURCE_URL){
    console.warn('[MasterItems] No MASTER_SOURCE_URL configured.');
    return;
  }
  const tag = source === 'manual' ? 'Manual-refresh' : 'Auto-refresh';
  try{
    const res = await fetch(MASTER_SOURCE_URL, { timeout: 20_000 });
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const csvText = await res.text();
    const json = parseMasterCsvToJson(csvText);
    const tmp = MASTER_JSON_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(json,null,2));
    fs.renameSync(tmp, MASTER_JSON_PATH);
    console.log(`[MasterItems][${tag}] ${json.length.toLocaleString()} items @ ${new Date().toISOString()}`);
  }catch(err){
    console.warn(`[MasterItems][${tag}] failed: ${err.message}`);
  }
}

// Ensure data directory exists
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Initial load (try existing file, else fetch)
try{
  if(fs.existsSync(MASTER_JSON_PATH)){
    const existing = JSON.parse(fs.readFileSync(MASTER_JSON_PATH,'utf8'));
    masterItemsMap = new Map(existing.map(o=>[o.upc,o]));
    console.log(`[MasterItems][Startup] Loaded ${masterItemsMap.size} items from disk.`);
  } else {
    await refreshMasterItems('manual'); // first seed
  }
}catch(e){
  console.warn('[MasterItems][Startup] load failed:', e.message);
}

// Hourly auto-refresh
if(!masterRefreshTimer){
  masterRefreshTimer = setInterval(()=>refreshMasterItems('auto'), 60*60*1000);
}

// Serve current master items JSON (front-end fetches this)
app.get('/data/master_items.json', (req,res)=>{
  if(!fs.existsSync(MASTER_JSON_PATH)){
    return res.status(404).json({ error: 'master_items.json missing' });
  }
  res.setHeader('Cache-Control','no-store');
  res.sendFile(MASTER_JSON_PATH);
});

// Manual refresh endpoint (invoked by button in sales_batches.html)
app.post('/api/refresh-master-items', async (req,res)=>{
  await refreshMasterItems('manual');
  const count = masterItemsMap.size;
  res.json({ refreshed: count, at: new Date().toISOString() });
});

// --- middleware ---------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API: master (served static but add a HEAD/GET existence check) ----
app.get('/data/master_items.json', (_req,res)=>{
  if(!fs.existsSync(MASTER_ITEMS)) return res.status(500).json({error:'master list missing'});
  res.sendFile(MASTER_ITEMS);
});

// --- API: batches CRUD --------------------------------------------
app.get('/api/batches', (_req,res)=>{
  try { res.json(readJSON(BATCHES_PATH)); }
  catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/batches', (req,res)=>{
  try {
    const batches = readJSON(BATCHES_PATH);
    const b = req.body;
    if(!b || !b.id) return res.status(400).json({error:'Missing id'});
    batches.push(b);
    writeJSON(BATCHES_PATH, batches);
    res.status(201).json(b);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.put('/api/batches/:id', (req,res)=>{
  try{
    const batches = readJSON(BATCHES_PATH);
    const idx = batches.findIndex(b=>b.id===req.params.id);
    if(idx === -1) return res.status(404).json({error:'Not found'});
    batches[idx] = req.body;
    writeJSON(BATCHES_PATH, batches);
    res.json(batches[idx]);
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.delete('/api/batches/:id', (req,res)=>{
  try{
    const batches = readJSON(BATCHES_PATH);
    const filtered = batches.filter(b=>b.id!==req.params.id);
    if(filtered.length === batches.length) return res.status(404).json({error:'Not found'});
    writeJSON(BATCHES_PATH, filtered);
    res.json({success:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Root -> batches list
app.get('/', (_req,res) =>
  res.sendFile(path.join(__dirname,'public','batches.html'))
);
// Explicit edit page already served by static (sales_batches.html)
// Optional deep link safeguard:
app.get(['/sales_batches','/sales_batches.html'], (_req,res)=>
  res.sendFile(path.join(__dirname,'public','sales_batches.html'))
);

app.listen(PORT, ()=>console.log(`Price Change Batch Builder running on :${PORT}`));
