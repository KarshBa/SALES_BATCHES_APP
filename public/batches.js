// public/batches.js
import { loadAllBatches, saveAllBatches, makeId, exportCsvFromBatch, toast } from './shared_batch_lib.js';

/** DOM refs */
const listEl      = document.getElementById('batchList');
const filterInput = document.getElementById('filterBatches');
const emptyNote   = document.getElementById('emptyNote');

const modalOverlay = document.getElementById('modalOverlay');
const modalCreate  = document.getElementById('modalCreate');
const createName   = document.getElementById('createName');

document.getElementById('btnNewBatch').onclick = () => openModal(modalCreate, () => {
  createName.value = suggestName();
  createName.focus();
});

document.getElementById('createConfirm').onclick = () => {
  const name = createName.value.trim();
  if(!name) { createName.focus(); return; }
  const batches = loadAllBatches();
  if(batches.some(b=>b.name.toLowerCase()===name.toLowerCase())){
    toast('Name already exists','error');
    return;
  }
  const batch = {
    id: makeId(),
    name,
    lines: [],
    updatedAt: new Date().toISOString()
  };
  batches.push(batch);
  saveAllBatches(batches);
  closeModal(modalCreate);
  toast('Batch created');
  render();
  // navigate to edit page
  window.location = `sales_batches.html?batch=${encodeURIComponent(batch.id)}`;
};

modalOverlay.addEventListener('click', () => closeModal(document.querySelector('.modal:not(.hidden)')));
document.querySelectorAll('.close-modal').forEach(btn=>{
  btn.addEventListener('click', e=>{
    const sel = btn.getAttribute('data-close');
    closeModal(document.querySelector(sel));
  });
});

filterInput.addEventListener('input', render);

function suggestName(){
  const d = new Date();
  const pad = n=>String(n).padStart(2,'0');
  return `Batch_${d.getFullYear()}_${pad(d.getMonth()+1)}_${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function openModal(modal, beforeFocus){
  modalOverlay.classList.remove('hidden');
  modal.classList.remove('hidden');
  beforeFocus && beforeFocus();
}

function closeModal(modal){
  modalOverlay.classList.add('hidden');
  modal.classList.add('hidden');
}

function render(){
  const batches = loadAllBatches().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const term = filterInput.value.trim().toLowerCase();
  const filtered = term
     ? batches.filter(b=>b.name.toLowerCase().includes(term))
     : batches;
  listEl.innerHTML = '';
  if(!filtered.length){
    emptyNote.classList.remove('hidden');
    return;
  }
  emptyNote.classList.add('hidden');
  filtered.forEach(b=>{
    const lines = b.lines.length;
    const updated = new Date(b.updatedAt||Date.now()).toLocaleString();
    const card = document.createElement('div');
    card.className='batch-card';
    card.innerHTML = `
      <h3>${escapeHtml(b.name)}</h3>
      <div class="batch-meta">${lines} line${lines!==1?'s':''}<br>${updated}</div>
      <div class="batch-actions">
        <button data-act="open" data-id="${b.id}">Open</button>
        <button class="secondary" data-act="dup" data-id="${b.id}">Duplicate</button>
        <button class="secondary" data-act="exp" data-id="${b.id}">Export</button>
        <button class="danger" data-act="del" data-id="${b.id}">Delete</button>
      </div>
    `;
    listEl.appendChild(card);
  });
}

listEl.addEventListener('click', e=>{
  const btn = e.target.closest('button[data-act]');
  if(!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const batches = loadAllBatches();
  const idx = batches.findIndex(b=>b.id===id);
  if(idx===-1) return;

  if(act==='open'){
    window.location = `sales_batches.html?batch=${encodeURIComponent(id)}`;
  }else if(act==='dup'){
    const orig = batches[idx];
    const clone = {
      ...orig,
      id: makeId(),
      name: orig.name + '_copy',
      updatedAt: new Date().toISOString()
    };
    batches.push(clone);
    saveAllBatches(batches);
    toast('Batch duplicated');
    render();
  }else if(act==='del'){
    if(!confirm('Delete this batch?')) return;
    batches.splice(idx,1);
    saveAllBatches(batches);
    toast('Deleted');
    render();
  }else if(act==='exp'){
    const csv = exportCsvFromBatch(batches[idx]);
    download(csv, `${sanitizeFileName(batches[idx].name)}_price_batch.csv`);
    toast('Exported CSV');
  }
});

function download(text, filename){
  const blob = new Blob([text],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

/* --- shared small helpers (duplicated or import from shared lib) --- */
function escapeHtml(s){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function sanitizeFileName(n){ return n.replace(/[^A-Za-z0-9._-]+/g,'_'); }

/* Initial */
render();
