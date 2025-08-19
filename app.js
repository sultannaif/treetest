// حالة التطبيق مشتركة عبر الصفحات (localStorage)
const LS_KEY = 'barns-demo-state';
const USER_NAME_KEY = 'barns-user-name';
const SESSION_INIT_KEY = 'barns-session-initialized';
const initialState = { green: 0, gold: 0, streak: 12, leaves: 0, friends: 11 };
const LEAVES_COUNT = 40;
const LEAVES_MAP_KEY = 'barns-leaves-map';
// مؤشرات أوراق محذوفة من العرض والتعبئة
const SKIPPED_LEAF_INDICES = new Set([38, 39]);
// مصفوفة إحداثيات الأوراق (x%, y%) موزعة ومتفرقة حول الشجرة (20 ورقة)
// موزعة على شكل بيضاوي واسع حول مركز الشجرة لنتيجة بصرية أفضل
const LEAF_POSITIONS = [
  {x:33, y:48}, {x:38, y:39}, {x:67, y:57}, {x:65, y:50}, {x:73, y:55},
  {x:28, y:39}, {x:77, y:68}, {x:22, y:46}, {x:82, y:51}, {x:52, y:50},
  {x:55, y:32}, {x:28, y:60}, {x:15, y:52}, {x:13, y:43}, {x:76, y:31},
  {x:39, y:68}, {x:45, y:32}, {x:33, y:31}, {x:67, y:32}, {x:88, y:62},
  // إضافات متنوعة (10 نقاط جديدة)
  {x:79, y:23}, {x:20, y:17}, {x:42, y:23}, {x:52, y:23}, {x:90, y:50},
  {x:85, y:31}, {x:25, y:26}, {x:32, y:21}, {x:15, y:26}, {x:18, y:34},
  // 10 أوراق إضافية (2 منهم leaf1 و 2 منهم leaf10)
  {x:56, y:15},              // idx 30 → variant 1 (افتراضي)
  {x:63, y:10, variant: 1},  // idx 31 → فرض leaf1 إضافي
  {x:30, y:12},              // idx 32 → الافتراضي 3
  {x:46, y:15},              // idx 34 → الافتراضي 5
  {x:64, y:23, variant: 10}, // idx 36 → فرض leaf10 إضافي
  {x:72, y:16},
  {x:39, y:10},
  {x:50, y:6, variant: 10},
];
// زمن صلاحية الورقة الذهبية (مللي ثانية) — 2 دقائق
const GOLD_TTL_MS = 2 * 60 * 1000;
const GOLD_EXP_KEY = 'barns-gold-expiries';
const LAST_LEAF_MS_KEY = 'barns-last-leaf-added-ms';
const INACTIVITY_THRESHOLD_MS = 1 * 60 * 1000; // 1 minute

// بناء مفتاح تخزين مقيّد باسم المستخدم
function scopedKey(base) {
  const name = (userName || '').trim().toLowerCase();
  return name ? `${base}:${encodeURIComponent(name)}` : base;
}
function scopedKeyFor(base, name) {
  const n = (name || '').trim().toLowerCase();
  return n ? `${base}:${encodeURIComponent(n)}` : base;
}
function stateKey(){ return scopedKey(LS_KEY); }
function leavesMapKey(){ return scopedKey(LEAVES_MAP_KEY); }
function goldExpKey(){ return scopedKey(GOLD_EXP_KEY); }

let qrStream = null; // تيار الكاميرا في صفحة QR
let leafLossInProgress = false;
let userName = loadUserName();
let state = loadState();

// Try to set an <img> source from a list of candidate paths, falling back gracefully
function setImageFromCandidates(imgEl, candidates) {
  if (!imgEl || !Array.isArray(candidates) || candidates.length === 0) return;
  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) return;
    const src = candidates[idx++];
    imgEl.onerror = tryNext;
    imgEl.src = src;
  };
  tryNext();
}

// Build possible people image paths for a first name with common extensions/variants
function buildPeopleImageCandidates(firstName) {
  const base = (firstName || '').trim();
  if (!base) {
    return [
      'imgs/people/person.png',
      'imgs/people/person.jpg',
      'imgs/people/person.jpeg',
      'imgs/people/person.webp',
    ];
  }
  const cap = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  const variants = [base, base.toLowerCase(), base.toUpperCase(), cap];
  const exts = ['.jpeg', '.jpg', '.png', '.webp'];
  const out = [];
  variants.forEach(v => exts.forEach(ext => out.push(`imgs/people/${v}${ext}`)));
  out.push('imgs/people/person.png', 'imgs/people/person.jpg', 'imgs/people/person.jpeg', 'imgs/people/person.webp');
  return out;
}

