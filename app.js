/* ═══════════════════════════════════════
   AILO VIVI NOTE — app.js 🌸
   Full Application Logic
═══════════════════════════════════════ */

'use strict';

/* ════════════════════════════════════════
   DATA STORE — IndexedDB (utama) + localStorage (fallback)
════════════════════════════════════════ */

/* ── IndexedDB setup ── */
let _idb = null;
const IDB_NAME    = 'AiloViviNote';
const IDB_VERSION = 1;
const IDB_STORE   = 'kv';

function openIDB() {
  return new Promise((resolve, reject) => {
    if (_idb) { resolve(_idb); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'k' });
      }
    };
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror   = () => reject(req.error);
  });
}

/* ── Async IDB helpers ── */
async function idbSet(k, v) {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ k, v });
      tx.oncomplete = () => res(true);
      tx.onerror    = () => rej(tx.error);
    });
  } catch { return false; }
}

async function idbGet(k) {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(k);
      req.onsuccess = () => res(req.result ? req.result.v : undefined);
      req.onerror   = () => rej(req.error);
    });
  } catch { return undefined; }
}

async function idbDel(k) {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(k);
      tx.oncomplete = () => res(true);
      tx.onerror    = () => rej(tx.error);
    });
  } catch { return false; }
}

async function idbGetAll() {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => rej(req.error);
    });
  } catch { return []; }
}

/* ── Sinkronisasi: salin localStorage lama → IndexedDB ── */
async function migrateFromLocalStorage() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('avn_')) keys.push(k.slice(4));
  }
  for (const k of keys) {
    const existing = await idbGet(k);
    if (existing === undefined) {
      try {
        const raw = localStorage.getItem('avn_' + k);
        if (raw) await idbSet(k, JSON.parse(raw));
      } catch {}
    }
  }
}

/* ── DB — tulis ke IDB + localStorage sekaligus ── */
const DB = {
  get: (k, def = null) => {
    // Sync read dari localStorage (IDB async, dipakai lewat DBAsync)
    try {
      const v = localStorage.getItem('avn_' + k);
      return v ? JSON.parse(v) : def;
    } catch { return def; }
  },
  set: (k, v) => {
    // Tulis ke localStorage (sync, langsung)
    try { localStorage.setItem('avn_' + k, JSON.stringify(v)); } catch {}
    // Tulis ke IndexedDB (async, fire-and-forget)
    idbSet(k, v).catch(() => {});
  },
  del: (k) => {
    localStorage.removeItem('avn_' + k);
    idbDel(k).catch(() => {});
  }
};

/* ── Restore dari IndexedDB → localStorage (dipanggil saat app load) ── */
async function restoreFromIDB() {
  try {
    const all = await idbGetAll();
    for (const { k, v } of all) {
      // Hanya restore kalau localStorage kosong untuk key ini
      if (!localStorage.getItem('avn_' + k)) {
        localStorage.setItem('avn_' + k, JSON.stringify(v));
      }
    }
  } catch {}
}

/* ════════════════════════════════════════
   EXPORT / IMPORT BACKUP DATA
════════════════════════════════════════ */
const BACKUP_KEYS = ['schedules', 'plans', 'notes', 'transactions', 'categories'];

