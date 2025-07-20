import { loadAllBatches, upsertBatch, toast } from './shared_batch_lib.js';
import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9.0.1/+esm';

const params = new URLSearchParams(location.search);
let currentBatchId = params.get('batch');
if(!currentBatchId) location.replace('batches.html');

const MASTER_URL = '/data/master_items.json';
const RECORD_TYPES = ['SALE','TPR','INSTORE','REG'];
const EXPORT_HEADERS = ['Record Type','UPC','Promo_Price','Promo_Qty','Start_Date','End_Date'];
const AUTO_SAVE_DEBOUNCE = 500;

let masterItems = null;
let masterLoaded = false;
let batches = [];
let saveTimer = null;

const els = {
  linesTbody: document.getElementById('linesTbody'),
  currentBatchLabel: document.getElementById('currentBatchLabel'),
  btnExport: document.getElementById('btnExport'),
  statusSummary: document.getElementById('statusSummary'),
  lineFilter: document.getElementById('lineFilter')
};

const modalOverlay      = document.getElementById('modalOverlay');
const modalAddLines     = document.getElementById('modalAddLines');
const modalBulkUPC      = document.getElementById('modalBulkUPC');
const modalIssues       = document.getElementById('modalIssues');
const modalCsvPreview   = document.getElementById('modalCsvPreview');
const issuesList        = document.getElementById('issuesList');
const csvPreview        = document.getElementById('csvPreview');

document.querySelectorAll('.close-modal').forEach(b=>{
  b.addEventListener('click', ()=> closeModal(document.querySelector(b.dataset.close)));
});
modalOverlay.addEventListener('click', ()=> {
  const open = document.querySelector('.modal:not(.hidden)');
  if(open) closeModal(open);
});

function openModal(m){ modalOverlay.classList.remove('hidden'); m.classList.remove('hidden'); }
function closeModal(m){ modalOverlay.classList.add('hidden'); m.classList.add('hidden'); }

function loadLocal(){ batches = loadAllBatches(); }
function saveLocal(){ upsertBatch(getCurrentBatch()); }

async function loadMaster(){
  if(masterLoaded) return;
  try{
    const res = await fetch(MASTER_URL,{cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    masterItems = new Map();
    data.forEach(it=> it.upc && masterItems.set(it.upc.trim(), it));
    masterLoaded = true;
    toast(`Master items loaded (${masterItems.size})`,'success');
  }catch{
    toast('Master list load failed','error',6000);
  }
}

function getCurrentBatch(){
  return batches.find(b=>b.id===currentBatchId);
}

function scheduleSave(batch){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    batch.updatedAt = new Date().toISOString();
    saveLocal();
    updateStatus();
  }, AUTO_SAVE_DEBOUNCE);
}

function blankLine(){
  return { recordType:'', upc:'', brand:'', description:'', regPrice:'', promoPrice:'', promoQty:'', startDate:'', endDate:'' };
}

function validateLine(line, idx){
  const issues=[];
  const rt=line.recordType?.trim();
  if(!RECORD_TYPES.includes(rt)) issues.push(`Line ${idx+1}: Record Type invalid/blank`);
  const upc=line.upc.replace(/\D/g,'');
  if(!upc || upc.length<12 || upc.length>14) issues.push(`Line ${idx+1}: UPC invalid length`);
  else if(masterItems && !masterItems.has(upc)) issues.push(`Line ${idx+1}: UPC not in master list`);
  const needs = rt && rt!=='REG';
  if(needs){
    if(line.promoPrice==='' || isNaN(parseFloat(line.promoPrice)) || parseFloat(line.promoPrice)<=0)
      issues.push(`Line ${idx+1}: Promo_Price required`);
    if(!line.startDate) issues.push(`Line ${idx+1}: Start_Date required`);
    if(!line.endDate) issues.push(`Line ${idx+1}: End_Date required`);
  }
  if(line.startDate && line.endDate && line.endDate < line.startDate)
    issues.push(`Line ${idx+1}: End_Date < Start_Date`);
  let qty=parseInt(line.promoQty,10);
  if(isNaN(qty)||qty<1){ line.promoQty=1; }
  return issues;
}