// عدّ تصاعدي بسيط
function animateCountUp(elementId, targetValue, duration = 900) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const start = performance.now();
  const from = 0;
  const to = Math.max(0, Number(targetValue) || 0);
  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
  function frame(now){
    const progress = Math.min(1, (now - start) / duration);
    const eased = easeOutCubic(progress);
    const current = Math.round(from + (to - from) * eased);
    el.textContent = String(current);
    if (progress < 1) requestAnimationFrame(frame);
  }
  // ابدأ من 0
  el.textContent = '0';
  requestAnimationFrame(frame);
}

document.addEventListener('DOMContentLoaded', () => {
  // Login check
  if (document.body.dataset.page === 'login') {
    mountLoginPage();
  } else {
    if (!userName) {
      window.location.href = 'login.html';
      return;
    }
    fillCounters();
    mountPageSpecific();
  }
});

// Persistence
function loadState() {
  try { return { ...initialState, ...(JSON.parse(localStorage.getItem(stateKey()))||{}) }; }
  catch { return { ...initialState }; }
}
function saveState() { localStorage.setItem(stateKey(), JSON.stringify(state)); }

function markLeafActivityNow(){
  try { localStorage.setItem(scopedKey(LAST_LEAF_MS_KEY), String(Date.now())); } catch {}
}
function readLeafActivity(){
  try { return Number(localStorage.getItem(scopedKey(LAST_LEAF_MS_KEY))||'0'); } catch { return 0; }
}

// User name persistence
function loadUserName() {
  return localStorage.getItem(USER_NAME_KEY) || '';
}
function saveUserName(name) { 
  localStorage.setItem(USER_NAME_KEY, name);
  userName = name;
}

// Reset only tree-related counters (green, gold, leaves)
function resetTreeCounters() {
  state.green = 0;
  state.gold = 0;
  state.leaves = 0;
  saveState();
  try { localStorage.removeItem(leavesMapKey()); } catch {}
  try { localStorage.removeItem(goldExpKey()); } catch {}
}