function exportData() {
  const backup = {
    _app:      'AiloViviNote',
    _version:  1,
    _exported: new Date().toISOString(),
  };
  BACKUP_KEYS.forEach(k => {
    backup[k] = DB.get(k, []);
  });

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `AiloViviNote_backup_${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📦 Backup berhasil diunduh!');
}

function importData() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text   = await file.text();
      const backup = JSON.parse(text);
      if (backup._app !== 'AiloViviNote') {
        showToast('❌ File backup tidak valid!'); return;
      }
      if (!confirm(`📦 Import data dari backup ${backup._exported?.slice(0,10) || '?'}?\nData saat ini TIDAK akan dihapus, data backup akan digabungkan.`)) return;

      BACKUP_KEYS.forEach(k => {
        if (!Array.isArray(backup[k])) return;
        const existing = DB.get(k, []);
        // Gabungkan, hindari duplikat berdasarkan id
        const existingIds = new Set(existing.map(x => x.id));
        const merged = [...existing, ...backup[k].filter(x => !existingIds.has(x.id))];
        DB.set(k, merged);
      });

      showToast('✅ Data berhasil diimport! 🎉');
      loadHome(); loadFinance(); loadPlans();
      renderCategoryList(); populateCatSelect();
    } catch (err) {
      showToast('❌ Gagal import: file rusak atau bukan JSON valid');
    }
  };
  input.click();
}

/* ════ DEFAULT CATEGORIES ════ */
const DEFAULT_CATEGORIES = [
  { id: 'cat_1', emoji: '🍽️', name: 'Makan & Minum',    isDefault: true },
  { id: 'cat_2', emoji: '🚗', name: 'Transportasi',      isDefault: true },
  { id: 'cat_3', emoji: '🛒', name: 'Belanja',           isDefault: true },
  { id: 'cat_4', emoji: '💊', name: 'Kesehatan',         isDefault: true },
  { id: 'cat_5', emoji: '🎮', name: 'Hiburan',           isDefault: true },
  { id: 'cat_6', emoji: '📚', name: 'Pendidikan',        isDefault: true },
  { id: 'cat_7', emoji: '💼', name: 'Gaji / Pendapatan', isDefault: true },
  { id: 'cat_8', emoji: '🎁', name: 'Hadiah',            isDefault: true },
  { id: 'cat_9', emoji: '💰', name: 'Lainnya',           isDefault: true },
];

function getCategories() {
  const saved = DB.get('categories');
  if (!saved) {
    DB.set('categories', DEFAULT_CATEGORIES);
    return DEFAULT_CATEGORIES;
  }
  return saved;
}

function addCategory() {
  const emojiEl = document.getElementById('inp-new-cat-emoji');
  const nameEl  = document.getElementById('inp-new-cat');
  const emoji   = emojiEl.value.trim() || '💡';
  const name    = nameEl.value.trim();
  if (!name) { showToast('⚠️ Tulis nama kategori dulu!'); return; }

  const cats = getCategories();
  if (cats.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast('⚠️ Kategori sudah ada!'); return;
  }

  cats.push({ id: 'cat_' + uid(), emoji, name, isDefault: false });
  DB.set('categories', cats);
  emojiEl.value = '';
  nameEl.value  = '';
  renderCategoryList();
  populateCatSelect();
  showToast('🎉 Kategori ditambahkan!');
}

function deleteCategory(id) {
  const cats = getCategories();
  if (cats.length <= 1) { showToast('⚠️ Minimal harus ada 1 kategori!'); return; }
  const cat = cats.find(c => c.id === id);
  if (!cat) return;
  if (!confirm(`Hapus kategori "${cat.name}"?`)) return;
  DB.set('categories', cats.filter(c => c.id !== id));
  renderCategoryList();
  populateCatSelect();
  showToast('🗑️ Kategori dihapus');
}

function renderCategoryList() {
  const list = document.getElementById('category-list');
  if (!list) return;
  const cats = getCategories();
  if (!cats.length) { list.innerHTML = '<div class="empty-state" style="font-size:0.8rem;padding:12px">Belum ada kategori</div>'; return; }
  list.innerHTML = cats.map(c => `
    <div class="cat-item">
      <span class="cat-item-emoji">${c.emoji}</span>
      <span class="cat-item-name">${c.name}</span>
      <button class="cat-del-btn" onclick="deleteCategory('${c.id}')" title="Hapus">🗑️</button>
    </div>
  `).join('');
}

function populateCatSelect() {
  const sel = document.getElementById('t-cat');
  if (!sel) return;
  const cats = getCategories();
  sel.innerHTML = cats.map(c => `<option value="${c.emoji} ${c.name}">${c.emoji} ${c.name}</option>`).join('');
}

/* ════ SIDEBAR ════ */
function openSidebar() {
  document.getElementById('settings-sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderCategoryList();
  loadSettings();
}

function closeSidebar() {
  document.getElementById('settings-sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ════ UTILITIES ════ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const fmtRp = n => 'Rp ' + Math.abs(n).toLocaleString('id-ID');
const fmtDate = d => new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
const fmtDateShort = d => new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short' });
const todayStr = () => new Date().toISOString().slice(0, 10);

let toastTimer;
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), duration);
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
function overlayClose(e, id) {
  if (e.target === e.currentTarget) closeModal(id);
}

/* ════ SHA-256 PIN HASH ════ */
async function hashPIN(pin) {
  const enc = new TextEncoder().encode(pin + 'ViviSalt2024🌸');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ════════════════════════════════════════
   AUTH — PIN LOGIN
════════════════════════════════════════ */
let pinBuffer = '';

function updatePinDots(prefix, buf) {
  for (let i = 0; i < 6; i++) {
    const d = document.getElementById(prefix + i);
    if (!d) continue;
    d.classList.toggle('filled', i < buf.length);
    d.classList.remove('wrong');
  }
}

function pinPress(digit) {
  if (pinBuffer.length >= 6) return;
  pinBuffer += digit;
  updatePinDots('d', pinBuffer);
  if (pinBuffer.length === 6) setTimeout(() => processPIN(), 300);
}

function pinDel() {
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots('d', pinBuffer);
}

async function processPIN() {
  const savedHash = DB.get('pin_hash');
  if (!savedHash) {
    const h = await hashPIN(pinBuffer);
    DB.set('pin_hash', h);
    showToast('🎉 PIN berhasil disimpan!');
    setTimeout(() => enterApp(), 400);
    return;
  }
  const h = await hashPIN(pinBuffer);
  if (h === savedHash) {
    enterApp();
  } else {
    for (let i = 0; i < 6; i++) {
      const d = document.getElementById('d' + i);
      if (d) d.classList.add('wrong');
    }
    document.getElementById('pin-hint').textContent = '❌ PIN salah, coba lagi';
    setTimeout(() => {
      pinBuffer = '';
      updatePinDots('d', pinBuffer);
      document.getElementById('pin-hint').textContent = '🔑 Masukkan PIN kamu';
    }, 1000);
  }
}

/* ════ NEW PIN (Change PIN) ════ */
let npBuf = '';
let npStep = 'enter';
let npFirst = '';

function npPress(d) {
  if (npBuf.length >= 6) return;
  npBuf += d;
  updatePinDots('np', npBuf);
  if (npBuf.length === 6) setTimeout(() => processNP(), 300);
}

function npDel() {
  npBuf = npBuf.slice(0, -1);
  updatePinDots('np', npBuf);
}

async function processNP() {
  if (npStep === 'enter') {
    npFirst = npBuf; npBuf = ''; npStep = 'confirm';
    document.getElementById('np-hint').textContent = '🔄 Konfirmasi PIN baru';
    updatePinDots('np', npBuf);
  } else {
    if (npBuf === npFirst) {
      const h = await hashPIN(npBuf);
      DB.set('pin_hash', h);
      closeModal('modal-newpin');
      showToast('✅ PIN berhasil diubah! 🎉');
      npBuf = ''; npFirst = ''; npStep = 'enter';
      updatePinDots('np', '');
      document.getElementById('np-hint').textContent = 'Masukkan PIN baru (6 digit)';
    } else {
      document.getElementById('np-hint').textContent = '❌ PIN tidak cocok, mulai ulang';
      npBuf = ''; npFirst = ''; npStep = 'enter';
      updatePinDots('np', '');
    }
  }
}

/* ════ FINGERPRINT (WebAuthn) ════ */
async function doFingerprint() {
  const credId = DB.get('fp_cred_id');
  if (!credId) { showToast('⚠️ Daftarkan sidik jari dulu di Pengaturan!'); return; }
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: new Uint8Array(32).map(() => Math.random() * 256),
        rpId: location.hostname || 'localhost',
        allowCredentials: [{ type: 'public-key', id: Uint8Array.from(atob(credId), c => c.charCodeAt(0)) }],
        userVerification: 'required', timeout: 60000
      }
    });
    if (assertion) enterApp();
  } catch (e) {
    showToast('❌ Sidik jari gagal: ' + (e.message || 'Coba lagi'));
  }
}

async function doRegisterFP() {
  if (!window.PublicKeyCredential) { showToast('❌ Browser tidak mendukung WebAuthn'); return; }
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(32).map(() => Math.random() * 256),
        rp: { name: 'Ailo Vivi Note', id: location.hostname || 'localhost' },
        user: { id: new Uint8Array(16), name: 'vivi', displayName: 'Vivi 🌸' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { userVerification: 'required' }, timeout: 60000
      }
    });
    if (cred) {
      const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      DB.set('fp_cred_id', credId);
      document.getElementById('fp-btn').style.display = 'flex';
      showToast('✅ Sidik jari berhasil didaftarkan! 👆');
    }
  } catch (e) {
    showToast('❌ Gagal: ' + (e.message || 'Coba lagi'));
  }
}

async function enterApp() {
  await restoreFromIDB();
  await migrateFromLocalStorage();
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  pinBuffer = '';
  updatePinDots('d', '');
  initApp();
}

function doLogout() {
  if (!confirm('Keluar dari aplikasi?')) return;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  pinBuffer = '';
  updatePinDots('d', '');
  document.getElementById('pin-hint').textContent = '🔑 Masukkan PIN kamu';
}

/* ════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════ */
const PAGE_IDS = { home: 'page-home', plans: 'page-plans', finance: 'page-finance', ai: 'page-ai' };
const NAV_IDS  = { home: 'bn-home', plans: 'bn-plans', finance: 'bn-finance', ai: 'bn-ai' };
let currentPage = 'home';

function navigateTo(page) {
  if (page === 'settings') { openSidebar(); return; }

  Object.values(PAGE_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  Object.values(NAV_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  const pageEl = document.getElementById(PAGE_IDS[page]);
  const navEl  = document.getElementById(NAV_IDS[page]);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');
  currentPage = page;

  if (page === 'home')    loadHome();
  if (page === 'plans')   loadPlans();
  if (page === 'finance') loadFinance();
  if (page === 'ai')      checkAIKey();
}

/* ════════════════════════════════════════
   APP INIT
════════════════════════════════════════ */
function initApp() {
  // Set halaman & nav home aktif dulu
  Object.values(PAGE_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  Object.values(NAV_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const homeEl = document.getElementById('page-home');
  const homeNav = document.getElementById('bn-home');
  if (homeEl)  homeEl.classList.add('active');
  if (homeNav) homeNav.classList.add('active');
  currentPage = 'home';

  // Init semua
  setHeroDate();
  initEmojiPicker();
  renderCalendar();
  setDefaultDates();
  populateCatSelect();
  loadHome();
  loadFinance();
  startAlarmWatcher();

  const fpBtn = document.getElementById('fp-btn');
  if (fpBtn) fpBtn.style.display = DB.get('fp_cred_id') ? 'flex' : 'none';
}

function setHeroDate() {
  const now = new Date();
  const days   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const greets = now.getHours() < 11 ? 'Selamat Pagi' : now.getHours() < 15 ? 'Selamat Siang' : now.getHours() < 18 ? 'Selamat Sore' : 'Selamat Malam';
  const el  = document.getElementById('hero-greeting');
  const el2 = document.getElementById('hero-date');
  if (el)  el.textContent  = `${greets}, Vivi! 🌸`;
  if (el2) el2.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} ✨`;
}

