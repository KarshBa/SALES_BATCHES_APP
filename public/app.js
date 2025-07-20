/**
 * Price Change Batch Builder Front-End
 * All logic for batch list + editing views.
 * Uses localStorage; optionally syncs with server endpoints.
 */

import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9.0.1/+esm';

// ---------- Constants -------------------------------------------------
const LS_KEY = 'priceChangeBatches_v1';
const MASTER_URL = '/data/master_items.json';
const EXPORT_HEADERS = ['Record Type','UPC','Promo_Price','Promo_Qty','Start_Date','End_Date'];
const RECORD_TYPES = ['SALE','TPR','INSTORE','REG'];
const AUTO_SAVE_DEBOUNCE = 500;

// ---------- State -----------------------------------------------------
let masterItems = null;          // Map: upc -> {brand, description, reg_price}
let masterLoaded = false;
let batches = [];                // array of batch objects
let currentBatchId = null;
let saveTimer = null;

// cached DOM
const els = {
  batchListView: document.getElementById('batchListView'),
  batchEditView: document.getElementById('batchEditView'),
  batchesTbody: document.getElementById('batchesTbody'),
  linesTbody: document.getElementById('linesTbody'),
  currentBatchLabel: document.getElementById('currentBatchLabel'),
  btnNew: document.getElementById('btnNew'),
  btnDuplicate: document.getElementById('btnDuplicate'),
  btnDelete: document.getElementById('btnDelete'),
  btnExport: document.getElementById('btnExport'),
  btnBack: document.getElementById('btnBack'),
  statusSummary: document.getElementById('statusSummary'),
  lineFilter: document.getElementById('lineFilter'),
  batchSearch: document.getElementById('batchSearch')
};

// Modals
const modalOverlay = document.getElementById('modalOverlay');
const modalNewBatch = document.getElementById('modalNewBatch');
const modalAddLines = document.getElementById('modalAddLines');
const modalBulkUPC = document.getElementById('modalBulkUPC');
const modalIssues  = document.getElementById('modalIssues');
const modalCsvPreview = document.getElementById('modalCsvPreview');

const issuesList = document.getElementById('issuesList');
const csvPreview = document.getElementById('csvPreview');