// Fill counters per current state
function fillCounters() {
  setText('home-green', state.green);
  setText('home-green-count', state.green);
  setText('home-gold-count', state.gold);

  setText('stat-green', state.green);
  // قبل التحديث، صحّح الذهب المنتهي الصلاحية إذا وُجد
  normalizeExpiredGold();
  setText('stat-gold', state.gold);
  setText('stat-total', state.green + state.gold);
  setText('streak', state.streak);
  setText('qr-green', state.green);
  setText('qr-gold', state.gold);
  setText('qr-total', state.green + state.gold);
  setText('card-total', state.green + state.gold);
  setText('friend-green', state.green);
  setText('friend-gold', state.gold);
  setText('friends-count', state.friends);

  // تحديث اسم المستخدم
  setText('user-name', userName);

  // رسم الشجرة بالصور إذا وُجدت لوحة الشجرة، أو ارسم SVG كخيار احتياطي
  const canvas = document.getElementById('treeCanvas');
  if (canvas) {
    drawTreeImages(canvas, state.green, state.gold);
  } else {
    const svg = document.getElementById('treeSVG');
    if (svg) drawTree(svg, state.green + state.gold);
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// تحديد نوع SVG وإحداثيات كل نقطة ثابتة
function computeLeafPosition(i) {
  const base = LEAF_POSITIONS[i % LEAF_POSITIONS.length];
  const variant = base && base.variant ? Number(base.variant) : ((i % 10) + 1);
  return { left: base.x, top: base.y, variant };
}

// Draw tree with images (trunk + leaves)
function drawTreeImages(canvasEl, greenLeavesCount = 0, goldLeavesCount = 0) {
  // اعرض أماكن الأوراق كلها كرمادي أولًا ثم لوّن حسب الخريطة
  renderTreeLeaves(canvasEl);
  const map = syncLeavesMapToCounts(greenLeavesCount, goldLeavesCount);
  applyLeavesMapToCanvas(canvasEl, map);
}

// بناء ترتيب التعبئة المتوازن حول الغصن
function getFillOrderIndices(count = LEAVES_COUNT) {
  const all = Array.from({ length: count }, (_, i) => i);
  return all.filter(i => !SKIPPED_LEAF_INDICES.has(i));
}

// تم استبدالها أعلاه

function renderTreeLeaves(canvasEl) {
  const layer = document.getElementById('treeLayer') || canvasEl;
  const oldLeaves = layer.querySelectorAll('.tree-leaf');
  oldLeaves.forEach(n => n.remove());
  const order = getFillOrderIndices();
  for (let i of order) {
    const pos = computeLeafPosition(i);
    const leaf = document.createElement('div');
    const url = `url('imgs/Tree/leaves/leave${pos.variant}.svg')`;
    leaf.className = 'tree-leaf tree-leaf--empty';
    leaf.dataset.index = String(i);
    leaf.style.left = pos.left + '%';
    leaf.style.top = pos.top + '%';
    // استخدم القناع لتلوين شكل الورقة نفسه
    leaf.style.webkitMaskImage = url;
    leaf.style.maskImage = url;
    layer.appendChild(leaf);
  }
}

function applyLeavesMapToCanvas(canvasEl, map) {
  const layer = document.getElementById('treeLayer') || canvasEl;
  const leaves = layer.querySelectorAll('.tree-leaf');
  leaves.forEach((leaf) => {
    const idx = Number(leaf.dataset.index || '0');
    if (SKIPPED_LEAF_INDICES.has(idx)) { leaf.remove(); return; }
    const status = map[idx] || 'empty';
    leaf.className = 'tree-leaf ' + 'tree-leaf--' + status;
  });
}

// يطابق مصفوفة الذهب المنتهي ويعيد ضبط الحالة والخريطة والعدادات
function normalizeExpiredGold() {
  try {
    const rawExp = localStorage.getItem(goldExpKey());
    const exp = rawExp ? JSON.parse(rawExp) : [];
    let changed = false;
    let map = loadLeavesMap();
    const now = Date.now();
    for (let i = 0; i < map.length; i++) {
      if (map[i] === 'gold') {
        const valid = exp[i] && now < exp[i];
        if (!valid) {
          map[i] = 'green';
          // أنقص عداد الذهب وزد عداد الأخضر بما يتوافق مع الحالة
          if (state.gold > 0) state.gold -= 1;
          state.green += 1;
          changed = true;
        }
      }
    }
    if (changed) {
      saveLeavesMap(map);
      saveState();
    }
  } catch {}
}

function loadLeavesMap() {
  try {
    const raw = localStorage.getItem(leavesMapKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === LEAVES_COUNT) return parsed;
  } catch {}
  return Array.from({ length: LEAVES_COUNT }, () => 'empty');
}

function saveLeavesMap(map) {
  try { localStorage.setItem(leavesMapKey(), JSON.stringify(map)); } catch {}
}

function generateBalancedMap(greenCount, goldCount) {
  const total = Math.min(LEAVES_COUNT, Math.max(0, greenCount + goldCount));
  const map = Array.from({ length: LEAVES_COUNT }, () => 'empty');
  const goldToPlace = Math.min(total, goldCount);
  const goldPositions = getSpreadPositions(total, goldToPlace);
  const order = getFillOrderIndices();
  for (let i = 0; i < total; i++) {
    const canvasIdx = order[i];
    const isGold = goldPositions.has(i);
    map[canvasIdx] = isGold ? 'gold' : 'green';
  }
  // أنشئ مصفوفة صلاحيات الذهب بنفس المواضع
  const exp = Array.from({ length: LEAVES_COUNT }, () => 0);
  const now = Date.now();
  for (let idx = 0; idx < LEAVES_COUNT; idx++) {
    if (map[idx] === 'gold') exp[idx] = now + GOLD_TTL_MS;
  }
  try { localStorage.setItem(goldExpKey(), JSON.stringify(exp)); } catch {}
  return map;
}

function getSpreadPositions(total, picks) {
  const set = new Set();
  if (picks <= 0 || total <= 0) return set;
  for (let k = 1; k <= picks; k++) {
    const pos = Math.round((k * (total + 1)) / (picks + 1)) - 1;
    set.add(Math.max(0, Math.min(total - 1, pos)));
  }
  return set;
}

function syncLeavesMapToCounts(greenCount, goldCount) {
  let map = loadLeavesMap();
  const targetFilled = Math.min(LEAVES_COUNT, Math.max(0, greenCount + goldCount));
  const currentFilled = map.filter(s => s !== 'empty').length;
  if (currentFilled !== targetFilled || map.filter(s=>s==='gold').length !== goldCount) {
    map = generateBalancedMap(greenCount, goldCount);
    saveLeavesMap(map);
  }
  return map;
}

function addOneLeafToMap(isGold) {
  const map = loadLeavesMap();
  const order = getFillOrderIndices();
  const nextIdx = order.find(i => map[i] === 'empty');
  if (nextIdx == null) return null;
  // قاعدة ذهب: 1 من كل 5 أوراق تكون ذهبية حتميًا
  const shouldBeGold = ((nextIdx + 1) % 5 === 0);
  map[nextIdx] = (isGold || shouldBeGold) ? 'gold' : 'green';
  saveLeavesMap(map);
  // سجّل صلاحية الذهب إن وُجد
  try {
    const raw = localStorage.getItem(goldExpKey());
    const exp = raw ? JSON.parse(raw) : Array.from({ length: LEAVES_COUNT }, () => 0);
    const finalGold = map[nextIdx] === 'gold';
    exp[nextIdx] = finalGold ? (Date.now() + GOLD_TTL_MS) : 0;
    localStorage.setItem(goldExpKey(), JSON.stringify(exp));
  } catch {}
  return { map, index: nextIdx, status: map[nextIdx] };
}

// --- Rewards: Gold leaf popup ---
function ensureRewardModal() {
  if (document.getElementById('reward-modal')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'reward-modal';
  wrapper.className = 'reward-modal hidden';
  document.body.appendChild(wrapper);
}

function hideRewardModal() {
  const modal = document.getElementById('reward-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.innerHTML = '';
}

function showGoldRewardPopup() {
  ensureRewardModal();
  const modal = document.getElementById('reward-modal');
  if (!modal) return;

  const reward = getRandomReward();
  const isCode = reward.type === 'code';

  modal.innerHTML = `
    <div class="reward-modal__backdrop"></div>
    <div class="reward-modal__dialog" role="dialog" aria-modal="true" aria-label="Gold reward">
      <button class="reward-close" aria-label="Close">×</button>
      <div class="reward-illust">
        <img src="imgs/Tree/Counter/بن ذهبية.svg" alt="Gold bean" />
      </div>
      <h3 class="reward-title">Congratulations! Gold Leaf ✨</h3>
      <div class="reward-content">
        ${isCode ? `
          <div class="reward-label">Discount code:</div>
          <div class="code-box" id="reward-code">${reward.value}</div>
          <button class="copy-btn" id="copy-reward" data-code="${reward.value}">Copy code</button>
        ` : `
          <div class="reward-label">🎁 Your gift:</div>
          <div class="gift-box">${reward.value}</div>
        `}
      </div>
      <button class="primary reward-cta" id="reward-ok">OK</button>
    </div>
  `;

  modal.classList.remove('hidden');

  const backdrop = modal.querySelector('.reward-modal__backdrop');
  const closeBtn = modal.querySelector('.reward-close');
  const okBtn = modal.querySelector('#reward-ok');
  const copyBtn = modal.querySelector('#copy-reward');

  function closeAll(){ hideRewardModal(); }
  if (backdrop) backdrop.addEventListener('click', closeAll);
  if (closeBtn) closeBtn.addEventListener('click', closeAll);
  if (okBtn) okBtn.addEventListener('click', closeAll);
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = copyBtn.getAttribute('data-code') || '';
      if (!code) return;
      try {
        navigator.clipboard.writeText(code);
        copyBtn.textContent = 'Copied ✔';
      } catch {
        // Fallback: select text
        const codeEl = document.getElementById('reward-code');
        if (codeEl) {
          const range = document.createRange();
          range.selectNode(codeEl);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          copyBtn.textContent = 'Copy manually';
        }
      }
    });
  }
}

function getRandomReward() {
  // 50/50 chance between discount code and gift
  const showCode = Math.random() < 0.5;
  if (showCode) {
    return { type: 'code', value: generateDiscountCode() };
  }
  const gifts = [
    'Free size upgrade',
    'Free cookie',
    'Free extra espresso shot',
    'Free caramel topping',
  ];
  const gift = gifts[Math.floor(Math.random() * gifts.length)];
  return { type: 'gift', value: gift };
}

function generateDiscountCode() {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BRNS-${part()}-${part()}`;
}

// --- Loss modal (inactivity) ---
function ensureLossModal(){
  if (document.getElementById('loss-modal')) return;
  const el = document.createElement('div');
  el.id = 'loss-modal';
  el.className = 'loss-modal hidden';
  const screen = document.querySelector('.screen') || document.body;
  screen.appendChild(el);
}

function hideLossModal(){
  const m = document.getElementById('loss-modal');
  if (!m) return;
  m.classList.add('hidden');
  m.innerHTML = '';
}

function showLossModalWithFallingLeaf(onAfterFall){
  ensureLossModal();
  const m = document.getElementById('loss-modal');
  if (!m) return;
  m.innerHTML = `
    <div class="loss-modal__backdrop"></div>
    <div class="loss-modal__dialog" role="dialog" aria-modal="true" aria-label="Leaf lost">
      <div class="loss-header">
        <div class="loss-title">Unfortunately 😢!</div>
        <div class="loss-sub">You lost</div>
        <div class="loss-count" id="loss-count">3</div>
        <div class="loss-sub">leaves today</div>
      </div>
      <div class="loss-leaf-wrap loss-leaf-sway">
        <div class="loss-leaf" aria-hidden="true"></div>
      </div>
    </div>
  `;
  m.classList.remove('hidden');
  // tap anywhere to dismiss
  const backdrop = m.querySelector('.loss-modal__backdrop');
  const dialog = m.querySelector('.loss-modal__dialog');
  if (backdrop) backdrop.addEventListener('click', () => hideLossModal());
  if (dialog) dialog.addEventListener('click', () => hideLossModal());
  // After animation duration, call onAfterFall
  // Fixed display: always "1" (no countdown)
  try {
    const el = document.getElementById('loss-count');
    if (el) el.textContent = '1';
  } catch {}
  setTimeout(() => { try { onAfterFall && onAfterFall(); } catch {} }, 3000);
}

function removeOldestGreenLeaf(){
  // Remove the earliest added non-empty leaf from the map, preferring green
  let map = loadLeavesMap();
  const order = getFillOrderIndices();
  // find first index in order where leaf is green; if none, any non-empty
  let idx = order.find(i => map[i] === 'green');
  if (idx == null) idx = order.find(i => map[i] !== 'empty');
  if (idx == null) return false;
  const was = map[idx];
  map[idx] = 'empty';
  saveLeavesMap(map);
  if (was === 'green' && state.green > 0) state.green -= 1;
  if (was === 'gold' && state.gold > 0) state.gold -= 1;
  saveState();
  // re-render if on tree page
  const canvas = document.getElementById('treeCanvas');
  if (canvas) {
    drawTreeImages(canvas, state.green, state.gold);
  }
  fillCounters();
  return true;
}

function startInactivityWatcher(){
  if (leafLossInProgress) return;
  const page = document.body.dataset.page;
  if (page !== 'tree') return;
  const check = () => {
    if (leafLossInProgress) return;
    const last = readLeafActivity();
    const now = Date.now();
    if (!last) return; // not initialized yet
    if (now - last >= INACTIVITY_THRESHOLD_MS) {
      // Skip popup if there are no leaves on the tree
      let hasAnyLeaf = false;
      try {
        const map = loadLeavesMap();
        hasAnyLeaf = map.some(s => s !== 'empty');
      } catch {}
      if (!hasAnyLeaf && (state.green + state.gold) <= 0) {
        // Reset activity baseline to avoid repeated checks
        markLeafActivityNow();
        return;
      }

      leafLossInProgress = true;
      showLossModalWithFallingLeaf(() => {
        removeOldestGreenLeaf();
        // reset timer after loss to avoid immediate repeat
        markLeafActivityNow();
        leafLossInProgress = false;
      });
    }
  };
  // poll every 5s
  setInterval(check, 5000);
}

// --- QR camera helpers ---
async function setupQrCamera() {
  try {
    const video = document.getElementById('qr-video');
    if (!video) return;
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = qrStream;
  } catch (err) {
    // قد يرفض المستخدم السماح بالكاميرا – نتجاهل الخطأ
  }
}

async function stopQrCamera() {
  try {
    if (qrStream) {
      qrStream.getTracks().forEach(t => t.stop());
    }
  } catch {}
  qrStream = null;
}

function startQrScanningLoop() {
  const video = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-canvas');
  if (!video || !canvas) return;
  const ctx = canvas.getContext('2d');
  let scanning = true;

  function tick() {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth || 220;
      canvas.height = video.videoHeight || 220;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      try {
        const code = jsQR(img.data, img.width, img.height);
        if (code && code.data) {
          scanning = false;
          handleQrResult(code.data);
          return;
        }
      } catch {}
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function handleQrResult(data) {
  try { await stopQrCamera(); } catch {}
  // افتح المحتوى في تبويب/صفحة ثانية ثم أكمل إضافة الورقة والانتقال للتقييم
  try {
    const url = new URL(data);
    try { window.open(url.href, '_blank', 'noopener'); } catch {}
  } catch {
    // ليس رابطًا → افتح صفحة نتيجة تعرض النص في تبويب جديد
    try {
      const href = 'qr-result.html?data=' + encodeURIComponent(String(data||''));
      window.open(href, '_blank', 'noopener');
    } catch {
      // كاحتياط لو منع المتصفح popup
      alert('QR: ' + data);
    }
  }
  // أضف ورقة واحدة بعد المسح (قاعدة: 1 من كل 5 ذهبية)
  state.leaves = Math.min(LEAVES_COUNT, state.leaves + 1);
  const res = addOneLeafToMap(false);
  if (res && res.status === 'gold') { state.gold += 1; } else { state.green += 1; }
  saveState();
  // بعد جلسة المسح: نظّف قائمة المدعوين لتبدأ بجلسة جديدة (تبقى محمد فقط)
  try { localStorage.setItem('barns-invite-members', JSON.stringify(['Mohammad Al zain'])); } catch {}
  markLeafActivityNow();
  window.location.href = 'rate.html';
}

// Draw tree as SVG (fallback)
// greenLeaves up to 40
function drawTree(svg, greenLeaves = 0) {
  svg.innerHTML = '';
  // الجذع
  const trunk = document.createElementNS('http://www.w3.org/2000/svg','path');
  trunk.setAttribute('d','M140 280 C 150 220 140 190 165 150 C 183 120 205 105 235 98 C 210 125 210 150 230 160 C 245 150 260 145 275 145 C 260 160 255 175 257 190 C 300 170 330 175 355 180 C 300 205 280 260 280 300 C 280 340 272 370 258 390 C 235 425 210 430 180 430 C 170 430 160 428 150 425 C 165 400 170 365 170 330 C 170 300 168 275 140 280 Z');
  trunk.setAttribute('fill','none');
  trunk.setAttribute('stroke','#6B3F1D');
  trunk.setAttribute('stroke-width','16');
  trunk.setAttribute('stroke-linecap','round');
  trunk.setAttribute('stroke-linejoin','round');
  const gTrunk = document.createElementNS('http://www.w3.org/2000/svg','g');
  gTrunk.setAttribute('transform','translate(40,10)');
  gTrunk.appendChild(trunk);
  svg.appendChild(gTrunk);

  // أماكن الحبوب (LEAVES_COUNT)
  const beans = [];
  for (let i=0;i<LEAVES_COUNT;i++) {
    const angle = (i/LEAVES_COUNT)*Math.PI*2;
    const radius = 140 + (i%2===0?10:-10);
    const x = 260 + Math.cos(angle) * radius;
    const y = 210 + Math.sin(angle) * (radius*0.66);
    beans.push({x,y});
  }
  beans.forEach((p, idx) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${p.x} ${p.y})`);
    const r = 12;
    const ell = document.createElementNS('http://www.w3.org/2000/svg','ellipse');
    ell.setAttribute('rx', r); ell.setAttribute('ry', r*0.65);
    const isGreen = idx < greenLeaves;
    ell.setAttribute('fill', isGreen ? '#2ea66d' : '#A7AFB0');
    ell.setAttribute('opacity', isGreen ? '1' : '0.55');
    const shine = document.createElementNS('http://www.w3.org/2000/svg','path');
    shine.setAttribute('d', `M ${-r*0.4} 0 C ${-r*0.3} ${-r*0.6}, ${r*0.1} ${-r*0.2}, 0 0 C ${r*0.1} ${r*0.2}, ${-r*0.3} ${r*0.6}, ${-r*0.4} 0`);
    shine.setAttribute('fill','#fff'); shine.setAttribute('opacity','0.7');
    g.appendChild(ell); g.appendChild(shine); svg.appendChild(g);
  });
}