function setDefaultDates() {
  const today = todayStr();
  ['p-date', 't-date'].forEach(id => { const e = document.getElementById(id); if (e) e.value = today; });
}

/* ════════════════════════════════════════
   HOME — SCHEDULES
════════════════════════════════════════ */
const ROUTINE_EMOJIS = [
  '🌅','🍳','☕','🥗','🏃','💪','📚','🧘','🛁','😴',
  '💊','🎵','🎨','📱','💻','🛒','🍽️','🏠','🚗','✈️',
  '🌸','💕','⭐','🌈','🎯','🔔','💝','🌙','☀️','🌷',
  '🐱','🦄','🎀','🍭','🧁','🌺','🦋','🎮','📺','🍎',
  '🏋️','🚴','🤸','🧹','🧺','🛋️','🍵','🥛','🥐','🍰',
];

let selectedEmoji = '🌸';

function initEmojiPicker() {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  ROUTINE_EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emj-btn';
    btn.textContent = e;
    btn.onclick = () => {
      selectedEmoji = e;
      document.getElementById('sel-emoji').textContent = e;
      grid.querySelectorAll('.emj-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
    grid.appendChild(btn);
  });
}

function loadHome() {
  const schedules = DB.get('schedules', []);
  const list = document.getElementById('sched-list');
  if (!list) return;

  const done       = schedules.filter(s => s.doneToday).length;
  const alarmCount = schedules.filter(s => s.alarm).length;
  document.getElementById('stat-total').textContent = schedules.length;
  document.getElementById('stat-done').textContent  = done;
  document.getElementById('stat-alarm').textContent = alarmCount;

  if (!schedules.length) {
    list.innerHTML = '<div class="empty-state">🌸 Belum ada jadwal. Yuk tambah!</div>';
    return;
  }

  const repeatMap = { once:'Sekali', daily:'Setiap hari', weekdays:'Hari kerja', weekend:'Akhir pekan' };
  list.innerHTML = schedules.map(s => `
    <div class="sched-item ${s.doneToday ? 'done' : ''}">
      <div class="sched-emoji">${s.emoji}</div>
      <div class="sched-info">
        <div class="sched-name">${s.title}</div>
        <div class="sched-meta">⏰ ${s.time || '--:--'} · 🔁 ${repeatMap[s.repeat] || s.repeat}${s.alarm ? ' · 🔔' : ''}</div>
      </div>
      <div class="sched-actions">
        <button class="sched-btn done-btn" onclick="toggleDone('${s.id}')" title="${s.doneToday ? 'Batal selesai' : 'Tandai selesai'}">${s.doneToday ? '↩️' : '✅'}</button>
        <button class="sched-btn del-btn" onclick="delSched('${s.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

function openModal_sched() {
  selectedEmoji = '🌸';
  document.getElementById('sel-emoji').textContent = '🌸';
  document.getElementById('s-title').value = '';
  document.getElementById('s-time').value  = '';
  document.getElementById('s-alarm').checked = false;
  document.getElementById('emoji-grid').querySelectorAll('.emj-btn').forEach(b => b.classList.remove('active'));
  openModal('modal-sched');
}

function saveSched() {
  const title  = document.getElementById('s-title').value.trim();
  const time   = document.getElementById('s-time').value;
  const repeat = document.getElementById('s-repeat').value;
  const alarm  = document.getElementById('s-alarm').checked;
  if (!title) { showToast('⚠️ Isi nama kegiatan dulu ya!'); return; }

  const schedules = DB.get('schedules', []);
  schedules.push({ id: uid(), title, emoji: selectedEmoji, time, repeat, alarm, doneToday: false, createdAt: Date.now() });
  DB.set('schedules', schedules);
  closeModal('modal-sched');
  loadHome();
  showToast('🎉 Jadwal berhasil ditambahkan!');
}

function toggleDone(id) {
  const schedules = DB.get('schedules', []);
  const i = schedules.findIndex(s => s.id === id);
  if (i > -1) { schedules[i].doneToday = !schedules[i].doneToday; DB.set('schedules', schedules); loadHome(); }
}

function delSched(id) {
  if (!confirm('Hapus jadwal ini?')) return;
  DB.set('schedules', DB.get('schedules', []).filter(x => x.id !== id));
  loadHome(); showToast('🗑️ Jadwal dihapus');
}

window.openModal = function(id) {
  if (id === 'modal-sched') { openModal_sched(); return; }
  document.getElementById(id).classList.remove('hidden');
};

/* ════════════════════════════════════════
   PLANS — CALENDAR
════════════════════════════════════════ */
let calDate = new Date();
let selDate = todayStr();

function renderCalendar() {
  const y = calDate.getFullYear(), m = calDate.getMonth();
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  document.getElementById('cal-lbl').textContent = `${months[m]} ${y}`;

  const plans    = DB.get('plans', []);
  const hasDates = new Set(plans.map(p => p.date));
  const first    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today    = todayStr();

  let html = '';
  for (let i = 0; i < first; i++) html += '<div class="cal-day other-month"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr  = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday  = dateStr === today;
    const isSel    = dateStr === selDate;
    const hasEvent = hasDates.has(dateStr);
    html += `<div class="cal-day ${isToday?'today':''} ${isSel?'selected':''} ${hasEvent?'has-event':''}"
      onclick="selectCalDate('${dateStr}')">${d}</div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
  updateSelDateLabel();
}

function calPrev() { calDate.setMonth(calDate.getMonth() - 1); renderCalendar(); }
function calNext() { calDate.setMonth(calDate.getMonth() + 1); renderCalendar(); }

function selectCalDate(ds) {
  selDate = ds;
  renderCalendar();
  loadPlansForDate();
}

function updateSelDateLabel() {
  const el = document.getElementById('sel-date-lbl');
  if (!el) return;
  el.textContent = selDate === todayStr() ? 'Hari Ini' : fmtDateShort(selDate);
}

function loadPlans() {
  if (!selDate) selDate = todayStr();
  renderCalendar();
  loadPlansForDate();
  loadNotes();
}

function loadPlansForDate() {
  const plans = DB.get('plans', []).filter(p => p.date === selDate);
  const list  = document.getElementById('plans-list');
  if (!list) return;
  if (!plans.length) { list.innerHTML = '<div class="empty-state">💕 Tidak ada rencana untuk tanggal ini</div>'; return; }
  list.innerHTML = plans.map(p => `
    <div class="plan-item">
      <div class="plan-title">🎯 ${p.title}</div>
      <div class="plan-meta">📅 ${fmtDate(p.date)} ${p.time ? '· ⏰ '+p.time : ''}${p.alarm ? ' · 🔔 Pengingat aktif' : ''}</div>
      ${p.note ? `<div class="plan-note">📝 ${p.note}</div>` : ''}
      <div class="plan-actions">
        <button class="small-del-btn" onclick="delPlan('${p.id}')">🗑️ Hapus</button>
      </div>
    </div>
  `).join('');
}

function savePlan() {
  const title = document.getElementById('p-title').value.trim();
  const note  = document.getElementById('p-note').value.trim();
  const date  = document.getElementById('p-date').value || todayStr();
  const time  = document.getElementById('p-time').value;
  const alarm = document.getElementById('p-alarm').checked;
  if (!title) { showToast('⚠️ Isi nama rencana dulu!'); return; }

  const plans = DB.get('plans', []);
  plans.push({ id: uid(), title, note, date, time, alarm, createdAt: Date.now() });
  DB.set('plans', plans);
  closeModal('modal-plan');
  selDate = date;
  renderCalendar();
  loadPlansForDate();
  showToast('🎉 Rencana berhasil ditambahkan!');
  if (alarm && time) schedulePlanAlarm({ title, date, time });
}

function delPlan(id) {
  if (!confirm('Hapus rencana ini?')) return;
  DB.set('plans', DB.get('plans', []).filter(p => p.id !== id));
  loadPlansForDate(); renderCalendar();
  showToast('🗑️ Rencana dihapus');
}

/* ════ NOTES ════ */
function loadNotes() {
  const notes = DB.get('notes', []);
  const list  = document.getElementById('notes-list');
  if (!list) return;
  if (!notes.length) { list.innerHTML = '<div class="empty-state">✏️ Belum ada catatan</div>'; return; }
  list.innerHTML = notes.map(n => `
    <div class="note-item ${n.color || 'pink'}">
      <div class="note-title">📝 ${n.title}</div>
      <div class="note-content">${n.content.replace(/\n/g,'<br>')}</div>
      <button class="note-del" onclick="delNote('${n.id}')">✕</button>
    </div>
  `).join('');
}

function saveNote() {
  const title   = document.getElementById('n-title').value.trim();
  const content = document.getElementById('n-content').value.trim();
  const color   = document.getElementById('n-color').value;
  if (!title && !content) { showToast('⚠️ Tulis catatan dulu!'); return; }

  const notes = DB.get('notes', []);
  notes.unshift({ id: uid(), title: title || 'Catatan', content, color, createdAt: Date.now() });
  DB.set('notes', notes);
  document.getElementById('n-title').value   = '';
  document.getElementById('n-content').value = '';
  closeModal('modal-note');
  loadNotes();
  showToast('📝 Catatan tersimpan!');
}

function delNote(id) {
  if (!confirm('Hapus catatan ini?')) return;
  DB.set('notes', DB.get('notes', []).filter(n => n.id !== id));
  loadNotes(); showToast('🗑️ Catatan dihapus');
}

/* ════════════════════════════════════════
   FINANCE
════════════════════════════════════════ */
let transType = 'income';
let finFilter_active = 'all';

function setType(type) {
  transType = type;
  document.getElementById('tt-inc').classList.toggle('active', type === 'income');
  document.getElementById('tt-exp').classList.toggle('active', type === 'expense');
}

function loadFinance(filter = finFilter_active) {
  finFilter_active = filter;
  const all   = DB.get('transactions', []);
  const shown = filter === 'all' ? all : all.filter(t => t.type === filter);

  const totalIn  = all.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const totalOut = all.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const bal = totalIn - totalOut;

  document.getElementById('bal-total').textContent = fmtRp(bal);
  document.getElementById('bal-in').textContent    = fmtRp(totalIn);
  document.getElementById('bal-out').textContent   = fmtRp(totalOut);

  const list = document.getElementById('fin-list');
  if (!list) return;
  if (!shown.length) { list.innerHTML = '<div class="empty-state">💰 Belum ada transaksi</div>'; return; }

  list.innerHTML = [...shown].reverse().map(t => {
    const [catEmoji] = (t.category || '💰').split(' ');
    const sign = t.type === 'income' ? '+' : '-';
    return `
      <div class="fin-item">
        <div class="fin-icon">${catEmoji}</div>
        <div class="fin-info">
          <div class="fin-desc">${t.desc || t.category}</div>
          <div class="fin-meta">${fmtDate(t.date)} · ${t.category}</div>
        </div>
        <div class="fin-amount ${t.type}">${sign}${fmtRp(t.amount)}</div>
        <button class="fin-del" onclick="delTransaction('${t.id}')">✕</button>
      </div>
    `;
  }).join('');
}

function finFilter(type, btn) {
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadFinance(type);
}

function saveTransaction() {
  const desc   = document.getElementById('t-desc').value.trim();
  const amount = parseFloat(document.getElementById('t-amount').value);
  const date   = document.getElementById('t-date').value || todayStr();
  const cat    = document.getElementById('t-cat').value;
  if (!amount || isNaN(amount) || amount <= 0) { showToast('⚠️ Masukkan jumlah yang valid!'); return; }

  const tr = DB.get('transactions', []);
  tr.push({ id: uid(), type: transType, desc, amount, date, category: cat, createdAt: Date.now() });
  DB.set('transactions', tr);
  document.getElementById('t-desc').value   = '';
  document.getElementById('t-amount').value = '';
  closeModal('modal-trans');
  loadFinance();
  showToast(transType === 'income' ? '💚 Pemasukan dicatat!' : '❤️ Pengeluaran dicatat!');
}

function delTransaction(id) {
  if (!confirm('Hapus transaksi ini?')) return;
  DB.set('transactions', DB.get('transactions', []).filter(t => t.id !== id));
  loadFinance(); showToast('🗑️ Transaksi dihapus');
}

/* ════════════════════════════════════════
   AI CHAT — BYOK (Groq · Mistral · Cohere)
════════════════════════════════════════ */
let aiProvider = 'groq';
let chatHistory = [];

function pickProvider(prov, btn) {
  aiProvider = prov;
  document.querySelectorAll('.ai-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  checkAIKey();
}

function checkAIKey() {
  const key  = DB.get('key_' + aiProvider);
  const warn = document.getElementById('ai-no-key');
  if (!key) warn.classList.remove('hidden');
  else warn.classList.add('hidden');
}

function appendChatMsg(role, content, isTyping = false) {
  const box = document.getElementById('chat-box');
  const div = document.createElement('div');
  div.className = `chat-msg ${role === 'user' ? 'user' : 'bot'}${isTyping ? ' typing-indicator' : ''}`;
  div.id = isTyping ? 'typing-msg' : '';

  const ava = document.createElement('div');
  ava.className   = 'chat-ava';
  ava.textContent = role === 'user' ? '👩' : '🌸';

  const bub = document.createElement('div');
  bub.className = 'chat-bub';
  if (isTyping) {
    bub.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  } else {
    bub.textContent = content;
  }

  div.appendChild(ava);
  div.appendChild(bub);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}


/* ════ KONTEKS DATA USER UNTUK AI ════ */
function getUserDataContext() {
  const today       = todayStr();
  const schedules   = DB.get('schedules', []);
  const plans       = DB.get('plans', []);
  const notes       = DB.get('notes', []);
  const transactions= DB.get('transactions', []);

  const schedTxt = schedules.length
    ? schedules.map(s => `- ${s.emoji} ${s.title} (jam ${s.time||'-'}, ${s.repeat}, alarm:${s.alarm?'ya':'tidak'}, selesai:${s.doneToday?'ya':'belum'})`).join('\n')
    : 'Tidak ada jadwal.';

  const sortedPlans = [...plans].sort((a,b) => a.date.localeCompare(b.date));
  const planTxt = sortedPlans.length
    ? sortedPlans.map(p => `- [${p.date}${p.date===today?' (HARI INI)':''}] ${p.title}${p.time?' jam '+p.time:''}${p.note?' — '+p.note:''}`).join('\n')
    : 'Tidak ada rencana.';

  const noteTxt = notes.length
    ? notes.map(n => `- [${n.title}]: ${n.content.slice(0,300)}`).join('\n')
    : 'Tidak ada catatan.';

  const totalIn  = transactions.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0);
  const totalOut = transactions.filter(t=>t.type==='expense').reduce((a,t)=>a+t.amount,0);
  const recentTx = [...transactions].sort((a,b)=>b.createdAt-a.createdAt).slice(0,10);
  const txTxt = recentTx.length
    ? recentTx.map(t => `- [${t.date}] ${t.type==='income'?'+':'-'} Rp${t.amount.toLocaleString('id-ID')} | ${t.category} | ${t.desc||'-'}`).join('\n')
    : 'Tidak ada transaksi.';

  return `\n=== DATA PRIBADI USER (HARI INI: ${today}) ===\n\n📋 JADWAL HARIAN (${schedules.length}):\n${schedTxt}\n\n📅 RENCANA (${plans.length}):\n${planTxt}\n\n📝 CATATAN (${notes.length}):\n${noteTxt}\n\n💰 KEUANGAN:\nSaldo: Rp${(totalIn-totalOut).toLocaleString('id-ID')} | Masuk: Rp${totalIn.toLocaleString('id-ID')} | Keluar: Rp${totalOut.toLocaleString('id-ID')}\nTransaksi terakhir:\n${txTxt}\n=== AKHIR DATA ===\n`;
}

async function sendMsg() {
  const inp  = document.getElementById('chat-in');
  const text = inp.value.trim();
  if (!text) return;

  const key = DB.get('key_' + aiProvider);
  if (!key) { showToast('⚠️ Tambahkan API key dulu di Pengaturan!'); return; }

  inp.value = '';
  appendChatMsg('user', text);
  chatHistory.push({ role: 'user', content: text });
  const typingEl = appendChatMsg('bot', '', true);

  try {
    let reply = '';
    if (aiProvider === 'groq')         reply = await callGroq(key, chatHistory);
    else if (aiProvider === 'mistral') reply = await callMistral(key, chatHistory);
    else if (aiProvider === 'cohere')  reply = await callCohere(key, chatHistory);
    typingEl.remove();
    appendChatMsg('bot', reply);
    chatHistory.push({ role: 'assistant', content: reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  } catch (e) {
    typingEl.remove();
    appendChatMsg('bot', '❌ Error: ' + (e.message || 'Terjadi kesalahan. Coba lagi.'));
  }
}

async function callGroq(key, history) {
  const sysContent = `Kamu adalah Vivi, asisten AI pribadi yang sangat cerdas dan membantu. Kamu punya akses penuh ke semua data user: jadwal, rencana, catatan, dan keuangan. WAJIB gunakan data ini untuk menjawab secara spesifik. Jangan bilang tidak bisa lihat data. Jawab dalam bahasa Indonesia santai dengan emoji secukupnya.` + getUserDataContext();
  const systemMsg = { role: 'system', content: sysContent };
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [systemMsg, ...history], max_tokens: 1500, temperature: 0.7 })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Groq API error'); }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callMistral(key, history) {
  const sysContent = `Kamu adalah Vivi, asisten AI pribadi yang sangat cerdas dan membantu. Kamu punya akses penuh ke semua data user: jadwal, rencana, catatan, dan keuangan. WAJIB gunakan data ini untuk menjawab secara spesifik. Jawab dalam bahasa Indonesia santai dengan emoji secukupnya.` + getUserDataContext();
  const systemMsg = { role: 'system', content: sysContent };
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'mistral-small-latest', messages: [systemMsg, ...history], max_tokens: 1500, temperature: 0.7 })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Mistral API error'); }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callCohere(key, history) {
  const msgs = [
    { role: 'system', content: `Kamu adalah Vivi, asisten AI pribadi yang sangat cerdas dan membantu. Kamu punya akses penuh ke semua data user: jadwal, rencana, catatan, dan keuangan. WAJIB gunakan data ini untuk menjawab secara spesifik. Jawab dalam bahasa Indonesia santai dengan emoji secukupnya.` + getUserDataContext() },
    ...history
  ];
  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'X-Client-Name': 'AiloViviNote' },
    body: JSON.stringify({ model: 'command-r-plus-08-2024', messages: msgs, max_tokens: 1500 })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Cohere API error'); }
  const data = await res.json();
  return data.message?.content?.[0]?.text || data.text || '(Tidak ada balasan)';
}