function collectValidation(b){
  const issues=[];
  b.lines.forEach((l,i)=> issues.push(...validateLine({...l},i)));
  return issues;
}

function renderLines(){
  const b=getCurrentBatch(); if(!b) return;
  const filter=els.lineFilter.value.trim().toLowerCase();
  els.linesTbody.innerHTML='';
  b.lines.forEach((ln,i)=>{
    const rowIssues=validateLine({...ln},i);
    const hide = filter && !(
      ln.upc.toLowerCase().includes(filter) ||
      ln.brand.toLowerCase().includes(filter) ||
      ln.description.toLowerCase().includes(filter)
    );
    const tr=document.createElement('tr');
    if(hide) tr.classList.add('hidden-row');
    tr.dataset.index=i;
    tr.innerHTML = `
      <td>
        <select class="cell-recordType">
          <option value=""></option>
          ${RECORD_TYPES.map(rt=>`<option ${rt===ln.recordType?'selected':''}>${rt}</option>`).join('')}
        </select>
      </td>
      <td><input class="cell-upc" value="${escapeHtml(ln.upc)}" inputmode="numeric" pattern="[0-9]*" /></td>
      <td class="ro brand">${escapeHtml(ln.brand)}</td>
      <td class="ro desc">${escapeHtml(ln.description)}</td>
      <td class="ro regPrice">${ln.regPrice!==''?Number(ln.regPrice).toFixed(2):''}</td>
      <td><input class="cell-promoPrice" type="number" step="0.01" min="0" value="${escapeHtml(ln.promoPrice)}" /></td>
      <td><input class="cell-promoQty" type="number" min="1" value="${escapeHtml(ln.promoQty)}" /></td>
      <td><input class="cell-startDate" type="date" value="${escapeHtml(ln.startDate)}" /></td>
      <td><input class="cell-endDate" type="date" value="${escapeHtml(ln.endDate)}" /></td>
      <td><button class="row-del" title="Delete">&times;</button></td>`;
    if(rowIssues.length){
      rowIssues.forEach(is=>{
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
  const b=getCurrentBatch(); if(!b){ els.statusSummary.textContent=''; return; }
  let invalid=0;
  b.lines.forEach((l,i)=> { if(validateLine({...l},i).length) invalid++; });
  els.statusSummary.textContent = `Lines: ${b.lines.length} | Invalid: ${invalid} | Last Saved: ${
    b.updatedAt? new Date(b.updatedAt).toLocaleTimeString() : '—'
  }`;
}

els.linesTbody.addEventListener('input', e=>{
  const tr=e.target.closest('tr'); if(!tr) return;
  const idx=+tr.dataset.index;
  const b=getCurrentBatch();
  const ln=b.lines[idx];
  if(e.target.classList.contains('cell-recordType')) ln.recordType=e.target.value;
  else if(e.target.classList.contains('cell-upc')) {
    ln.upc=e.target.value.replace(/\D/g,'');
    if(masterItems && ln.upc.length>=12){
      const item = masterItems.get(ln.upc);
      if(item){ ln.brand=item.brand; ln.description=item.description; ln.regPrice=item.reg_price; }
      else { ln.brand=''; ln.description=''; ln.regPrice=''; }
    }
  } else if(e.target.classList.contains('cell-promoPrice')) ln.promoPrice=e.target.value;
  else if(e.target.classList.contains('cell-promoQty')) ln.promoQty=e.target.value;
  else if(e.target.classList.contains('cell-startDate')) ln.startDate=e.target.value;
  else if(e.target.classList.contains('cell-endDate')) ln.endDate=e.target.value;

  scheduleSave(b);
  renderLines();
});

els.linesTbody.addEventListener('click', e=>{
  if(e.target.classList.contains('row-del')){
    const idx=+e.target.closest('tr').dataset.index;
    const b=getCurrentBatch();
    if(confirm('Delete row?')){
      b.lines.splice(idx,1);
      scheduleSave(b);
      renderLines();
    }
  }
});

document.getElementById('btnAddLines').addEventListener('click', ()=> openModal(modalAddLines));
document.getElementById('confirmAddLines').addEventListener('click', ()=>{
  const n=Math.min(50,Math.max(1, parseInt(document.getElementById('numNewLines').value,10)||1));
  const b=getCurrentBatch();
  for(let i=0;i<n;i++) b.lines.push(blankLine());
  scheduleSave(b);
  closeModal(modalAddLines);
  renderLines();
});

document.getElementById('btnBulkUPC').addEventListener('click', ()=>{
  document.getElementById('bulkUpcInput').value='';
  openModal(modalBulkUPC);
});
document.getElementById('confirmBulkUPC').addEventListener('click', ()=>{
  const txt=document.getElementById('bulkUpcInput').value;
  const tokens=txt.split(/[\s,]+/).map(t=>t.trim()).filter(Boolean);
  if(!tokens.length){ closeModal(modalBulkUPC); return; }
  const b=getCurrentBatch();
  tokens.forEach(upc=>{
    const ln=blankLine();
    ln.recordType='SALE';
    ln.upc=upc.replace(/\D/g,'');
    if(masterItems && masterItems.has(ln.upc)){
      const it=masterItems.get(ln.upc);
      ln.brand=it.brand; ln.description=it.description; ln.regPrice=it.reg_price;
    }
    b.lines.push(ln);
  });
  scheduleSave(b);
  closeModal(modalBulkUPC);
  renderLines();
});

function showIssues(issues){
  issuesList.innerHTML = issues.length
    ? issues.map(i=>`<li>${i}</li>`).join('')
    : '<li>No issues 🎉</li>';
  openModal(modalIssues);
}

document.getElementById('btnValidate').addEventListener('click', ()=>{
  showIssues(collectValidation(getCurrentBatch()));
});

function csvForBatch(batch){
  const lines=[EXPORT_HEADERS.join(',')];
  batch.lines.forEach(l=>{
    const qty=l.promoQty || 1;
    lines.push([l.recordType,l.upc,l.promoPrice ?? '',qty,l.startDate||'',l.endDate||''].join(','));
  });
  return lines.join('\r\n');
}

function exportCurrent(){
  const b=getCurrentBatch();
  const issues=collectValidation(b);
  if(issues.length){
    showIssues(issues);
    toast('Fix validation issues first','error');
    return;
  }
  const csv=csvForBatch(b);
  csvPreview.textContent=csv;
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`${b.name}_price_batch.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  openModal(modalCsvPreview);
  toast('Exported','success');
}

els.btnExport.addEventListener('click', exportCurrent);
els.lineFilter.addEventListener('input', renderLines);

document.getElementById('btnRecalc').addEventListener('click', ()=>{
  if(!masterItems){ toast('Master not loaded','error'); return; }
  const b=getCurrentBatch();
  b.lines.forEach(l=>{
    if(masterItems.has(l.upc)){
      const it=masterItems.get(l.upc);
      l.brand=it.brand; l.description=it.description; l.regPrice=it.reg_price;
    }
  });
  scheduleSave(b);
  renderLines();
});

document.addEventListener('keydown', e=>{
  if(e.ctrlKey && e.key.toLowerCase()==='s'){
    e.preventDefault();
    const b=getCurrentBatch();
    b.updatedAt=new Date().toISOString();
    saveLocal();
    toast('Saved','success');
    updateStatus();
  } else if(e.ctrlKey && e.key.toLowerCase()==='e'){
    e.preventDefault();
    exportCurrent();
  }
});

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function openCurrentBatch(){
  const b=getCurrentBatch();
  if(!b){ location.replace('batches.html'); return; }
  els.currentBatchLabel.textContent=b.name;
  if(!b.lines.length){
    for(let i=0;i<5;i++) b.lines.push(blankLine());
  }
  renderLines();
}

async function init(){
  loadLocal();
  await loadMaster();
  openCurrentBatch();
}
init();
