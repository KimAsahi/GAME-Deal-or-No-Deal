(() => {
  'use strict';

  /* ---------------- 工具 ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const uid = () => 'c' + Math.random().toString(36).slice(2, 9);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const money = (n) => {
    const num = Number(n);
    const abs = Math.abs(num).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    return (num < 0 ? '-' : '') + '¥' + abs;
  };

  const PRESET_KEY = 'brmxj.presets.v2';
  const DECK_KEY = 'brmxj.lastdeck.v2';

  /* ---------------- 状态 ---------------- */
  const state = {
    prizes: [],        // { id, value, flipped }
    holeIds: [],
    pool: [],
    holeCount: 1,
    entryFee: 20,
    step: 'setup',     // bid | decide | flip | over
    round: 1,
    currentBid: null,
    sold: false,
    salePrice: null,
    busy: false,
  };

  /* ---------------- 存取 ---------------- */
  function loadDeck() {
    try {
      const raw = localStorage.getItem(DECK_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x) => ({ id: uid(), value: text(x && x.value), flipped: false }))
        .filter((x) => x.value !== '');
    } catch (e) {
      return [];
    }
  }

  function saveDeck() {
    try {
      localStorage.setItem(DECK_KEY, JSON.stringify(state.prizes.map((p) => ({ value: p.value }))));
    } catch (e) { /* 忽略 */ }
  }

  function getPresets() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function setPresets(arr) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(arr)); } catch (e) { /* 忽略 */ }
  }

  function renderPresets(selectedId) {
    const sel = $('#presetSelect');
    const arr = getPresets();
    sel.innerHTML = '';
    if (!arr.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（还没有预设）';
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    arr.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (selectedId) sel.value = selectedId;
  }

  /* ---------------- 屏幕 ---------------- */
  function showScreen(name) {
    ['setup', 'play', 'over'].forEach((key) => {
      $('#' + key).classList.toggle('active', key === name);
    });
    $('#btnQuit').hidden = name !== 'play';
    if (name === 'setup') $('#badge').textContent = '准备中';
    if (name === 'over') $('#badge').textContent = '本局结束';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  /* ---------------- 准备 ---------------- */
  function makeRow(prize, index) {
    const row = document.createElement('div');
    row.className = 'prize-row';

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(index + 1).padStart(2, '0');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = prize.value;
    input.placeholder = '填一个值：数字或文字，例如 500 / 一顿火锅';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => { prize.value = input.value; });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '×';
    del.title = '删除这张';
    del.addEventListener('click', () => {
      state.prizes = state.prizes.filter((p) => p.id !== prize.id);
      renderSetup();
    });

    row.append(idx, input, del);
    return row;
  }

  function renderSetup() {
    const box = $('#prizeRows');
    box.innerHTML = '';
    state.prizes.forEach((p, i) => box.appendChild(makeRow(p, i)));

    $('#deckCount').textContent = state.prizes.length ? state.prizes.length + ' 张' : '';
    $('#deckEmpty').hidden = state.prizes.length > 0;

    const maxHole = Math.max(1, state.prizes.length - 1);
    const hc = $('#holeCount');
    hc.max = String(maxHole);
    hc.value = String(clamp(Number(hc.value) || 1, 1, maxHole));
    $('#holeHint').textContent = state.prizes.length >= 2
      ? '底牌最多 ' + maxHole + ' 张（牌堆要留至少 1 张可翻）'
      : '至少要 2 张牌才能开局';
  }

  function readRange() {
    const a = Number($('#genMin').value);
    const b = Number($('#genMax').value);
    const va = Number.isFinite(a) ? a : 0;
    const vb = Number.isFinite(b) ? b : 0;
    return [
      Math.round(Math.max(0, Math.min(va, vb))),
      Math.round(Math.max(0, Math.max(va, vb))),
    ];
  }

  /* ---------------- 开局 ---------------- */
  function startGame() {
    const n = state.prizes.length;
    if (n < 2) { toast('至少要 2 张牌'); return; }
    if (state.prizes.some((p) => text(p.value) === '')) { toast('每张牌都要填一个值'); return; }

    state.prizes.forEach((p) => {
      p.value = text(p.value);
      p.flipped = false;
    });

    const fee = Number($('#entryFee').value);
    state.entryFee = Number.isFinite(fee) ? Math.max(0, fee) : 0;

    const k = parseInt($('#holeCount').value, 10);
    state.holeCount = clamp(Number.isFinite(k) ? k : 1, 1, n - 1);

    const ids = state.prizes.map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    state.holeIds = ids.slice(0, state.holeCount);
    state.pool = ids.slice(state.holeCount);

    state.round = 1;
    state.currentBid = null;
    state.sold = false;
    state.salePrice = null;
    state.busy = false;
    state.step = 'bid';

    saveDeck();
    showScreen('play');
    renderPlay();
  }

  /* ---------------- 卡牌 ---------------- */
  function cardEl(opts) {
    const o = Object.assign(
      { value: '', back: '✦', revealed: false, clickable: false, kind: 'pool' },
      opts
    );
    const el = document.createElement(o.clickable ? 'button' : 'div');
    if (o.clickable) el.type = 'button';
    el.className = 'deck-card ' + o.kind;
    if (o.revealed) el.classList.add('revealed');
    if (o.clickable) el.classList.add('live');

    const inner = document.createElement('span');
    inner.className = 'card-inner';

    const back = document.createElement('span');
    back.className = 'card-side card-back';
    back.textContent = o.back;

    const front = document.createElement('span');
    front.className = 'card-side card-front';
    const value = document.createElement('span');
    value.className = 'card-value';
    value.textContent = o.value;
    front.appendChild(value);

    inner.append(back, front);
    el.appendChild(inner);
    return el;
  }

  function sizeValue(el, value) {
    const valueEl = el.querySelector('.card-value');
    if (!valueEl) return;
    const len = Array.from(value).length;
    valueEl.classList.toggle('v-lg', len <= 4);
    valueEl.classList.toggle('v-md', len > 4 && len <= 9);
    valueEl.classList.toggle('v-sm', len > 9);
  }

  /* ---------------- 对局渲染 ---------------- */
  function renderPlay() {
    $('#badge').textContent = state.step === 'over' ? '本局结束' : '第 ' + state.round + ' 轮';
    renderList($('#publicList'));
    renderHole();
    renderPool();
    renderConsole();
  }

  function renderList(ul) {
    ul.innerHTML = '';
    state.prizes.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'public-item';
      const isHole = state.holeIds.indexOf(p.id) !== -1;

      if (p.flipped) li.classList.add('flipped');
      if (state.step === 'over') {
        if (isHole) li.classList.add('is-hole');
        else if (p.flipped) li.classList.add('is-out');
      }

      const value = document.createElement('span');
      value.className = 'pi-value';
      value.textContent = p.value;

      const tag = document.createElement('span');
      tag.className = 'pi-tag';
      if (state.step === 'over') {
        if (isHole) tag.textContent = '底牌';
        else if (p.flipped) tag.textContent = '已翻开';
        else tag.textContent = '未翻开';
      } else if (p.flipped) {
        tag.textContent = '已翻开';
      }

      li.append(value, tag);
      ul.appendChild(li);
    });
  }

  function renderHole() {
    const row = $('#holeRow');
    row.innerHTML = '';
    $('#holeNum').textContent = String(state.holeCount);

    const over = state.step === 'over';
    state.holeIds.forEach((id) => {
      const prize = state.prizes.find((p) => p.id === id);
      if (!prize) return;
      const el = cardEl({
        kind: 'hole',
        back: '☾',
        revealed: over,
        value: over ? prize.value : '',
      });
      if (over) sizeValue(el, prize.value);
      row.appendChild(el);
    });
  }

  function renderPool() {
    const row = $('#poolRow');
    row.innerHTML = '';
    $('#poolNum').textContent = String(state.pool.length);

    state.pool.forEach(() => {
      const el = cardEl({ kind: 'pool', back: '✦', clickable: state.step === 'flip' });
      el.addEventListener('click', () => flipCard(el));
      row.appendChild(el);
    });
  }

  function renderConsole() {
    const box = $('#console');
    box.innerHTML = '';

    if (state.step === 'bid') {
      const head = document.createElement('p');
      head.className = 'turn';
      head.innerHTML = '第 <b>' + state.round + '</b> 轮 · <span class="who bank">银行家</span>报价';

      const row = document.createElement('div');
      row.className = 'bid-row';

      const unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = '¥';

      const input = document.createElement('input');
      input.id = 'bidInput';
      input.type = 'number';
      input.step = 'any';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = '报个价';
      if (state.currentBid !== null) input.value = String(state.currentBid);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitBid();
      });

      const btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.id = 'bidBtn';
      btn.textContent = '报价';
      btn.addEventListener('click', submitBid);

      row.append(unit, input, btn);

      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '无限制：可以加价，也可以压价。';

      box.append(head, row, hint);
      return;
    }

    if (state.step === 'decide') {
      const head = document.createElement('p');
      head.className = 'turn';
      head.innerHTML = '<span class="who bank">银行家</span>出价 <b>' + money(state.currentBid) + '</b>';

      const ask = document.createElement('p');
      ask.className = 'ask';
      ask.textContent = '梦想家，卖不卖？';

      const row = document.createElement('div');
      row.className = 'decide-row';

      const accept = document.createElement('button');
      accept.className = 'btn primary';
      accept.id = 'acceptBtn';
      accept.textContent = '接受，卖出';
      accept.addEventListener('click', acceptBid);

      const reject = document.createElement('button');
      reject.className = 'btn';
      reject.id = 'rejectBtn';
      reject.textContent = '拒绝，翻牌';
      reject.addEventListener('click', rejectBid);

      row.append(accept, reject);
      box.append(head, ask, row);
      return;
    }

    if (state.step === 'flip') {
      const head = document.createElement('p');
      head.className = 'turn';
      head.innerHTML = '第 <b>' + state.round + '</b> 轮 · <span class="who dream">梦想家</span>翻牌';

      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '点上面牌堆里的任意一张。';

      box.append(head, hint);
    }
  }

  /* ---------------- 对局动作 ---------------- */
  function submitBid() {
    const input = $('#bidInput');
    if (!input) return;
    const raw = input.value.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) {
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 420);
      return;
    }
    state.currentBid = value;
    state.step = 'decide';
    renderConsole();
  }

  function acceptBid() {
    if (state.step !== 'decide') return;
    state.sold = true;
    state.salePrice = state.currentBid;
    state.step = 'over';
    renderPlay();
    renderResult();
    showScreen('over');
  }

  function rejectBid() {
    if (state.step !== 'decide') return;
    state.step = 'flip';
    renderPlay();
  }

  function flipCard(el) {
    if (state.step !== 'flip' || state.busy) return;
    state.busy = true;

    const idx = rndInt(0, state.pool.length - 1);
    const id = state.pool[idx];
    const prize = state.prizes.find((p) => p.id === id);
    if (!prize) { state.busy = false; return; }

    prize.flipped = true;

    const valueEl = el.querySelector('.card-value');
    if (valueEl) valueEl.textContent = prize.value;
    sizeValue(el, prize.value);
    el.classList.add('revealed');
    el.disabled = true;

    renderList($('#publicList'));

    setTimeout(() => {
      state.pool.splice(idx, 1);
      state.busy = false;

      if (state.pool.length === 0) {
        state.step = 'over';
        renderPlay();
        setTimeout(() => {
          renderResult();
          showScreen('over');
        }, 300);
      } else {
        state.round += 1;
        state.step = 'bid';
        renderPlay();
      }
    }, 850);
  }

  /* ---------------- 结果 ---------------- */
  function renderResult() {
    const hole = state.holeIds
      .map((id) => state.prizes.find((p) => p.id === id))
      .filter(Boolean);

    $('#overTitle').textContent = state.sold ? '成交' : '留到了最后';
    $('#overSub').textContent = state.sold
      ? '梦想家以 ' + money(state.salePrice) + ' 卖出了底牌'
      : '牌堆翻完，梦想家把底牌留到了最后';

    const box = $('#overHole');
    box.innerHTML = '';
    hole.forEach((p) => {
      const el = cardEl({ kind: 'hole', back: '☾', revealed: true, value: p.value });
      sizeValue(el, p.value);
      box.appendChild(el);
    });

    $('#overFee').textContent = money(state.entryFee);
    $('#overPrice').textContent = state.sold ? money(state.salePrice) : '未成交';

    renderList($('#overList'));
  }

  /* ---------------- 事件 ---------------- */
  $('#btnStart').addEventListener('click', startGame);

  $('#btnAddPrize').addEventListener('click', () => {
    state.prizes.push({ id: uid(), value: '', flipped: false });
    renderSetup();
    const inputs = document.querySelectorAll('.prize-row input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $('#btnGenDeck').addEventListener('click', () => {
    const n = parseInt($('#genCount').value, 10);
    if (!Number.isFinite(n) || n < 1) { toast('张数至少 1'); return; }
    if (n > 40 && !confirm('一次生成 ' + n + ' 张，轮次会很多，继续？')) return;
    if (state.prizes.length && !confirm('会覆盖当前牌堆，继续？')) return;
    const [lo, hi] = readRange();
    state.prizes = Array.from({ length: n }, () => ({
      id: uid(),
      value: String(rndInt(lo, hi)),
      flipped: false,
    }));
    renderSetup();
    toast('已生成 ' + n + ' 张');
  });

  $('#btnGenAmounts').addEventListener('click', () => {
    if (!state.prizes.length) { toast('先加几张牌'); return; }
    const [lo, hi] = readRange();
    state.prizes.forEach((p) => { p.value = String(rndInt(lo, hi)); });
    renderSetup();
    toast('数值已随机');
  });

  $('#btnSavePreset').addEventListener('click', () => {
    if (!state.prizes.length) { toast('先加几张牌'); return; }
    if (state.prizes.some((p) => text(p.value) === '')) { toast('有牌还没填值'); return; }
    const name = (window.prompt('给这副牌起个名字：') || '').trim();
    if (!name) return;
    const arr = getPresets();
    const cards = state.prizes.map((p) => ({ value: p.value }));
    const exist = arr.find((x) => x.name === name);
    let selectedId;
    if (exist) {
      if (!confirm('已有同名预设，覆盖它？')) return;
      exist.cards = cards;
      selectedId = exist.id;
    } else {
      const item = { id: uid(), name: name, cards: cards };
      arr.push(item);
      selectedId = item.id;
    }
    setPresets(arr);
    renderPresets(selectedId);
    toast('已保存「' + name + '」');
  });

  $('#btnLoadPreset').addEventListener('click', () => {
    const id = $('#presetSelect').value;
    const preset = getPresets().find((x) => x.id === id);
    if (!preset) { toast('还没有预设'); return; }
    state.prizes = (preset.cards || []).map((c) => ({
      id: uid(),
      value: text(c && c.value),
      flipped: false,
    }));
    renderSetup();
    toast('已载入「' + preset.name + '」');
  });

  $('#btnDeletePreset').addEventListener('click', () => {
    const id = $('#presetSelect').value;
    const arr = getPresets();
    const preset = arr.find((x) => x.id === id);
    if (!preset) { toast('还没有预设'); return; }
    if (!confirm('删除预设「' + preset.name + '」？')) return;
    setPresets(arr.filter((x) => x.id !== id));
    renderPresets();
    toast('已删除');
  });

  $('#btnQuit').addEventListener('click', () => {
    if (!confirm('结束本局，回到准备页？')) return;
    state.step = 'setup';
    showScreen('setup');
    renderSetup();
  });

  $('#btnAgain').addEventListener('click', () => { startGame(); });

  $('#btnBackSetup').addEventListener('click', () => {
    state.step = 'setup';
    showScreen('setup');
    renderSetup();
  });

  /* ---------------- 启动 ---------------- */
  state.prizes = loadDeck();
  renderSetup();
  renderPresets();
  showScreen('setup');
})();