/* ════════════════════════════════════════
   SETTINGS
════════════════════════════════════════ */
function loadSettings() {
  ['groq', 'mistral', 'cohere'].forEach(p => {
    const key      = DB.get('key_' + p);
    const statusEl = document.getElementById(p + '-status');
    const inp      = document.getElementById('inp-' + p);
    if (key) {
      if (inp)      inp.placeholder = '••••••••••••• (tersimpan)';
      if (statusEl) statusEl.textContent = '✅ API Key tersimpan';
    } else {
      if (statusEl) statusEl.textContent = '';
    }
  });
}

function saveApiKey(prov) {
  const inp = document.getElementById('inp-' + prov);
  const val = inp.value.trim();
  if (!val) { showToast('⚠️ Masukkan API key dulu!'); return; }
  DB.set('key_' + prov, val);
  inp.value = '';
  inp.placeholder = '••••••••••••• (tersimpan)';
  document.getElementById(prov + '-status').textContent = '✅ API Key tersimpan';
  showToast(`✅ ${prov.charAt(0).toUpperCase()+prov.slice(1)} API key disimpan!`);
  checkAIKey();
}

async function clearAllData() {
  if (!confirm('⚠️ Yakin hapus SEMUA data? Ini tidak bisa dibatalkan!')) return;
  if (!confirm('🚨 Ini akan menghapus semua jadwal, rencana, catatan, dan keuangan. Lanjutkan?')) return;
  const pin = DB.get('pin_hash');
  const fp  = DB.get('fp_cred_id');
  // Hapus localStorage
  localStorage.clear();
  // Hapus IndexedDB
  try {
    const db  = await openIDB();
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
  } catch {}
  // Restore PIN & fingerprint
  if (pin) DB.set('pin_hash', pin);
  if (fp)  DB.set('fp_cred_id', fp);
  showToast('🗑️ Semua data berhasil dihapus');
  loadHome(); loadFinance(); loadSettings();
  renderCategoryList(); populateCatSelect();
  renderCalendar();
}

