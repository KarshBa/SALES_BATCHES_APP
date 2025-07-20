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
  currentBatchLabel: document.getElementById('currentBatchLabel'),
  btnValidate:       document.getElementById('btnValidate'),
  btnExport:         document.getElementById('btnExport'),
  lineFilter:        document.getElementById('lineFilter'),
  linesTbody:        document.getElementById('linesTbody'),
  statusSummary:     document.getElementById('statusSummary'),
  // optional (only if you add the button back)
  btnAddLines:       document.getElementById('btnAddLines'),

  // bulk controls
  bulkRecordType:    document.getElementById('bulkRecordType'),
  bulkPromoPrice:    document.getElementById('bulkPromoPrice'),
  bulkPromoQty:      document.getElementById('bulkPromoQty'),
  bulkStartDate:     document.getElementById('bulkStartDate'),
  bulkEndDate:       document.getElementById('bulkEndDate'),
  btnBulkUPC:        document.getElementById('btnBulkUPC')
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
async function loadMaster(){
  if(masterLoaded) return;
  try{
    const res = await fetch(MASTER_URL,{cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    masterItems = new Map();
    data.forEach(it=>{
      if(it.upc) masterItems.set(it.upc.trim(), it);
    });
    masterLoaded = true;
    toast(`Master loaded (${masterItems.size})`,'success');
  }catch(err){
    toast('Master list failed to load','error',6000);
  }
}

/* ---------- Validation ---------- */
function validateLine(line, index){
  const issues = [];
  const rt = line.recordType?.trim();
  if(!RECORD_TYPES.includes(rt)) issues.push(`Line ${index+1}: Record Type invalid/blank`);
  const upc = line.upc.replace(/\D/g,'');
  if(!upc || upc.length<12 || upc.length>14) issues.push(`Line ${index+1}: UPC invalid length`);
  else if(masterItems && !masterItems.has(upc)) issues.push(`Line ${index+1}: UPC not in master list`);
  const needsPromo = rt && rt !== 'REG';
  if(needsPromo){
    if(line.promoPrice === '' || isNaN(parseFloat(line.promoPrice)) || parseFloat(line.promoPrice)<=0)
      issues.push(`Line ${index+1}: Promo_Price required`);
    if(!line.startDate) issues.push(`Line ${index+1}: Start_Date required`);
    if(!line.endDate)   issues.push(`Line ${index+1}: End_Date required`);
  }
  if(line.startDate && line.endDate && line.endDate < line.startDate)
    issues.push(`Line ${index+1}: End_Date < Start_Date`);
  // normalize qty
  let qty = parseInt(line.promoQty,10);
  if(isNaN(qty) || qty < 1){ qty = 1; line.promoQty = qty; }
  return issues;
}
function collectValidation(batch){
  const issues = [];
  batch.lines.forEach((l,i)=> issues.push(...validateLine({...l}, i)));
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
      <td><button class="row-del" title="Delete row">&times;</button></td>
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
    if(masterItems && line.upc.length >= 12){
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
  } else if(e.target.classList.contains('cell-promoPrice')) line.promoPrice = e.target.value;
  else if(e.target.classList.contains('cell-promoQty')) line.promoQty = e.target.value;
  else if(e.target.classList.contains('cell-startDate')) line.startDate = e.target.value;
  else if(e.target.classList.contains('cell-endDate')) line.endDate = e.target.value;

  scheduleSave(b);
  renderLines(); // re-render to update validation highlights
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

  document.getElementById('confirmBulkUPC').addEventListener('click', () => {
    const ta = document.getElementById('bulkUpcInput');
    if(!ta) { closeModal(modalBulkUPC); return; }
    const txt = ta.value;
    const tokens = txt.split(/[\s,]+/).map(t=>t.trim()).filter(Boolean);
    if(!tokens.length){ closeModal(modalBulkUPC); return; }
    const b = getCurrentBatch();
    tokens.forEach(upc=>{
      const line = blankLine();
      line.recordType = els.bulkRecordType.value || 'SALE';
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
}

/* ---------- Add Lines (optional button) ---------- */
if(els.btnAddLines){
  els.btnAddLines.addEventListener('click', ()=> openModal(modalAddLines));
  document.getElementById('confirmAddLines').addEventListener('click', ()=>{
    const n = Math.min(50, Math.max(1, parseInt(document.getElementById('numNewLines').value,10)||1));
    const b = getCurrentBatch();
    for(let i=0;i<n;i++) b.lines.push(blankLine());
    scheduleSave(b);
    closeModal(modalAddLines);
    renderLines();
  });
}

/* ---------- Validation / Export ---------- */
els.btnValidate.addEventListener('click', ()=>{
  const issues = collectValidation(getCurrentBatch());
  showIssues(issues);
});

function showIssues(issues){
  issuesList.innerHTML = issues.length ? issues.map(i=>`<li>${escapeHtml(i)}</li>`).join('') : '<li>No issues 🎉</li>';
  openModal(modalIssues);
}

function needsQuote(v){ return /[",\r\n]/.test(String(v)); }
function csvForBatch(batch){
  const lines = [EXPORT_HEADERS.join(',')];
  batch.lines.forEach((l,i)=>{
    if(validateLine({...l}, i).length) return;
    const row = [
      l.recordType,
      l.upc,
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

els.btnExport.addEventListener('click', ()=>{
  const b = getCurrentBatch();
  const issues = collectValidation(b);
  if(issues.length){
    showIssues(issues);
    toast('Resolve validation issues before export','error');
    return;
  }
  const csv = csvForBatch(b);
  csvPreview.textContent = csv;
  downloadCSV(csv, `${b.name}_price_batch.csv`);
  openModal(modalCsvPreview);
  toast('Exported','success');
});

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
    batch = { id: currentBatchId || uuidv4(), name: 'Unnamed', lines: [], updatedAt: new Date().toISOString() };
    for(let i=0;i<5;i++) batch.lines.push(blankLine());
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
