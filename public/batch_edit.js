/* batch_edit.js  – editor-only script */

import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9.0.1/+esm';

const LS_KEY = 'priceChangeBatches_v1';
const MASTER_URL = '/data/master_items.json';
const RECORD_TYPES = ['SALE','TPR','INSTORE','REG'];
const EXPORT_HEADERS = ['Record Type','UPC','Promo_Price','Promo_Qty','Start_Date','End_Date'];
const AUTO_SAVE_DEBOUNCE = 500;

const params = new URLSearchParams(location.search);
const initialBatchId = params.get('batch');

if(!initialBatchId){
  location.replace('batches.html');
}

let batches = [];
let currentBatchId = initialBatchId;
let masterItems = null;
let masterLoaded = false;
let saveTimer = null;

/* ---------- DOM ---------- */
const els = {
  currentBatchLabel : document.getElementById('currentBatchLabel'),
  btnExport         : document.getElementById('btnExport'),
  bulkUpcQuick      : document.getElementById('bulkUpcQuick'),
  btnAddLines       : document.getElementById('btnAddLines'),
  btnBulkUPC        : document.getElementById('btnBulkUPC'),
  lineFilter        : document.getElementById('lineFilter'),
  linesTbody        : document.getElementById('linesTbody'),
  statusSummary     : document.getElementById('statusSummary'),
  bulkRecordType    : document.getElementById('bulkRecordType'),
  bulkPromoPrice    : document.getElementById('bulkPromoPrice'),
  bulkPromoQty      : document.getElementById('bulkPromoQty'),
  bulkStartDate     : document.getElementById('bulkStartDate'),
  bulkEndDate       : document.getElementById('bulkEndDate'),
  bulkPercentOff    : document.getElementById('bulkPercentOff'),
  masterSearch      : document.getElementById('masterSearch'),
  masterSuggestions : document.getElementById('masterSuggestions')
};

/* ---------- quick Bulk‑UPC inline field ---------- */
if (els.btnBulkUPC && els.bulkUpcQuick){

  // ► Click on the blue “Bulk UPC Add” button
  els.btnBulkUPC.addEventListener('click', handleQuickUPC);

  // ► Pressing ⏎ Enter while the input is focused
  els.bulkUpcQuick.addEventListener('keydown', e => {
    if (e.key === 'Enter'){           // only on Enter
      e.preventDefault();             // don’t submit the form
      handleQuickUPC();
    }
  });
}

/* shared routine – moves codes from the quick box into the table */
function handleQuickUPC(){
  const raw = els.bulkUpcQuick.value.trim();
  if(!raw) return;

  const codes = raw.split(/[\s,]+/).filter(Boolean);
  els.bulkUpcQuick.value = '';        // clear the box after use

  const b = getCurrentBatch();
  codes.forEach(u=>{
    const line = firstEmptyLine(b) || blankLine();
    line.recordType = RECORD_TYPES.includes(els.bulkRecordType?.value)
                        ? els.bulkRecordType.value : 'SALE';
    line.upc = canonUPC(u);

    const itm = masterItems?.get(line.upc);
    if(itm){
      line.brand       = itm.brand;
      line.description = itm.description;
      line.regPrice    = itm.reg_price;
    }
    upsertLine(b, line);
  });

  scheduleSave(b);
  renderLines();
}

function upsertLine(batch, newLine){
  const i = batch.lines.findIndex(l => canonUPC(l.upc) === canonUPC(newLine.upc));
  if (i !== -1) batch.lines[i] = newLine;   // overwrite existing
  else           batch.lines.push(newLine); // otherwise append
 /* ▸ drop the initial empty row once we have at least one real line */
  if (batch.lines.length > 1 && !batch.lines[0].upc){
    batch.lines.shift();
  }
}

function addItemToBatch(code){
  const b    = getCurrentBatch();
  const line = firstEmptyLine(b) || blankLine();

  line.recordType = els.bulkRecordType.value || 'SALE';
  line.upc        = code;

  const itm = masterItems.get(code);
  if (itm){
    line.brand       = itm.brand;
    line.description = itm.description;
    line.regPrice    = itm.reg_price;
  }

  upsertLine(b, line);
  scheduleSave(b);
  renderLines();
}

function firstEmptyLine(batch){
  return batch.lines.find(l => !l.upc && !l.brand && !l.description);
}