// ---------- Utility ---------------------------------------------------
function toast(msg, type='info', ms=3500){
  const cont = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type==='error'?'error':type==='success'?'success':''}`;
  t.innerHTML = `<button aria-label="Close">&times;</button>${msg}`;
  t.querySelector('button').onclick = ()=>t.remove();
  cont.appendChild(t);
  setTimeout(()=>t.remove(), ms);
}

function openModal(modal){
  modal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');
  modalOverlay.setAttribute('aria-hidden','false');
  const firstInput = modal.querySelector('input,textarea,button,select');
  if(firstInput) setTimeout(()=>firstInput.focus(), 30);
}
function closeModal(modal){
  modal.classList.add('hidden');
  modalOverlay.classList.add('hidden');
  modalOverlay.setAttribute('aria-hidden','true');
}
document.querySelectorAll('.close-modal').forEach(btn=>{
  btn.addEventListener('click', e=>{
    const sel = btn.dataset.close;
    closeModal(document.querySelector(sel));
  });
});

// ---------- Master Item List Load ------------------------------------
async function loadMaster(){
  if(masterLoaded) return;
  try{
    const res = await fetch(MASTER_URL, {cache:'no-store'});
    if(!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    masterItems = new Map();
    data.forEach(it=>{
      if(it.upc) masterItems.set(it.upc.trim(), it);
    });
    masterLoaded = true;
    toast(`Master items loaded (${masterItems.size})`,'success');
  }catch(err){
    toast('Master list load failed – UPCs unverified','error',6000);
    masterItems = null;
  }
}

// ---------- Local Storage Persistence --------------------------------
function loadFromLocal(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if(raw) batches = JSON.parse(raw);
  }catch{}
}
function saveToLocal(){
  localStorage.setItem(LS_KEY, JSON.stringify(batches));
}

async function syncToServer(batch){
  // best effort; ignore errors
  try {
    const exists = batches.find(b=>b.id === batch.id);
    if(!exists) return;
    // attempt PUT (if exists server) else POST new
    const method = 'PUT';
    const res = await fetch(`/api/batches/${batch.id}`, {
      method,
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(batch)
    });
    if(!res.ok){
      // maybe create
      await fetch('/api/batches', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(batch)
      });
    }
  }catch{/* silent */}
}

function scheduleSave(batch){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    batch.updatedAt = new Date().toISOString();
    saveToLocal();
    syncToServer(batch);
    updateStatus();
  }, AUTO_SAVE_DEBOUNCE);
}

function getCurrentBatch(){
  return batches.find(b=>b.id === currentBatchId);
}

// ---------- Batch Operations -----------------------------------------
function createBatch(name){
  if(!name || batches.some(b=>b.name===name)) return null;
  const batch = {
    id: uuidv4(),
    name,
    lines: [],
    updatedAt: new Date().toISOString()
  };
  // initial 5 blank lines
  for(let i=0;i<5;i++) batch.lines.push(blankLine());
  batches.push(batch);
  saveToLocal();
  return batch;
}
function duplicateCurrent(){
  const b = getCurrentBatch();
  if(!b) return;
  const copy = structuredClone(b);
  copy.id = uuidv4();
  copy.name = b.name + '_COPY';
  copy.updatedAt = new Date().toISOString();
  batches.push(copy);
  saveToLocal();
  toast('Batch duplicated','success');
  renderBatchList();
}
function deleteBatch(id){
  batches = batches.filter(b=>b.id!==id);
  if(currentBatchId === id) currentBatchId = null;
  saveToLocal();
  renderBatchList();
}

function blankLine(){
  return {
    recordType: '',
    upc: '',
    brand: '',
    description: '',
    regPrice: '',
    promoPrice: '',
    promoQty: '',
    startDate: '',
    endDate: ''
  };
}

// ---------- Validation ------------------------------------------------
/**
 * Validate a single line; returns array of issue strings (empty if fine).
 * Mutates the line to normalize promoQty / trimming.
 */
function validateLine(line, index){
  const issues = [];
  const rt = line.recordType?.trim();
  if(!RECORD_TYPES.includes(rt)){
    issues.push(`Line ${index+1}: Record Type invalid/blank`);
  }
  // UPC
  const upc = line.upc.replace(/\D/g,'');
  if(!upc || upc.length < 12 || upc.length > 14){
    issues.push(`Line ${index+1}: UPC invalid length`);
  } else if(masterItems && !masterItems.has(upc)){
    issues.push(`Line ${index+1}: UPC not in master list`);
  }
  // Required fields when not REG
  const needsPromo = rt && rt !== 'REG';
  if(needsPromo){
    if(line.promoPrice === '' || isNaN(parseFloat(line.promoPrice)) || parseFloat(line.promoPrice)<=0){
      issues.push(`Line ${index+1}: Promo_Price required`);
    }
    if(!line.startDate) issues.push(`Line ${index+1}: Start_Date required`);
    if(!line.endDate) issues.push(`Line ${index+1}: End_Date required`);
  }
  // Dates
  if(line.startDate && line.endDate && line.endDate < line.startDate){
    issues.push(`Line ${index+1}: End_Date < Start_Date`);
  }
  // Promo Qty default
  let qty = parseInt(line.promoQty,10);
  if(isNaN(qty) || qty < 1) {
    qty = 1;
    line.promoQty = qty;
  }
  return issues;
}

function collectValidation(batch){
  const issues = [];
  batch.lines.forEach((ln,i)=>{
    issues.push(...validateLine(ln,i));
  });
  return issues;
}

// ---------- Rendering: Batch List ------------------------------------
function renderBatchList(){
  els.batchListView.classList.remove('hidden');
  els.batchEditView.classList.add('hidden');
  els.btnBack.classList.add('hidden');
  els.btnExport.disabled = true;
  els.btnDelete.disabled = true;
  els.btnDuplicate.disabled = true;
  currentBatchId = null;
  els.currentBatchLabel.textContent = 'No batch selected';

  const filter = els.batchSearch.value.trim().toLowerCase();
  const tbody = els.batchesTbody;
  tbody.innerHTML = '';
  batches
    .slice()
    .sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''))
    .filter(b => !filter || b.name.toLowerCase().includes(filter))
    .forEach(b=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(b.name)}</td>
        <td>${b.lines.length}</td>
        <td>${b.updatedAt ? new Date(b.updatedAt).toLocaleString() : ''}</td>
        <td class="actions">
          <button class="secondary open-btn" data-id="${b.id}">Open</button>
          <button class="secondary quick-export-btn" data-id="${b.id}">Export</button>
          <button class="danger del-btn" data-id="${b.id}">Del</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
}

// ---------- Rendering: Batch Edit ------------------------------------
function renderLines(){
  const batch = getCurrentBatch();
  if(!batch) return;
  const filter = els.lineFilter.value.trim().toLowerCase();
  els.linesTbody.innerHTML = '';
  batch.lines.forEach((ln, idx)=>{
    const issues = validateLine({...ln}, idx); // copy so we don't mutate
    const filteredOut = filter && !(
      ln.upc.toLowerCase().includes(filter) ||
      ln.brand.toLowerCase().includes(filter) ||
      ln.description.toLowerCase().includes(filter)
    );
    const tr = document.createElement('tr');
    if(filteredOut) tr.classList.add('hidden-row');
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
      <td><button class="row-del" title="Delete row">&times;</button></td>
    `;
    // mark invalid cells
    if(issues.length){
      issues.forEach(is=>{
        if(is.includes('Record Type')) tr.querySelector('.cell-recordType').classList.add('invalid-cell');
        if(is.includes('UPC')) tr.querySelector('.cell-upc').classList.add('invalid-cell');
        if(is.includes('Promo_Price')) tr.querySelector('.cell-promoPrice').classList.add('invalid-cell');
        if(is.includes('Start_Date')) tr.querySelector('.cell-startDate').classList.add('invalid-cell');
        if(is.includes('End_Date')) tr.querySelector('.cell-endDate').classList.add('invalid-cell');
      });
    }
    els.linesTbody.appendChild(tr);
  });
  updateStatus();
}