/* ════════════════════════════════════════
   ALARM SYSTEM 🔔
════════════════════════════════════════ */
let alarmTimers = [];

function startAlarmWatcher() {
  checkAllAlarms();
  setInterval(checkAllAlarms, 30000);
}

function checkAllAlarms() {
  alarmTimers.forEach(t => clearTimeout(t));
  alarmTimers = [];

  const now   = new Date();
  const plans = DB.get('plans', []);

  plans.filter(p => p.alarm && p.time && p.date >= todayStr()).forEach(p => {
    const alarmDT = new Date(p.date + 'T' + p.time);
    const diff    = alarmDT.getTime() - now.getTime();
    if (diff > 0 && diff < 86400000) {
      alarmTimers.push(setTimeout(() => fireAlarm(p), diff));
      document.getElementById('alarm-indicator').style.display = 'flex';
    }
  });

  const schedules = DB.get('schedules', []).filter(s => s.alarm && s.time);
  schedules.forEach(s => {
    const [h, m] = s.time.split(':').map(Number);
    const alarmDT = new Date();
    alarmDT.setHours(h, m, 0, 0);
    if (alarmDT <= now) alarmDT.setDate(alarmDT.getDate() + 1);
    const diff = alarmDT.getTime() - now.getTime();
    if (diff < 86400000) {
      alarmTimers.push(setTimeout(() => fireScheduleAlarm(s), diff));
      document.getElementById('alarm-indicator').style.display = 'flex';
    }
  });
}

