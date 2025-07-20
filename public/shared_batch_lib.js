// public/shared_batch_lib.js

export const LS_KEY = 'priceChangeBatches_v1';

export function loadAllBatches(){
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveAllBatches(arr){
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

export function findBatch(id){
  return loadAllBatches().find(b=>b.id===id);
}

export function upsertBatch(batch){
  const all = loadAllBatches();
  const i = all.findIndex(b=>b.id===batch.id);
  if(i===-1) all.push(batch); else all[i]=batch;
  saveAllBatches(all);
}

export function makeId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

/** Minimal toast (re-used) */
export function toast(msg, type='info'){
  let c = document.getElementById('toastContainer');
  if(!c){
    c = document.createElement('div');
    c.id='toastContainer';
    c.className='toast-container';
    document.body.appendChild(c);
  }
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  c.appendChild(div);
  requestAnimationFrame(()=>div.classList.add('show'));
  setTimeout(()=>{
    div.classList.remove('show');
    setTimeout(()=>div.remove(),300);
  }, 3200);
}

/** CSV export given a batch object (must already be validated externally) */
export function exportCsvFromBatch(batch){
  const header = 'Record Type,UPC,Promo_Price,Promo_Qty,Start_Date,End_Date';
  const rows = batch.lines.map(l=>{
    const promoQty = !l.promoQty || l.promoQty<1 ? 1 : l.promoQty;
    const fields = [
      l.recordType || '',
      l.upc || '',
      l.promoPrice != null ? String(l.promoPrice) : '',
      promoQty,
      l.startDate || '',
      l.endDate || ''
    ];
    return fields.join(',');
  });
  return [header, ...rows].join('\r\n');
}
