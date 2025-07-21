/* batches_list.js – list / management page */

const LS_KEY = 'priceChangeBatches_v1';
const EXPORT_HEADERS = ['Record Type','UPC','Promo_Price','Promo_Qty','Start_Date','End_Date'];

let batches = [];

const els = {
  tbody: document.getElementById('batchesTbody'),
  search: document.getElementById('batchSearch'),
  newName: document.getElementById('newBatchName'),
  createBtn: document.getElementById('btnCreateBatch'),
  chkAll: document.getElementById('chkAll'),
  delSelected: document.getElementById('btnDeleteSelected'),
  summary: document.getElementById('batchSummary')
};

const COUNTS_API = 'https://inventory-counts.onrender.com/api/slists';

/* ------------------------------------------------- */
/*  Simple modal helpers – one overlay, many modals  */
/* ------------------------------------------------- */

const overlay = document.getElementById('modalOverlay');
const modalPick = document.getElementById('modalPickList');

/** Show the given modal element (id or node) */
export function openModal(target){
  const m = typeof target === 'string' ? document.getElementById(target) : target;
  if (!m) return;
  m.classList.remove('hidden');
  overlay?.classList.remove('hidden');
}

/** Hide the given modal element (id or node) */
export function closeModal(target){
  const m = typeof target === 'string' ? document.getElementById(target) : target;
  if (!m) return;
  m.classList.add('hidden');
  // if no other modals are visible, also hide overlay
  if (!document.querySelector('.modal:not(.hidden)'))
    overlay?.classList.add('hidden');
}

/* --- wire up generic close buttons — data‑close="#modalId" ------- */
document.querySelectorAll('.close-modal').forEach(btn=>{
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

function toast(msg, type='info', ms=3500){
  const cont = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type==='error'?'error':type==='success'?'success':''}`;
  t.innerHTML = `<button aria-label="Close">&times;</button>${msg}`;
  t.querySelector('button').onclick = ()=>t.remove();
  cont.appendChild(t);
  setTimeout(()=>t.remove(), ms);
}

/* ---------- Storage ---------- */
function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw) batches = JSON.parse(raw)||[];
  }catch{}
}
function saveLocal(){
  localStorage.setItem(LS_KEY, JSON.stringify(batches));
}

/* ---------- Helpers ---------- */
function findBatch(id){ return batches.find(b=>b.id===id); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function formatTime(ts){
  if(!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function nextDuplicateName(name){
  let base = name, n=2;
  while(batches.some(b=>b.name === base+'_COPY'+(n>2?`_${n}`:''))){
    n++;
  }
  return base+'_COPY'+(n>2?`_${n}`:'');
}

/* ---------- CRUD ---------- */
function createBatch(name){
  if(!name) { toast('Enter a name','error'); return null; }
  if(batches.some(b=>b.name===name)){ toast('Name already exists','error'); return null; }
  const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  const lines = [
    { recordType:'', upc:'', brand:'', description:'', regPrice:'', promoPrice:'', promoQty:'', startDate:'', endDate:'' }
  ];
  const batch = { id, name, lines, updatedAt: new Date().toISOString() };
  batches.push(batch);
  saveLocal();
  toast('Batch created','success');
  render();
  return batch;
}

function duplicateBatch(id){
  const original = findBatch(id);
  if(!original) return;
  const clone = structuredClone(original);
  clone.id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  clone.name = nextDuplicateName(original.name);
  clone.updatedAt = new Date().toISOString();
  batches.push(clone);
  saveLocal();
  toast('Duplicated','success');
  render();
}

function deleteBatch(id){
  batches = batches.filter(b=>b.id !== id);
  saveLocal();
}

function deleteSelected(ids){
  if(!ids.length) return;
  if(!confirm(`Delete ${ids.length} batch(es)?`)) return;
  ids.forEach(id => deleteBatch(id));
  toast('Deleted','success');
  render();
}

function quickExport(id){
  const b = findBatch(id);
  if(!b) return;
  // Simple validation: skip lines missing recordType or UPC
  const header = EXPORT_HEADERS.join(',');
  const rows = b.lines
    .filter(l => l.recordType && l.upc)
    .map(l => [
      l.recordType,
      l.upc,
      l.promoPrice ?? '',
      l.promoQty || 1,
      l.startDate || '',
      l.endDate || ''
    ].join(','));
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${b.name}_price_batch.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported','success');
}

/* ---------- Render ---------- */
function render(){
  const filter = els.search.value.trim().toLowerCase();
  els.tbody.innerHTML = '';
  const sorted = batches.slice().sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''));
  let shown = 0;
  sorted.forEach(b=>{
    if(filter && !b.name.toLowerCase().includes(filter)) return;
    shown++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="rowchk" data-id="${b.id}"></td>
      <td><button class="link-btn open" data-id="${b.id}" title="Open">${escapeHtml(b.name)}</button></td>
      <td>${escapeHtml(formatTime(b.updatedAt))}</td>
      <td>${b.lines.length}</td>
      <td class="actions">
        <button class="secondary dup" data-id="${b.id}" title="Duplicate">Dupe</button>
        <button class="secondary exp" data-id="${b.id}" title="Quick Export">Export</button>
        <button class="danger del" data-id="${b.id}" title="Delete">🗑️</button>
      </td>
    `;
    els.tbody.appendChild(tr);
  });
  if(!shown){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5" class="empty">No batches found.</td>`;
    els.tbody.appendChild(tr);
  }
  updateSummary();
  updateBulkDeleteState();
}