const roundPromo = p => {
  // round to nearest $ X.09  ( e.g. 3.27 → 3.09 ,  3.78 → 3.69 )
  const base = Math.round((p - 0.09) * 100) / 100;
  return +(base.toFixed(2));
};

// Modals
const modalOverlay   = document.getElementById('modalOverlay');
const modalAddLines  = document.getElementById('modalAddLines');
const modalBulkUPC   = document.getElementById('modalBulkUPC');
const modalIssues    = document.getElementById('modalIssues');
const modalCsvPreview= document.getElementById('modalCsvPreview');
const issuesList     = document.getElementById('issuesList');
const csvPreview     = document.getElementById('csvPreview');

function toast(msg, type='info', ms=3500){
  const cont = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type==='error'?'error':type==='success'?'success':''}`;
  t.innerHTML = `<button aria-label="Close">&times;</button>${msg}`;
  t.querySelector('button').onclick = ()=>t.remove();
  cont.appendChild(t);
  setTimeout(()=>t.remove(), ms);
}

function openModal(m){ m.classList.remove('hidden'); modalOverlay.classList.remove('hidden'); }
function closeModal(m){ m.classList.add('hidden'); modalOverlay.classList.add('hidden'); }
document.querySelectorAll('.close-modal').forEach(btn=>{
  btn.addEventListener('click', ()=> closeModal(document.querySelector(btn.dataset.close)));
});

/* ---------- Storage ---------- */
function loadFromLocal(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if(raw) batches = JSON.parse(raw);
  } catch {}
}
function saveToLocal(){
  localStorage.setItem(LS_KEY, JSON.stringify(batches));
}

function getCurrentBatch(){
  return batches.find(b=>b.id === currentBatchId);
}

function blankLine(){
  return { recordType:'', upc:'', brand:'', description:'', regPrice:'', promoPrice:'', promoQty:'', startDate:'', endDate:'' };
}

function scheduleSave(b){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    b.updatedAt = new Date().toISOString();
    saveToLocal();
    updateStatus();
  }, AUTO_SAVE_DEBOUNCE);
}

/* ---------- Master List ---------- */
async function loadMaster(force=false){
  if(masterLoaded && !force) return;
  try{
    const url = MASTER_URL + (force ? `?_= ${Date.now()}` : '');
    const res = await fetch(url,{cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    masterItems = new Map();
    data.forEach(it=>{
      if(it.upc) masterItems.set(it.upc.trim(), it);
    });
    masterLoaded = true;
    toast(`Master items ${force? 'reloaded':'loaded'} (${masterItems.size})`,'success');
  }catch(err){
    toast('Master list failed to load','error',6000);
  }
}

/* ---------- Canonicalise UPC ---------- */
function canonUPC(raw){
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';                 // nothing
  if (d.length === 12) return ('0' + d.slice(0, 11)).padStart(13, '0');
  return d.padStart(13, '0');        // any other length → left‑pad
}

/* ---------- gather all validation issues for a batch ---------- */
function collectValidation(batch){
  const issues = [];
  batch.lines.forEach((ln, idx) => {
    issues.push(...validateLine({ ...ln }, idx));
  });
  return issues;
}

/* ---------- Validation ---------- */
function validateLine(line, index){
  const issues   = [];
  const rt       = line.recordType?.trim();
  const upc      = canonUPC(line.upc);

  /* Record type ---------------------------------------------------- */
  if (!RECORD_TYPES.includes(rt)) {
    issues.push(`Line ${index+1}: Record Type invalid/blank`);
  }

  /* UPC ------------------------------------------------------------ */
  if (!upc){
   issues.push(`Line ${index+1}: UPC missing`);
 } else if (masterItems && !masterItems.has(upc)){
   issues.push(`Line ${index+1}: UPC not in master list`);
 }

  /* Promo‐related fields ------------------------------------------ */
  const needsPromo = rt && rt !== 'REG';
  if (needsPromo) {
    if (line.promoPrice === '' || isNaN(+line.promoPrice) || +line.promoPrice <= 0) {
      issues.push(`Line ${index+1}: Promo_Price required`);
    }
    if (!line.startDate) issues.push(`Line ${index+1}: Start_Date required`);
    if (!line.endDate)   issues.push(`Line ${index+1}: End_Date required`);
  }

  /* Date order ----------------------------------------------------- */
  if (line.startDate && line.endDate && line.endDate < line.startDate){
    issues.push(`Line ${index+1}: End_Date < Start_Date`);
  }

  /* Normalise qty -------------------------------------------------- */
  let qty = parseInt(line.promoQty, 10);
  if (isNaN(qty) || qty < 1){
    qty = 1;
    line.promoQty = qty;
  }

  return issues;
}

/* ---------- Render ---------- */
function renderLines(){
  const batch = getCurrentBatch();
  if(!batch){ els.linesTbody.innerHTML=''; return; }
  const filter = els.lineFilter.value.trim().toLowerCase();
  els.linesTbody.innerHTML = '';
  batch.lines.forEach((ln, idx)=>{
    const rowIssues = validateLine({...ln}, idx);
    const hide = filter && !(
      ln.upc.toLowerCase().includes(filter) ||
      ln.brand.toLowerCase().includes(filter) ||
      ln.description.toLowerCase().includes(filter)
    );
    const tr = document.createElement('tr');
    if(hide) tr.classList.add('hidden-row');
    tr.dataset.index = idx;
    tr.innerHTML = `
      <td>
        <select class="cell-recordType">
          <option value=""></option>
          ${RECORD_TYPES.map(rt=>`<option ${rt===ln.recordType?'selected':''}>${rt}</option>`).join('')}
        </select>
      </td>
      <td><input class="cell-upc" value="${escapeAttr(ln.upc)}" inputmode="numeric" pattern="[0-9]*" /></td>
      <td class="ro brand">${escapeHtml(ln.brand)}</td>
      <td class="ro desc">${escapeHtml(ln.description)}</td>
      <td class="ro regPrice">${ln.regPrice!==''?Number(ln.regPrice).toFixed(2):''}</td>
      <td><input class="cell-promoPrice" type="number" step="0.01" min="0" value="${escapeAttr(ln.promoPrice)}" /></td>
      <td><input class="cell-promoQty" type="number" min="1" value="${escapeAttr(ln.promoQty)}" /></td>
      <td><input class="cell-startDate" type="date" value="${escapeAttr(ln.startDate)}" /></td>
      <td><input class="cell-endDate" type="date" value="${escapeAttr(ln.endDate)}" /></td>
      <td><button class="row-del" title="Delete row">🗑️</button></td>
    `;
    if(rowIssues.length){
      rowIssues.forEach(is=>{
        if(is.includes('Record Type')) tr.querySelector('.cell-recordType').classList.add('invalid-cell');
        if(is.includes('UPC'))         tr.querySelector('.cell-upc').classList.add('invalid-cell');
        if(is.includes('Promo_Price')) tr.querySelector('.cell-promoPrice').classList.add('invalid-cell');
        if(is.includes('Start_Date'))  tr.querySelector('.cell-startDate').classList.add('invalid-cell');
        if(is.includes('End_Date'))    tr.querySelector('.cell-endDate').classList.add('invalid-cell');
      });
    }
    els.linesTbody.appendChild(tr);
  });
  updateStatus();
}

function updateStatus(){
  const b = getCurrentBatch();
  if(!b){ els.statusSummary.textContent=''; return; }
  let invalid = 0;
  b.lines.forEach((l,i)=> { if(validateLine({...l},i).length) invalid++; });
  els.statusSummary.textContent = `Lines: ${b.lines.length} | Invalid: ${invalid} | Last Saved: ${b.updatedAt ? new Date(b.updatedAt).toLocaleTimeString(): '—'}`;
 /*➜ enable Export button whenever at least one line exists          */
  if (els.btnExport){
    els.btnExport.disabled = (b.lines.length === 0);
  }
}

/* ---------- Editing Events ---------- */
els.linesTbody.addEventListener('input', e=>{
  const tr = e.target.closest('tr');
  if(!tr) return;
  const idx = +tr.dataset.index;
  const b = getCurrentBatch();
  const line = b.lines[idx];
  if(e.target.classList.contains('cell-recordType')) line.recordType = e.target.value;
  else if(e.target.classList.contains('cell-upc')) {
    line.upc = e.target.value.replace(/\D/g,'');
    if(masterItems) {
      const fullUPC = canonUPC(line.upc);
      const item = masterItems.get(canonUPC(line.upc));
      if(item){
        line.brand = item.brand;
        line.description = item.description;
        line.regPrice = item.reg_price;
      } else {
        line.brand = line.description = '';
        line.regPrice = '';
      }
    }
  } 
  
  else if(e.target.classList.contains('cell-promoPrice')) line.promoPrice = e.target.value;
  else if(e.target.classList.contains('cell-promoQty')) line.promoQty = e.target.value;
  else if(e.target.classList.contains('cell-startDate')) line.startDate = e.target.value;
  else if(e.target.classList.contains('cell-endDate')) line.endDate = e.target.value;

  scheduleSave(b);

  const issues = validateLine({ ...line }, idx);
  // remove previous flags on that row
  tr.querySelectorAll('.invalid-cell').forEach(c => c.classList.remove('invalid-cell'));
  if (issues.length) {
    if (issues.some(t => t.includes('Record Type'))) tr.querySelector('.cell-recordType')?.classList.add('invalid-cell');
    if (issues.some(t => t.includes('UPC')))         tr.querySelector('.cell-upc')?.classList.add('invalid-cell');
    if (issues.some(t => t.includes('Promo_Price'))) tr.querySelector('.cell-promoPrice')?.classList.add('invalid-cell');
    if (issues.some(t => t.includes('Start_Date')))  tr.querySelector('.cell-startDate')?.classList.add('invalid-cell');
    if (issues.some(t => t.includes('End_Date')))    tr.querySelector('.cell-endDate')?.classList.add('invalid-cell');
  }
});

els.linesTbody.addEventListener('click', e=>{
  if(e.target.classList.contains('row-del')){
    const tr = e.target.closest('tr');
    const idx = +tr.dataset.index;
    if(confirm('Delete row?')){
      const b = getCurrentBatch();
      b.lines.splice(idx,1);
      scheduleSave(b);
      renderLines();
    }
  }
});

els.linesTbody.addEventListener('change', () => renderLines());

/* ---------- Auto Bulk Apply (no buttons) ---------- */
function autoDebounce(fn, wait=60){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); };
}

const applyRecordTypeAll = () => {
  const v = els.bulkRecordType.value;
  if(!v) return;
  const b = getCurrentBatch();
  b.lines.forEach(l => l.recordType = v);
  scheduleSave(b); renderLines();
};
els.bulkRecordType.addEventListener('change', applyRecordTypeAll);

const applyPromoPriceAll = autoDebounce(() => {
  const v = els.bulkPromoPrice.value;
  if(v === '') return;
  const b = getCurrentBatch();
  b.lines.forEach(l => l.promoPrice = v);
  scheduleSave(b); renderLines();
});
els.bulkPromoPrice.addEventListener('input', applyPromoPriceAll);

const applyPromoQtyAll = autoDebounce(() => {
  const v = els.bulkPromoQty.value;
  if(v === '') return;
  const b = getCurrentBatch();
  b.lines.forEach(l => l.promoQty = v);
  scheduleSave(b); renderLines();
});
els.bulkPromoQty.addEventListener('input', applyPromoQtyAll);

els.bulkStartDate.addEventListener('change', () => {
  const v = els.bulkStartDate.value;
  if(!v) return;
  const b = getCurrentBatch();
  b.lines.forEach(l => l.startDate = v);
  scheduleSave(b); renderLines();
});

els.bulkEndDate.addEventListener('change', () => {
  const v = els.bulkEndDate.value;
  if(!v) return;
  const b = getCurrentBatch();
  b.lines.forEach(l => l.endDate = v);
  scheduleSave(b); renderLines();
});

/* ---------- Bulk UPC Add ---------- */
if(els.btnBulkUPC){
  els.btnBulkUPC.addEventListener('click', () => {
    const ta = document.getElementById('bulkUpcInput');
    if(ta) ta.value = '';
    openModal(modalBulkUPC);
});
  
const upcInput = document.getElementById('bulkUpcInput');
if (upcInput){
upcInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const raw  = e.target.value.trim();
    if (!raw) return;

    const b    = getCurrentBatch();
    raw.split(/[\s,]+/).forEach(upc => {
      if (!upc) return;
      const ln  = blankLine();
      ln.recordType = els.bulkRecordType.value || 'SALE';
      ln.upc   = upc.replace(/\D/g,'');

      const itm = masterItems?.get(canonUPC(ln.upc));
      if (itm){
        ln.brand       = itm.brand;
        ln.description = itm.description;
        ln.regPrice    = itm.reg_price;
      }
      upsertLine(b, ln);
    });
    scheduleSave(b);
    renderLines();

    e.target.value = '';                // clear after Enter
  });
}
  document.getElementById('confirmBulkUPC').addEventListener('click', () => {
    const ta = document.getElementById('bulkUpcInput');
    if(!ta) { closeModal(modalBulkUPC); return; }
    const txt = ta.value;
    const tokens = txt.split(/[\s,]+/).map(t=>t.trim()).filter(Boolean);
    if(!tokens.length){ closeModal(modalBulkUPC); return; }
    const b = getCurrentBatch();
    tokens.forEach(upc=>{
      const line = firstEmptyLine(b) || blankLine();
      line.recordType = els.bulkRecordType.value || 'SALE';
      line.upc = upc.replace(/\D/g,'');
      if(masterItems && masterItems.has(line.upc)){
        const itm = masterItems.get(line.upc);
        line.brand = itm.brand;
        line.description = itm.description;
        line.regPrice = itm.reg_price;
      }
      upsertLine(b, line);
    });
    scheduleSave(b);
    closeModal(modalBulkUPC);
    renderLines();
  });
}

/* === %‑OFF bulk apply === */
els.bulkPercentOff.addEventListener('input', autoDebounce(() => {
  const pct = parseFloat(els.bulkPercentOff.value);
  if (isNaN(pct) || pct <= 0) return;

  const b = getCurrentBatch();
  b.lines.forEach(l=>{
    const base = parseFloat(l.regPrice);
    if (!isNaN(base) && base>0){
      l.promoPrice = roundPromo(base * (1 - pct/100)).toFixed(2);
    }
  });
  scheduleSave(b);
  renderLines();
}, 200));

/* ---------- Add Lines (optional button) ---------- */
if (els.btnAddLines){
  els.btnAddLines.addEventListener('click', () => {
    const b = getCurrentBatch();
    b.lines.push(blankLine());          // exactly one
    scheduleSave(b);
    renderLines();
  });
}

/* === master list search === */
const renderSuggestions = (hits)=>{
  const ul = els.masterSuggestions;
  ul.innerHTML = hits.map(h=>`
    <li data-code="${h.upc}">
      <strong>${escapeHtml(h.brand||'')}</strong> – ${escapeHtml(h.description)}
      <span style="float:right;color:#777;">${h.upc}</span>
    </li>`).join('');
  ul.classList.toggle('hidden', !hits.length);
};

const queryMaster = term => {
  if (!masterItems) return [];
  const t = term.toLowerCase().trim();
  if (!t) return [];

  const hits = [];
  const startsNum = /^\d+$/.test(t);          // all digits?

  /* --- 1) exact UPC match when user types digits -------- */
  if (startsNum) {
    const exact = masterItems.get( canonUPC(t) );   // 🆕 pad‑to‑13
    if (exact) hits.push(exact);
  }

  /* --- 2) run a simple scan (skip dupes we already have) */
  masterItems.forEach(it => {
    if (hits.includes(it)) return;            // skip exact already pushed

    const b = it.brand.toLowerCase();
    const d = it.description.toLowerCase();
    if (
      (startsNum && it.upc.includes(t)) ||
      b.includes(t) || d.includes(t)
    ){
      hits.push(it);
    }
  });

  return hits.slice(0, 50);                   // cap list
};

els.masterSearch.addEventListener('input', autoDebounce(e=>{
  const t = e.target.value.trim();
  renderSuggestions(t ? queryMaster(t) : []);
}, 120));

els.masterSuggestions.addEventListener('mousedown', e => {
  const li = e.target.closest('li[data-code]');
  if (!li) return;
  e.preventDefault();                 // avoid blur before we handle it
  addItemToBatch(li.dataset.code);    // insert/update line

  els.masterSearch.value = '';
  renderSuggestions([]);
});

  // push selected item as a new line
  const b = getCurrentBatch();
  const l = firstEmptyLine(b) || blankLine();
  l.recordType = els.bulkRecordType.value || 'SALE';
  l.upc = code;
  const itm = masterItems.get(code);
  l.brand = itm.brand; l.description = itm.description; l.regPrice = itm.reg_price;
  upsertLine(b, ln);
  scheduleSave(b); renderLines();

  // reset UI
  els.masterSearch.value=''; renderSuggestions([]);
);

/* ---------- Validation / Export ---------- */
if (els.btnValidate) {
  els.btnValidate.addEventListener('click', () => {
    const issues = collectValidation(getCurrentBatch());
    showIssues(issues);
  });
}
function showIssues(issues){
  issuesList.innerHTML = issues.length ? issues.map(i=>`<li>${escapeHtml(i)}</li>`).join('') : '<li>No issues 🎉</li>';
  openModal(modalIssues);
}

function needsQuote(v){ return /[",\r\n]/.test(String(v)); }
function csvForBatch(batch){
  const lines = [EXPORT_HEADERS.join(',')];
  batch.lines.forEach(l=>{
    const row = [
      l.recordType,
      canonUPC(l.upc),
      l.promoPrice ?? '',
      l.promoQty || 1,
      l.startDate || '',
      l.endDate || ''
    ];
    lines.push(row.map(v=> needsQuote(v)?`"${String(v).replace(/"/g,'""')}"`:v).join(','));
  });
  return lines.join('\r\n');
}

