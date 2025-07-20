import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR         = path.join(__dirname, 'data');
const BATCHES_PATH     = path.join(DATA_DIR, 'batches.json');

// raw CSV copy lives alongside JSON so you can peek at it if needed
const MASTER_CSV_PATH  = path.join(DATA_DIR, 'item_list.csv');
// JSON is served from /public/data so the browser can fetch it directly
const MASTER_JSON_PATH = path.join(__dirname, 'public', 'data', 'master_items.json');

// Remote CSV – default to Item‑List‑Handler endpoint
const MASTER_SOURCE_URL =
  process.env.MASTER_SOURCE_URL ||
  process.env.ITEM_CSV_URL      ||
  'https://item-list-handler.onrender.com/item_list.csv';

 // keep UPC → item in RAM so look‑ups are fast everywhere
let masterItemsMap = new Map();
let refreshTimer    = null;     // hourly cron handle

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BATCHES_PATH)) fs.writeFileSync(BATCHES_PATH, '[]', 'utf8');

// --- helpers ------------------------------------------------------
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

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

// --- middleware ---------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

//  ➜ JSON for the browser
app.get('/data/master_items.json', (_req,res) => {
  if(!fs.existsSync(MASTER_JSON_PATH))
    return res.status(404).json({error:'master_items.json missing'});
  res.setHeader('Cache-Control','no-store');
  res.sendFile(MASTER_JSON_PATH);
});

//  ➜ single‑item look‑up (used by batch validator if you want)
app.get('/api/item/:upc', (req,res)=>{
  const code = normalizeUPC(req.params.upc||'');
  res.json(masterItemsMap.get(code) || {});
});

//  ➜ manual refresh (called by Item‑List‑Handler or a button)
app.post('/api/refresh-master-items', async (_req,res)=>{
  await refreshMasterItems('manual');
  res.json({size: masterItemsMap.size, at: new Date().toISOString()});
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

//--------------------------------------------------------------------
// CSV ➜ JSON helpers  (same logic the Inventory‑Counts app uses)
//--------------------------------------------------------------------
const pick = (row, aliases) => {
  for (const k of Object.keys(row)) {
    const low = k.toLowerCase().trim();
    if (aliases.includes(low)) return row[k];
  }
  return '';
};
const normalizeUPC = s => {
  let d = String(s||'').replace(/\D/g,'');
  if (!d) return '';
  if (d.length === 12) d = d.slice(0,11);   // drop UPC‑A check digit
  return d.padStart(13,'0');
};
function parseMasterCsv(csvText){
  const rows = parse(csvText,{columns:true,skip_empty_lines:true});
  const map  = new Map();
  rows.forEach(r=>{
    const upc = normalizeUPC(pick(r,['main code','code','item code','upc']));
    if(!upc) return;
    map.set(upc,{
      upc,
      brand      : pick(r,['main item-brand','brand']),
      description: pick(r,['main item-description','description']),
      reg_price  : parseFloat(pick(r,['price-regular-price','price','regular price'])) || 0
    });
  });
  return map;
}

// keep map in memory so look‑ups are fast
let masterItemsMap = new Map();
let refreshTimer   = null;

async function refreshMasterItems(source='auto'){
  if(!MASTER_SOURCE_URL) return;
  const tag = source==='manual' ? 'Manual-refresh' : 'Auto-refresh';
  try{
    const res = await fetch(MASTER_SOURCE_URL,{timeout:15000});
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const csv = await res.text();
    fs.mkdirSync(DATA_DIR,{recursive:true});
    fs.writeFileSync(MASTER_CSV_PATH, csv);

    masterItemsMap = parseMasterCsv(csv);

    fs.mkdirSync(path.dirname(MASTER_JSON_PATH),{recursive:true});
    fs.writeFileSync(
      MASTER_JSON_PATH,
      JSON.stringify([...masterItemsMap.values()],null,2)
    );
    console.log(`[${tag}] downloaded ${masterItemsMap.size.toLocaleString()} items`);
  }catch(err){
    console.warn(`[${tag}] failed – keeping existing list:`, err.message);
  }
}

/* ---------- initial load ---------- */
try{
  if(fs.existsSync(MASTER_JSON_PATH)){
    masterItemsMap = new Map(
      JSON.parse(fs.readFileSync(MASTER_JSON_PATH,'utf8')).map(o=>[o.upc,o])
    );
    console.log(`[Startup] loaded ${masterItemsMap.size} items from disk`);
  }else{
    await refreshMasterItems('manual');
  }
}catch(e){ console.warn('[Startup] master load failed:', e.message); }

/* ---------- hourly cron ---------- */
if(!refreshTimer){
  refreshTimer = setInterval(()=>refreshMasterItems('auto'), 60*60*1000);
}

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