function fireAlarm(plan) {
  const msg = `Vivi... Vivi... Tanggal ${fmtDate(plan.date)}, kamu punya rencana: ${plan.title}! 🌸`;
  showAlarmPopup(`🎯 ${plan.title}`, msg);
  speakAlarm(msg);
}

function fireScheduleAlarm(sched) {
  const msg = `Vivi... Vivi... Waktunya ${sched.title}! ${sched.emoji} Jangan lupa ya sayang!`;
  showAlarmPopup(`${sched.emoji} ${sched.title}`, msg);
  speakAlarm(msg);
}

function schedulePlanAlarm(plan) { checkAllAlarms(); }

function showAlarmPopup(title, msg) {
  document.getElementById('alarm-title').textContent = title;
  document.getElementById('alarm-msg').textContent   = msg;
  document.getElementById('alarm-popup').classList.remove('hidden');
}

function dismissAlarm() {
  document.getElementById('alarm-popup').classList.add('hidden');
  window.speechSynthesis && window.speechSynthesis.cancel();
}

function speakAlarm(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const say = (t, delay = 0) => {
    setTimeout(() => {
      const utt = new SpeechSynthesisUtterance(t);
      utt.lang = 'id-ID'; utt.rate = 0.85; utt.pitch = 1.2; utt.volume = 1;
      const voices  = window.speechSynthesis.getVoices();
      const idVoice = voices.find(v => v.lang.startsWith('id')) || voices.find(v => v.lang.startsWith('ms')) || voices[0];
      if (idVoice) utt.voice = idVoice;
      window.speechSynthesis.speak(utt);
    }, delay);
  };
  say('Vivi... Vivi...', 0);
  say(text, 1800);
  say(text, 4000);
}