function updateSummary(){
  els.summary.textContent = `${batches.length} total batch(es)`;
}

function selectedIds(){
  return [...document.querySelectorAll('.rowchk:checked')].map(c=>c.dataset.id);
}
function updateBulkDeleteState(){
  els.delSelected.disabled = selectedIds().length === 0;
}

/* ---------- Events ---------- */
// click on “Create” button
els.createBtn.addEventListener('click', () => {
  const name = els.newName.value.trim();
  if (!name) { toast('Enter a batch name','error'); return; }
  const b = createBatch(name);
  if (b) {
    els.newName.value = '';
    location.href = `sales_batches.html?batch=${b.id}`;   // open new batch
  }
});

/* ⇢ NEW: hit Enter inside the new‑batch field */
els.newName.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();          // stop the form from submitting / reloading
  els.createBtn.click();       // reuse the regular create logic
});

els.search.addEventListener('input', render);

els.chkAll.addEventListener('change', ()=>{
  const on = els.chkAll.checked;
  document.querySelectorAll('.rowchk').forEach(c=> c.checked = on);
  updateBulkDeleteState();
});

els.delSelected.addEventListener('click', ()=>{
  deleteSelected(selectedIds());
  els.chkAll.checked = false;
});

/* delegate row actions */
els.tbody.addEventListener('click', e=>{
  const btn = e.target.closest('button');
  if(!btn) return;
  const id = btn.dataset.id;
  if(btn.classList.contains('open')){
    location.href = `sales_batches.html?batch=${id}`;
  } else if(btn.classList.contains('dup')){
    duplicateBatch(id);
  } else if(btn.classList.contains('exp')){
    quickExport(id);
  } else if(btn.classList.contains('del')){
    if(confirm('Delete this batch?')){
      deleteBatch(id);
      toast('Deleted','success');
      render();
    }
  }
});

els.tbody.addEventListener('change', e=>{
  if(e.target.classList.contains('rowchk')){
    updateBulkDeleteState();
  }
});

/* ---------- Create‑from‑List flow ---------- */
document.getElementById('btnCreateFromList').addEventListener('click', async ()=>{
  try{
    selSimple.innerHTML = '<option>Loading…</option>';
    open(modalPick);
    // 1) fetch *all* simple‑lists
    const res  = await fetch(COUNTS_API, {cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    const lists = await res.json();                 // { listName: {…} }
    const names = Object.keys(lists);
    if(!names.length){
      selSimple.innerHTML = '<option>(no lists found)</option>'; return;
    }
    selSimple.innerHTML = names.map(n=>`<option value="${n}">${n}</option>`).join('');
  }catch(err){
    toast('Could not fetch lists','error');
    close(modalPick);
  }
});

document.getElementById('confirmPickList').addEventListener('click', async ()=>{
  const listName = selSimple.value;
  if(!listName) return;
  try{
    // 2) fetch that specific list
    const res = await fetch(`${COUNTS_API}/${encodeURIComponent(listName)}`,{cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();   // { items:{ upc:{code,brand,description,price} … } }
    const lines = Object.values(data.items||{}).map(it=>({
      recordType:'REG',
      upc: it.code,
      brand: it.brand || '',
      description: it.description || '',
      regPrice: it.price ?? '',
      promoPrice:'', promoQty:'', startDate:'', endDate:''
    }));
    if(!lines.length){ toast('List is empty','error'); return; }

    // 3) create batch with those lines
    const batch = createBatch(listName);
    if(!batch) return;
    batch.lines = lines;
    saveLocal();

    close(modalPick);
    location.href = `sales_batches.html?batch=${batch.id}`;
  }catch(e){
    toast('Failed to import list','error');
  }
});

/* ---------- Init ---------- */
function init(){
  loadLocal();
  render();
}
init();

/* ------------------------------ */
/* Refresh list when you come back */
/* ------------------------------ */
window.addEventListener('pageshow', () => {
  loadLocal();
  render();
});
