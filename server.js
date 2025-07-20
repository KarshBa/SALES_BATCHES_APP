/**
 * Express server for Price Change Batch Builder
 * Serves static SPA + optional REST persistence for batches.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR        = path.join(__dirname, 'data');
const BATCHES_PATH    = path.join(DATA_DIR, 'batches.json');
const MASTER_ITEMS    = path.join(DATA_DIR, 'master_items.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BATCHES_PATH)) fs.writeFileSync(BATCHES_PATH, '[]', 'utf8');

// --- helpers ------------------------------------------------------
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

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

// SPA fallback (optional if you deep link)
app.get('*', (req,res,next)=>{
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname,'public','sales_batches.html'));
});

app.listen(PORT, ()=>console.log(`Price Change Batch Builder running on :${PORT}`));