function updateStatus(){
  const batch = getCurrentBatch();
  if(!batch){
    els.statusSummary.textContent = '';
    return;
  }
  let invalidCount = 0;
  batch.lines.forEach((ln,i)=>{
    const issues = validateLine({...ln}, i);
    if(issues.length) invalidCount++;
  });
  els.statusSummary.textContent =
    `Lines: ${batch.lines.length} | Invalid: ${invalidCount} | Last Saved: ${
      batch.updatedAt ? new Date(batch.updatedAt).toLocaleTimeString() : '—'
    }`;
}

// ---------- Event Binding: Batch List Actions ------------------------
els.batchesTbody.addEventListener('click', e=>{
  const btn = e.target.closest('button');
  if(!btn) return;
  const id = btn.dataset.id;
  if(btn.classList.contains('open-btn')){
    openBatch(id);
  } else if(btn.classList.contains('del-btn')){
    if(confirm('Delete this batch?')){
      deleteBatch(id);
      toast('Batch deleted','success');
    }
  } else if(btn.classList.contains('quick-export-btn')){
    const b = batches.find(b=>b.id===id);
    if(!b) return;
    quickExportBatch(b);
  }
});

// ---------- Open Batch -----------------------------------------------
function openBatch(id){
  currentBatchId = id;
  els.batchListView.classList.add('hidden');
  els.batchEditView.classList.remove('hidden');
  els.btnBack.classList.remove('hidden');
  els.btnExport.disabled = false;
  els.btnDelete.disabled = false;
  els.btnDuplicate.disabled = false;
  const batch = getCurrentBatch();
  els.currentBatchLabel.textContent = batch.name;
  renderLines();
}