// Login page
function mountLoginPage() {
  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('userName');
      const name = nameInput.value.trim();
      
      if (name) {
        saveUserName(name);
        window.location.href = 'index.html';
      }
    });
  }
}

// Page-specific logic
function mountPageSpecific() {
  const page = document.body.dataset.page;

  // QR: camera preview and close -> add one leaf then go to rate
  if (page === 'qr') {
    setupQrCamera();
    startQrScanningLoop();
    const btn = document.getElementById('qr-close');
    if (btn) btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await stopQrCamera();
      // العودة لصفحة الشجرة بدون إضافة شرب أو تقييم
      window.location.href = 'tree.html';
    });

    // Navigate to share QR page when CTA is clicked
    const qrDrinkBtn = document.getElementById('qr-drink-btn');
    if (qrDrinkBtn) {
      qrDrinkBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await stopQrCamera(); } catch {}
        window.location.href = 'share-qr.html';
      });
    }
  }

  // QR with invite members beneath
  if (page === 'qr-invite') {
    setupQrCamera();
    startQrScanningLoop();
    const btn = document.getElementById('qr-close');
    if (btn) btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await stopQrCamera();
      // on close, go back to invite page
      window.location.href = 'invite.html';
    });
  }

  // RATE: send rating -> back to tree
  if (page === 'rate') {
    const submit = document.getElementById('rate-submit');
    if (submit) submit.addEventListener('click', () => {
      // ممكن نقرأ الملاحظة إذا بغيت: document.getElementById('rate-note').value
      window.location.href = 'tree.html';
    });
    const beans = document.querySelectorAll('#rate-beans .rate-bean');
    let locked = false;
    function setVisual(toIdx, type){
      beans.forEach((b, i) => {
        b.classList.remove('active','is-red','is-yellow','is-green');
        if (i <= toIdx) {
          b.classList.add('active');
          if (type==='red') b.classList.add('is-red');
          if (type==='yellow') b.classList.add('is-yellow');
          if (type==='green') b.classList.add('is-green');
        }
      });
    }
    beans.forEach((b, idx) => {
      const type = idx === 0 || idx === 1 ? 'red' : (idx === 2 ? 'yellow' : 'green');
      b.addEventListener('mouseenter', () => { if (!locked) setVisual(idx, type); });
      b.addEventListener('focus', () => { if (!locked) setVisual(idx, type); });
      b.addEventListener('click', () => { locked = true; setVisual(idx, type); });
      b.addEventListener('mouseleave', () => { if (!locked) setVisual(-1); });
      b.addEventListener('blur', () => { if (!locked) setVisual(-1); });
    });
  }

  // CHAT: simple mock reply
  if (page === 'chat') {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-text');
    const body = document.getElementById('chat-body');
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const txt = input.value.trim(); if (!txt) return;
      body.insertAdjacentHTML('beforeend', '<div class="msg me"></div>');
      body.lastElementChild.textContent = txt;
      body.scrollTop = body.scrollHeight;
      input.value = '';
      setTimeout(() => {
        body.insertAdjacentHTML('beforeend', '<div class="msg bot">👌 Done — grab your cup from the coffee tree!</div>');
        body.scrollTop = body.scrollHeight;
      }, 500);
    });
  }

  // HOME: logout button + animate counters
  if (page === 'home') {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (confirm('Do you want to log out?')) {
          // لا نحذف بيانات المستخدم حتى تبقى محفوظة لعودته لاحقًا
          try { sessionStorage.removeItem(SESSION_INIT_KEY); } catch {}
          localStorage.removeItem(USER_NAME_KEY);
          window.location.href = 'login.html';
        }
      });
    }
    // تشغيل العدّ التصاعدي لعدادات Green/Gold في الهوم
    animateCountUp('home-green-count', state.green);
    animateCountUp('home-gold-count', state.gold);
  }

  // CHAT: (no logout button here)

  // TREE: (no logout button here)
  if (page === 'tree') {
    // start timer baseline when entering tree page
    markLeafActivityNow();

    // Drink CTA: go to QR to scan, then add a leaf on return
    const drinkBtn = document.getElementById('drink-btn');
    if (drinkBtn) {
      drinkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // افتح صفحة QR للمسح
        markLeafActivityNow();
        window.location.href = 'qr.html';
      });
    }

    // Draw placeholders and fill current map
    const canvas = document.getElementById('treeCanvas');
    if (canvas) {
      drawTreeImages(canvas, state.green, state.gold);
      // start inactivity watcher on tree page
      startInactivityWatcher();
      // فحص مستمر لانتهاء الذهب وتحديث الواجهة
      try {
        const interval = setInterval(() => {
          const beforeGold = state.gold;
          normalizeExpiredGold();
          // إذا تغيّرت الخريطة أو العداد أعد الرسم
          const afterGold = state.gold;
          if (afterGold !== beforeGold) {
            drawTreeImages(canvas, state.green, state.gold);
            fillCounters();
          }
        }, 5000);
        window.addEventListener('beforeunload', () => clearInterval(interval));
      } catch {}
      // Delegate click: open reward popup when a gold leaf is clicked
      canvas.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('tree-leaf--gold')) {
          try {
            const idx = Number(t.dataset.index || '-1');
            const raw = localStorage.getItem(goldExpKey());
            const exp = raw ? JSON.parse(raw) : [];
            const valid = exp[idx] && Date.now() < exp[idx];
            if (valid) {
              showGoldRewardPopup();
            } else {
              const map = loadLeavesMap();
              if (map[idx] === 'gold') {
                map[idx] = 'green';
                saveLeavesMap(map);
                t.classList.remove('tree-leaf--gold');
                t.classList.add('tree-leaf--green');
              }
            }
          } catch {
            showGoldRewardPopup();
          }
        }
      });

      // تعطيل أي محاذاة ديناميكية للجذع — التخطيط ثابت الآن عبر CSS
      // لا يوجد استدعاءات أو مستمعات تخص alignTrunkToGround هنا

      // احتياطي: ثبّت خصائص الجذع مباشرة لو كان هناك كاش قديم
      const stemImg = document.querySelector('.tree-stem');
      if (stemImg) {
        stemImg.style.position = 'absolute';
        stemImg.style.left = '50%';
        stemImg.style.transform = 'translateX(-50%)';
        stemImg.style.width = '40%';
        stemImg.style.bottom = '10%';
        stemImg.style.zIndex = '2';
      }
    }
  }

  // FRIENDS: (no logout button here)
  if (page === 'friends') {
    // Personalize profile card with logged-in user name and photo
    try {
      const fullName = (userName || '').trim();
      const firstName = fullName.split(/\s+/)[0] || '';
      const nameEl = document.querySelector('.fp-profile-card .fp-name');
      const imgEl = document.querySelector('.fp-profile-card .fp-avatar');
      if (nameEl && fullName) nameEl.textContent = fullName;
      if (imgEl) {
        const candidates = buildPeopleImageCandidates(firstName);
        setImageFromCandidates(imgEl, candidates);
      }

      // Reflect the logged-in user inside the friends grid
      const grid = document.querySelector('.fp-friends-grid');
      if (grid) {
        const normalize = (s) => (s||'').trim().toLowerCase();
        const allCards = Array.from(grid.querySelectorAll('.fp-friend-card'));
        const findCardByName = (n) => allCards.find(c => normalize(c.querySelector('.name')?.textContent) === normalize(n));

        // Remove any friend card that represents the logged-in user (same first name)
        const lowerFirst = normalize(firstName);
        Array.from(allCards).forEach(card => {
          const nameEl = card.querySelector('.name');
          if (!nameEl) return;
          const friendFirst = normalize(nameEl.textContent).split(/\s+/)[0] || '';
          if (lowerFirst && friendFirst === lowerFirst) {
            card.remove();
          }
        });

        // Ensure Mohammad appears with his photo
        const hasMohammad = !!findCardByName('Mohammad');
        if (!hasMohammad) {
          const card = document.createElement('div');
          card.className = 'fp-friend-card';
          card.innerHTML = `
            <img class="photo" alt="Mohammad" />
            <div class="meta">
              <div class="name">Mohammad</div>
              <div class="row"><img src="imgs/friends/section3/people.svg" alt="friends" /><span>10</span><img src="imgs/friends/section3/streak.svg" alt="streak" /><span>25</span></div>
            </div>
          `;
          grid.appendChild(card);
          const mImg = card.querySelector('img.photo');
          if (mImg) setImageFromCandidates(mImg, buildPeopleImageCandidates('Mohammad'));
        }
      }
    } catch {}

    // Make first tree card navigate to tree page
    try {
      const primaryTree = document.querySelector('.fp-trees-row .fp-tree:first-child');
      if (primaryTree) {
        primaryTree.classList.add('is-link');
        primaryTree.addEventListener('click', () => {
          window.location.href = 'tree.html';
        });
      }
    } catch {}
  }

  // QR: (no logout button here)
  if (page === 'qr') {
  }

  // RATE: (no logout button here)
  if (page === 'rate') {
  }
}