/* ════════════════════════════════════════
   INIT ON PAGE LOAD
════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {

  // ── 1. Restore data dari IndexedDB → localStorage (jika localStorage kosong) ──
  await restoreFromIDB();
  // ── 2. Migrasi data localStorage lama → IndexedDB (sekali saja) ──
  await migrateFromLocalStorage();

  // ── 3. Cek PIN & fingerprint ──
  const hasPin = DB.get('pin_hash');
  if (!hasPin) document.getElementById('pin-hint').textContent = '🌸 Buat PIN baru kamu (6 digit)';
  if (DB.get('fp_cred_id')) document.getElementById('fp-btn').style.display = 'flex';
  else document.getElementById('fp-btn').style.display = 'none';

  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {};
  }

  // ── 4. Expose ke global scope ──
  window.pinPress         = pinPress;
  window.pinDel           = pinDel;
  window.doFingerprint    = doFingerprint;
  window.doLogout         = doLogout;
  window.navigateTo       = navigateTo;
  window.overlayClose     = overlayClose;
  window.closeModal       = (id) => document.getElementById(id).classList.add('hidden');
  window.calPrev          = calPrev;
  window.calNext          = calNext;
  window.selectCalDate    = selectCalDate;
  window.toggleDone       = toggleDone;
  window.delSched         = delSched;
  window.saveSched        = saveSched;
  window.savePlan         = savePlan;
  window.delPlan          = delPlan;
  window.saveNote         = saveNote;
  window.delNote          = delNote;
  window.setType          = setType;
  window.saveTransaction  = saveTransaction;
  window.delTransaction   = delTransaction;
  window.finFilter        = finFilter;
  window.pickProvider     = pickProvider;
  window.sendMsg          = sendMsg;
  window.saveApiKey       = saveApiKey;
  window.doRegisterFP     = doRegisterFP;
  window.clearAllData     = clearAllData;
  window.dismissAlarm     = dismissAlarm;
  window.npPress          = npPress;
  window.npDel            = npDel;
  window.openSidebar      = openSidebar;
  window.closeSidebar     = closeSidebar;
  window.addCategory      = addCategory;
  window.deleteCategory   = deleteCategory;
  window.exportData       = exportData;
  window.importData       = importData;
});