function downloadCSV(text, filename){
  const blob = new Blob([text], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

if (els.btnExport) {
els.btnExport.addEventListener('click', ()=>{
  const b   = getCurrentBatch();
  const bad = collectValidation(b);
  if (bad.length) showIssues(bad);

  const csv = csvForBatch(b);
  csvPreview.textContent = csv;
  downloadCSV(csv, `${b.name}_price_batch.csv`);
  openModal(modalCsvPreview);
  toast('Exported','success');
});
}

/* ---------- Filtering ---------- */
els.lineFilter.addEventListener('input', renderLines);

/* ---------- Helpers ---------- */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeAttr(s){ return escapeHtml(s); }

/* ---------- Init ---------- */
async function init(){
  loadFromLocal();
  let batch = getCurrentBatch();
  if(!batch){
    // fallback: create a blank one if deep link invalid
    batch = { id: currentBatchId || uuidv4(),
              name: 'Unnamed',
              lines: [ blankLine() ],          
              updatedAt: new Date().toISOString() };
    batches.push(batch);
  }
  els.currentBatchLabel.textContent = batch.name;
  await loadMaster();
  renderLines();
}
init();

/* ---------- Keyboard Shortcuts ---------- */
document.addEventListener('keydown', e=>{
  if(e.ctrlKey && e.key.toLowerCase()==='s'){
    e.preventDefault();
    const b = getCurrentBatch();
    if(b){
      b.updatedAt = new Date().toISOString();
      saveToLocal();
      toast('Saved','success');
      updateStatus();
    }
  } else if(e.ctrlKey && e.key.toLowerCase()==='e'){
    e.preventDefault();
    els.btnExport.click();
  } else if(e.key==='Delete' && document.activeElement.closest('#linesTable')){
    const row = document.activeElement.closest('tr[data-index]');
    if(row){
      const idx = +row.dataset.index;
      if(confirm('Delete row?')){
        const b = getCurrentBatch();
        b.lines.splice(idx,1);
        scheduleSave(b);
        renderLines();
      }
    }
  }
});

// Manual refresh of master item list (POST to server then reload)
if(els.btnRefreshMaster){
  els.btnRefreshMaster.addEventListener('click', async ()=>{
    els.btnRefreshMaster.disabled = true;
    els.btnRefreshMaster.textContent = 'Refreshing…';
    try{
      const res = await fetch('/api/refresh-master-items', { method:'POST' });
      if(res.ok){
        await loadMaster(true);
        // Re-populate existing lines
        const b = getCurrentBatch();
        if(masterItems){
          b.lines.forEach(l=>{
            const itm = masterItems.get(l.upc);
            if(itm){
              l.brand = itm.brand;
              l.description = itm.description;
              l.regPrice = itm.reg_price;
            }
          });
          scheduleSave(b);
          renderLines();
        }
      } else {
        toast('Server refresh failed','error');
      }
    }catch(e){
      toast('Refresh error','error');
    }finally{
      els.btnRefreshMaster.disabled = false;
      els.btnRefreshMaster.textContent = 'Refresh Items';
    }
  });
}