// ---------- Inline Editing -------------------------------------------
els.linesTbody.addEventListener('input', e=>{
  const tr = e.target.closest('tr');
  if(!tr) return;
  const idx = parseInt(tr.dataset.index,10);
  const batch = getCurrentBatch();
  const line = batch.lines[idx];
  if(e.target.classList.contains('cell-recordType')){
    line.recordType = e.target.value;
  } else if(e.target.classList.contains('cell-upc')){
    line.upc = e.target.value.replace(/\D/g,'');
  } else if(e.target.classList.contains('cell-promoPrice')){
    line.promoPrice = e.target.value;
  } else if(e.target.classList.contains('cell-promoQty')){
    line.promoQty = e.target.value;
  } else if(e.target.classList.contains('cell-startDate')){
    line.startDate = e.target.value;
  } else if(e.target.classList.contains('cell-endDate')){
    line.endDate = e.target.value;
  }
  // attempt auto-populate on UPC length threshold
  if(masterItems && e.target.classList.contains('cell-upc')){
    if(line.upc.length >= 12){
      const item = masterItems.get(line.upc);
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
  scheduleSave(batch);
  renderLines();
});

els.linesTbody.addEventListener('click', e=>{
  if(e.target.classList.contains('row-del')){
    const tr = e.target.closest('tr');
    const idx = parseInt(tr.dataset.index,10);
    const batch = getCurrentBatch();
    if(confirm('Delete row?')){
      batch.lines.splice(idx,1);
      scheduleSave(batch);
      renderLines();
    }
  }
});

// ---------- Bulk Add Lines -------------------------------------------
document.getElementById('btnAddLines').addEventListener('click', ()=>{
  openModal(modalAddLines);
});
document.getElementById('confirmAddLines').addEventListener('click', ()=>{
  const n = Math.min(50, Math.max(1, parseInt(document.getElementById('numNewLines').value,10)||1));
  const b = getCurrentBatch();
  for(let i=0;i<n;i++) b.lines.push(blankLine());
  scheduleSave(b);
  closeModal(modalAddLines);
  renderLines();
});

// ---------- Bulk UPC Add ---------------------------------------------
document.getElementById('btnBulkUPC').addEventListener('click', ()=>{
  document.getElementById('bulkUpcInput').value = '';
  openModal(modalBulkUPC);
});
document.getElementById('confirmBulkUPC').addEventListener('click', ()=>{
  const txt = document.getElementById('bulkUpcInput').value;
  if(!txt.trim()) { closeModal(modalBulkUPC); return; }
  const tokens = txt.split(/[\s,]+/).map(t=>t.trim()).filter(Boolean);
  if(!tokens.length){ closeModal(modalBulkUPC); return; }
  const b = getCurrentBatch();
  tokens.forEach(upc=>{
    const line = blankLine();
    line.recordType = 'SALE'; // default
    line.upc = upc.replace(/\D/g,'');
    if(masterItems && masterItems.has(line.upc)){
      const itm = masterItems.get(line.upc);
      line.brand = itm.brand;
      line.description = itm.description;
      line.regPrice = itm.reg_price;
    }
    b.lines.push(line);
  });
  scheduleSave(b);
  closeModal(modalBulkUPC);
  renderLines();
});

// ---------- Bulk Apply Controls --------------------------------------
document.getElementById('applyRecordType').addEventListener('click', ()=>{
  const val = document.getElementById('bulkRecordType').value;
  if(!val) return;
  const b = getCurrentBatch();
  b.lines.forEach(l=> l.recordType = val);
  scheduleSave(b);
  renderLines();
});
document.getElementById('applyPromoPriceAll').addEventListener('click', ()=>{
  const val = document.getElementById('bulkPromoPrice').value;
  if(val === '') return;
  const b = getCurrentBatch();
  b.lines.forEach(l=> l.promoPrice = val);
  scheduleSave(b);
  renderLines();
});
document.getElementById('applyPromoQtyAll').addEventListener('click', ()=>{
  const val = document.getElementById('bulkPromoQty').value;
  if(val === '') return;
  const b = getCurrentBatch();
  b.lines.forEach(l=> l.promoQty = val);
  scheduleSave(b);
  renderLines();
});
document.getElementById('applyPromoQtyEmpty').addEventListener('click', ()=>{
  const val = document.getElementById('bulkPromoQty').value;
  if(val === '') return;
  const b = getCurrentBatch();
  b.lines.forEach(l=> { if(!l.promoQty) l.promoQty = val; });
  scheduleSave(b);
  renderLines();
});
document.getElementById('applyStartDateAll').addEventListener('click', ()=>{
  const val = document.getElementById('bulkStartDate').value;
  if(!val) return;
  const b = getCurrentBatch();
  b.lines.forEach(l=> l.startDate = val);
  scheduleSave(b);
  renderLines();
});
document.getElementById('applyEndDateAll').addEventListener('click', ()=>{
  const val = document.getElementById('bulkEndDate').value;
  if(!val) return;
  const b = getCurrentBatch();
  b.lines.forEach(l=> l.endDate = val);
  scheduleSave(b);
  renderLines();
});

document.getElementById('btnRecalc').addEventListener('click', ()=>{
  if(!masterItems){
    toast('Master not loaded','error');
    return;
  }
  const b = getCurrentBatch();
  b.lines.forEach(l=>{
    if(masterItems.has(l.upc)){
      const itm = masterItems.get(l.upc);
      l.brand = itm.brand;
      l.description = itm.description;
      l.regPrice = itm.reg_price;
    }
  });
  scheduleSave(b);
  renderLines();
});

// ---------- Validation & Export --------------------------------------
document.getElementById('btnValidate').addEventListener('click', ()=>{
  const issues = collectValidation(getCurrentBatch());
  showIssues(issues);
});

function showIssues(issues){
  issuesList.innerHTML = '';
  if(!issues.length){
    issuesList.innerHTML = '<li>No issues 🎉</li>';
  } else {
    issues.forEach(i=>{
      const li = document.createElement('li');
      li.textContent = i;
      issuesList.appendChild(li);
    });
  }
  openModal(modalIssues);
}

function csvForBatch(batch){
  const lines = [EXPORT_HEADERS.join(',')];
  batch.lines.forEach((l,i)=>{
    const check = validateLine({...l}, i);
    if(check.length) return; // skip invalid rows in actual export
    const qty = l.promoQty || 1;
    const row = [
      l.recordType,
      l.upc,
      l.promoPrice ?? '',
      qty,
      l.startDate || '',
      l.endDate || ''
    ];
    lines.push(row.map(v=>needsQuote(v)?`"${String(v).replace(/"/g,'""')}"`:v).join(','));
  });
  return lines.join('\r\n');
}

function needsQuote(v){
  return /[",\r\n]/.test(String(v));
}

function exportCurrent(){
  const batch = getCurrentBatch();
  const issues = collectValidation(batch);
  if(issues.length){
    showIssues(issues);
    toast('Resolve validation issues before export','error');
    return;
  }
  const csv = csvForBatch(batch);
  csvPreview.textContent = csv;
  downloadCSV(csv, `${batch.name}_price_batch.csv`);
  openModal(modalCsvPreview);
  toast('Exported','success');
}

function quickExportBatch(batch){
  const issues = collectValidation(batch);
  if(issues.length){
    toast(`Cannot export ${batch.name} – has issues`,'error');
    return;
  }
  const csv = csvForBatch(batch);
  downloadCSV(csv, `${batch.name}_price_batch.csv`);
  toast('Exported','success');
}

function downloadCSV(text, filename){
  const blob = new Blob([text], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Filtering -------------------------------------------------
els.lineFilter.addEventListener('input', renderLines);
els.batchSearch.addEventListener('input', renderBatchList);

// ---------- Header Buttons -------------------------------------------
els.btnNew.addEventListener('click', ()=> openModal(modalNewBatch));
document.getElementById('createBatchConfirm').addEventListener('click', ()=>{
  const name = document.getElementById('newBatchName').value.trim();
  if(!name){ toast('Enter a batch name','error'); return; }
  if(batches.some(b=>b.name===name)){ toast('Name in use','error'); return; }
  const b = createBatch(name);
  closeModal(modalNewBatch);
  renderBatchList();
  openBatch(b.id);
  toast('Batch created','success');
});

els.btnDuplicate.addEventListener('click', duplicateCurrent);
els.btnDelete.addEventListener('click', ()=>{
  const b = getCurrentBatch();
  if(!b) return;
  if(confirm('Delete this batch?')){
    deleteBatch(b.id);
    toast('Batch deleted','success');
  }
});
els.btnExport.addEventListener('click', exportCurrent);
els.btnBack.addEventListener('click', ()=>{
  renderBatchList();
});

// ---------- Keyboard Shortcuts --------------------------------------
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
    if(getCurrentBatch()) exportCurrent();
  } else if(e.ctrlKey && e.key.toLowerCase()==='n'){
    e.preventDefault();
    openModal(modalNewBatch);
  } else if(e.key==='Delete' && document.activeElement.closest('#linesTable')){
    // delete focused row
    const row = document.activeElement.closest('tr[data-index]');
    if(row){
      const idx = parseInt(row.dataset.index,10);
      if(confirm('Delete row?')){
        const b = getCurrentBatch();
        b.lines.splice(idx,1);
        scheduleSave(b);
        renderLines();
      }
    }
  }
});

// ---------- Helpers --------------------------------------------------
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

// ---------- Initialization -------------------------------------------
async function init(){
  loadFromLocal();
  // optional: attempt to hydrate from server if local empty
  if(!batches.length){
    try {
      const res = await fetch('/api/batches');
      if(res.ok){
        const remote = await res.json();
        if(Array.isArray(remote) && remote.length) {
          batches = remote;
          saveToLocal();
        }
      }
    } catch{/* ignore */}
  }
  await loadMaster();
  renderBatchList();
}
init();
