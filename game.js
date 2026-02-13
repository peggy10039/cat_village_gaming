(() => {
  /**
   * 貓咪村莊 RPG 原型
   * - Canvas 2D
   * - 方向鍵移動
   * - 靠近 NPC 提示 + Space/Enter 觸發對話
   * - 對話結束送小禮物（毛/鬍鬚等），一次性，背包可查看（localStorage 存檔）
   */

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context 無法取得");

  const ui = {
    prompt: document.getElementById("prompt"),
    promptText: document.getElementById("prompt-text"),
    dialogue: document.getElementById("dialogue"),
    dialogueName: document.getElementById("dialogue-name"),
    dialogueText: document.getElementById("dialogue-text"),
    inventory: document.getElementById("inventory"),
    inventoryClose: document.getElementById("inventory-close"),
    inventoryList: document.getElementById("inventory-list"),
    inventoryMeta: document.getElementById("inventory-meta"),
    inventoryClear: document.getElementById("inventory-clear"),
    help: document.getElementById("help"),
    helpClose: document.getElementById("help-close"),
    shop: document.getElementById("shop"),
    shopClose: document.getElementById("shop-close"),
    shopList: document.getElementById("shop-list"),
    shopMeta: document.getElementById("shop-meta"),
    shopSellAll: document.getElementById("shop-sell-all"),
    badgeHp: document.getElementById("badge-hp"),
    badgeCoins: document.getElementById("badge-coins"),
    badgeGifts: document.getElementById("badge-gifts"),
    badgeHint: document.getElementById("badge-hint"),
  };

  const STORAGE_KEY = "cat-village-rpg-save-v1";
  const FIRST_VISIT_KEY = "cat-village-rpg-first-visit-v1";

  // 支援用網址參數強制重置：index.html?reset=1
  // 會清空存檔與「首次進來」旗標，並把網址還原（避免每次刷新都重置）
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("reset")) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(FIRST_VISIT_KEY);
      window.history.replaceState(null, "", window.location.pathname);
    }
  } catch {
    // ignore
  }

  /** @typedef {{ id: string; name: string; desc: string; from: string; time: number }} Gift */
  /** @typedef {{ hp: number; maxHp: number; coins: number }} PlayerStats */
  /** @typedef {{ gifts: Gift[]; givenNpcIds: Record<string, boolean>; stats: PlayerStats }} SaveData */

  /** @returns {PlayerStats} */
  function defaultStats() {
    return { hp: 100, maxHp: 100, coins: 0 };
  }

  /** @param {any} raw */
  function normalizeStats(raw) {
    const d = defaultStats();
    if (!raw || typeof raw !== "object") return d;
    const maxHp = Number.isFinite(raw.maxHp) ? raw.maxHp : d.maxHp;
    const hp = Number.isFinite(raw.hp) ? raw.hp : d.hp;
    const coins = Number.isFinite(raw.coins) ? raw.coins : d.coins;
    const safeMax = Math.max(1, Math.floor(maxHp));
    const safeHp = clamp(Math.floor(hp), 0, safeMax);
    const safeCoins = Math.max(0, Math.floor(coins));
    return { hp: safeHp, maxHp: safeMax, coins: safeCoins };
  }

  /** @returns {SaveData} */
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { gifts: [], givenNpcIds: {}, stats: defaultStats() };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { gifts: [], givenNpcIds: {}, stats: defaultStats() };
      return {
        gifts: Array.isArray(parsed.gifts) ? parsed.gifts : [],
        givenNpcIds: parsed.givenNpcIds && typeof parsed.givenNpcIds === "object" ? parsed.givenNpcIds : {},
        stats: normalizeStats(parsed.stats),
      };
    } catch {
      return { gifts: [], givenNpcIds: {}, stats: defaultStats() };
    }
  }

  /** @param {SaveData} save */
  function writeSave(save) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  }

  let save = loadSave();

  function hardReset() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(FIRST_VISIT_KEY);
    // 清掉按鍵狀態，避免重整前卡鍵
    keys.clear();
    window.location.reload();
  }

  function updateGiftBadge() {
    ui.badgeGifts.textContent = `禮物：${save.gifts.length}`;
  }

  function updateStatsBadges() {
    const { hp, maxHp, coins } = save.stats;
    ui.badgeHp.textContent = `HP：${hp}/${maxHp}`;
    ui.badgeCoins.textContent = `錢幣：${coins}`;
    const low = hp <= Math.ceil(maxHp * 0.25);
    ui.badgeHp.classList.toggle("badge--danger", low);
  }

  /** @param {number} amount */
  function addCoins(amount) {
    save.stats.coins = Math.max(0, save.stats.coins + Math.floor(amount));
    writeSave(save);
    updateStatsBadges();
  }

  /** @param {number} amount */
  function takeCoins(amount) {
    save.stats.coins = Math.max(0, save.stats.coins - Math.floor(amount));
    writeSave(save);
    updateStatsBadges();
  }

  /** @param {number} amount */
  function heal(amount) {
    save.stats.hp = clamp(save.stats.hp + Math.floor(amount), 0, save.stats.maxHp);
    writeSave(save);
    updateStatsBadges();
  }

  /** @param {number} amount */
  function takeDamage(amount) {
    save.stats.hp = clamp(save.stats.hp - Math.floor(amount), 0, save.stats.maxHp);
    writeSave(save);
    updateStatsBadges();
  }

  function hashStringToInt(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** @param {Gift} g */
  function giftSellPrice(g) {
    // 簡單可預測的定價（不要每次刷新亂跳）
    const seed = hashStringToInt(`${g.name}|${g.from}`);
    return 8 + (seed % 9); // 8~16
  }

  function renderShop() {
    const gifts = save.gifts.slice().sort((a, b) => b.time - a.time);
    ui.shopList.innerHTML = "";
    if (gifts.length === 0) {
      ui.shopMeta.textContent = "目前沒有禮物可以售出。去跟貓咪 NPC 聊聊天吧！";
      ui.shopSellAll.disabled = true;
      return;
    }
    ui.shopSellAll.disabled = false;
    ui.shopMeta.textContent = `今天收購價已標示（共 ${gifts.length} 件）。`;
    for (const g of gifts) {
      const li = document.createElement("li");
      li.className = "inventory__item";

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.gap = "10px";
      row.style.alignItems = "center";

      const left = document.createElement("div");
      left.style.minWidth = "0";

      const name = document.createElement("div");
      name.className = "inventory__itemName";
      name.textContent = g.name;

      const desc = document.createElement("div");
      desc.className = "inventory__itemDesc";
      desc.textContent = `${g.desc}（來自：${g.from}）`;

      left.appendChild(name);
      left.appendChild(desc);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.flexDirection = "column";
      right.style.alignItems = "flex-end";
      right.style.gap = "6px";

      const price = giftSellPrice(g);
      const priceTag = document.createElement("div");
      priceTag.className = "inventory__itemDesc";
      priceTag.textContent = `售價：${price} 金幣`;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "inventory__close";
      btn.textContent = "售出";
      btn.dataset.giftId = g.id;

      right.appendChild(priceTag);
      right.appendChild(btn);

      row.appendChild(left);
      row.appendChild(right);
      li.appendChild(row);
      ui.shopList.appendChild(li);
    }
  }

  /** @param {string} id */
  function sellGiftById(id) {
    const idx = save.gifts.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const g = save.gifts[idx];
    const price = giftSellPrice(g);
    save.gifts.splice(idx, 1);
    save.stats.coins = Math.max(0, save.stats.coins + price);
    writeSave(save);
    updateGiftBadge();
    updateStatsBadges();
    renderShop();
    if (isInventoryOpen()) renderInventory();
  }

  function sellAllGifts() {
    if (save.gifts.length === 0) return;
    let total = 0;
    for (const g of save.gifts) total += giftSellPrice(g);
    save.gifts = [];
    save.stats.coins = Math.max(0, save.stats.coins + total);
    writeSave(save);
    updateGiftBadge();
    updateStatsBadges();
    renderShop();
    if (isInventoryOpen()) renderInventory();
  }

  function renderInventory() {
    const gifts = save.gifts.slice().sort((a, b) => b.time - a.time);
    ui.inventoryList.innerHTML = "";
    if (gifts.length === 0) {
      ui.inventoryMeta.textContent = "目前沒有禮物。去跟貓咪 NPC 聊聊天吧！";
      return;
    }
    ui.inventoryMeta.textContent = `共 ${gifts.length} 件小禮物（會自動存檔在瀏覽器）。`;
    for (const g of gifts) {
      const li = document.createElement("li");
      li.className = "inventory__item";
      const name = document.createElement("div");
      name.className = "inventory__itemName";
      name.textContent = g.name;
      const desc = document.createElement("div");
      desc.className = "inventory__itemDesc";
      desc.textContent = `${g.desc}（來自：${g.from}）`;
      li.appendChild(name);
      li.appendChild(desc);
      ui.inventoryList.appendChild(li);
    }
  }

  function setAriaHidden(el, hidden) {
    el.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  function showPrompt(text) {
    ui.promptText.textContent = text;
    setAriaHidden(ui.prompt, false);
  }

  function hidePrompt() {
    setAriaHidden(ui.prompt, true);
  }

  function openInventory() {
    renderInventory();
    setAriaHidden(ui.inventory, false);
  }

  function closeInventory() {
    setAriaHidden(ui.inventory, true);
  }

  function toggleInventory() {
    const hidden = ui.inventory.getAttribute("aria-hidden") === "true";
    if (hidden) openInventory();
    else closeInventory();
  }

  function isShopOpen() {
    return ui.shop.getAttribute("aria-hidden") === "false";
  }

  function openShop() {
    renderShop();
    setAriaHidden(ui.shop, false);
  }

  function closeShop() {
    setAriaHidden(ui.shop, true);
  }

  function openHelp() {
    setAriaHidden(ui.help, false);
  }

  function closeHelp() {
    setAriaHidden(ui.help, true);
  }

  function toggleHelp() {
    const hidden = ui.help.getAttribute("aria-hidden") === "true";
    if (hidden) openHelp();
    else closeHelp();
  }

  function closeOverlays() {
    closeInventory();
    closeShop();
    closeHelp();
  }

  /** Map 與世界座標 */
  const WORLD = {
    w: 1920,
    h: 1080,
    tile: 48,
  };

  /** @typedef {{ x:number;y:number;w:number;h:number }} Rect */
  /** @param {Rect} a @param {Rect} b */
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** @param {Rect} rect @param {Rect[]} solids */
  function collides(rect, solids) {
    for (const s of solids) if (rectsOverlap(rect, s)) return true;
    return false;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /** 村莊地形：用一些矩形當房子/水池/柵欄（可碰撞） */
  /** @type {Rect[]} */
  const solids = [
    // 外框（讓玩家不走出世界）
    { x: -9999, y: -9999, w: 9999, h: WORLD.h + 19998 }, // left wall
    { x: WORLD.w, y: -9999, w: 9999, h: WORLD.h + 19998 }, // right wall
    { x: -9999, y: -9999, w: WORLD.w + 19998, h: 9999 }, // top wall
    { x: -9999, y: WORLD.h, w: WORLD.w + 19998, h: 9999 }, // bottom wall

    // 房屋群（貓咪村莊）
    { x: 240, y: 180, w: 380, h: 240 },
    { x: 720, y: 160, w: 420, h: 260 },
    { x: 1240, y: 210, w: 420, h: 230 },
    { x: 320, y: 520, w: 360, h: 240 },
    { x: 840, y: 560, w: 430, h: 260 },

    // 小水池
    { x: 1260, y: 620, w: 420, h: 260 },

    // 柵欄（小迷宮感）
    { x: 120, y: 880, w: 820, h: 40 },
    { x: 120, y: 760, w: 40, h: 160 },
    { x: 900, y: 760, w: 40, h: 160 },
    { x: 520, y: 740, w: 40, h: 180 },
  ];

  /** 玩家 */
  const player = {
    x: 520,
    // 避免一開始就卡在柵欄碰撞盒（solids 裡 y: 880~920）
    y: 940,
    w: 28,
    h: 34,
    speed: 240, // px/s
    facing: /** @type {"up"|"down"|"left"|"right"} */ ("down"),
  };

  /** @typedef {{ id:string; name:string; x:number; y:number; r:number; palette: {base:string; spot:string}; spriteSrc?: string; spriteScale?: number; wander?: { radius:number; speed:number; pause:[number, number] }; dialogue: string[]; gift: { name:string; desc:string } }} Npc */
  /** @type {Npc[]} */
  const npcs = [
    {
      id: "npc-mikan",
      name: "蜜柑（橘白貓）",
      x: 420,
      y: 460,
      r: 22,
      palette: { base: "#ffb057", spot: "#fff2de" },
      spriteSrc: "./assets/npcs/orange_cat.png",
      spriteScale: 1.45,
      wander: { radius: 56, speed: 40, pause: [0.35, 1.2] },
      dialogue: [
        "喵！歡迎來到貓咪村莊～今天的風很舒服吧？",
        "我在收集陽光曬過的毛毛，聞起來像餅乾。",
        "你願意幫我把好心情帶去給別的貓咪嗎？",
      ],
      gift: { name: "一小撮暖暖貓毛", desc: "陽光味的毛毛，摸起來超蓬鬆。" },
    },
    {
      id: "npc-kuro",
      name: "小黑（黑貓）",
      x: 980,
      y: 470,
      r: 22,
      palette: { base: "#1c2136", spot: "#4a5380" },
      spriteSrc: "./assets/npcs/black_cat.png",
      spriteScale: 1.45,
      wander: { radius: 52, speed: 38, pause: [0.45, 1.3] },
      dialogue: [
        "……（你感覺到一股沉穩的氣場）",
        "別怕，我只是走路很安靜。",
        "給你一根鬍鬚，聽說可以帶來「看清真相」的運氣。",
      ],
      gift: { name: "小黑的鬍鬚", desc: "筆直又有精神，像夜裡的星光。" },
    },
    {
      id: "npc-sakura",
      name: "櫻餅（三花貓）",
      x: 1480,
      y: 510,
      r: 22,
      palette: { base: "#f4d7c8", spot: "#c86f62" },
      spriteSrc: "./assets/npcs/flower_cat.png",
      spriteScale: 1.45,
      wander: { radius: 60, speed: 42, pause: [0.35, 1.15] },
      dialogue: [
        "嘿～旅人！你看得出我今天是哪一種心情花色嗎？",
        "我把甜甜的故事藏在尾巴裡。",
        "如果你願意聽完，我就送你一根「故事鬍鬚」。",
      ],
      gift: { name: "櫻餅的故事鬍鬚", desc: "據說拿著它，說故事會變得更動聽。" },
    },
    {
      id: "npc-shiro",
      name: "小雪（白貓）",
      x: 700,
      y: 860,
      r: 22,
      palette: { base: "#f5fbff", spot: "#cbe6ff" },
      spriteSrc: "./assets/npcs/white_cat.png",
      spriteScale: 1.45,
      wander: { radius: 50, speed: 36, pause: [0.5, 1.4] },
      dialogue: [
        "喵～你走路的節奏很溫柔。",
        "村莊有些地方不能踩進去喔（像水池跟房子）。",
        "這份小禮物給你：它會讓你想起這裡的安靜。",
      ],
      gift: { name: "一撮雪白軟毛", desc: "柔柔的像棉花糖，聞起來像新洗的被子。" },
    },
    {
      id: "npc-tora",
      name: "虎斑師傅（虎斑貓）",
      x: 1080,
      y: 860,
      r: 22,
      palette: { base: "#caa36b", spot: "#6d4b2f" },
      spriteSrc: "./assets/npcs/tiger_cat.png",
      spriteScale: 1.45,
      wander: { radius: 54, speed: 40, pause: [0.35, 1.2] },
      dialogue: [
        "看好腳步，方向鍵要穩，轉向要果斷。",
        "靠近我時，空白鍵能打開話匣子（也能打開你的勇氣）。",
        "拿去吧，這是「練功用的貓毛」，別告訴別人。",
      ],
      gift: { name: "虎斑師傅的練功毛", desc: "硬挺又有彈性，像是在說：再走一步。" },
    },
  ];

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  // 事件提示（短暫顯示，之後恢復預設提示）
  let hintOverrideUntil = 0;
  let hintOverrideText = "";
  const DEFAULT_HINT = "提示：靠近 NPC / 商店 會出現「可互動」";

  function setHintTemp(text, seconds) {
    hintOverrideText = text;
    hintOverrideUntil = performance.now() + seconds * 1000;
    ui.badgeHint.textContent = text;
  }

  function updateHintOverride(now) {
    if (dialogue.active) return;
    if (hintOverrideUntil > 0 && now < hintOverrideUntil) return;
    if (hintOverrideUntil !== 0) {
      hintOverrideUntil = 0;
      hintOverrideText = "";
      ui.badgeHint.textContent = DEFAULT_HINT;
    }
  }

  /** @typedef {{ homeX:number; homeY:number; tx:number; ty:number; wait:number }} NpcWanderState */
  /** @type {Map<string, NpcWanderState>} */
  const npcWander = new Map();

  function initNpcWander() {
    for (const npc of npcs) {
      if (!npc.wander) continue;
      npcWander.set(npc.id, {
        homeX: npc.x,
        homeY: npc.y,
        tx: npc.x,
        ty: npc.y,
        wait: rand(npc.wander.pause[0], npc.wander.pause[1]),
      });
    }
  }

  function pickNpcTarget(npc, st) {
    const w = npc.wander;
    if (!w) return;
    // 圓內均勻取樣：半徑用 sqrt
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * w.radius;
    const x = st.homeX + Math.cos(a) * r;
    const y = st.homeY + Math.sin(a) * r;
    st.tx = clamp(x, 0 + npc.r, WORLD.w - npc.r);
    st.ty = clamp(y, 0 + npc.r, WORLD.h - npc.r);
  }

  function updateNpcWander(dt) {
    for (const npc of npcs) {
      const w = npc.wander;
      if (!w) continue;
      const st = npcWander.get(npc.id);
      if (!st) continue;

      if (st.wait > 0) {
        st.wait -= dt;
        continue;
      }

      const dx = st.tx - npc.x;
      const dy = st.ty - npc.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) {
        pickNpcTarget(npc, st);
        st.wait = rand(w.pause[0], w.pause[1]);
        continue;
      }

      const step = Math.min(w.speed * dt, d);
      const nx = npc.x + (dx / d) * step;
      const ny = npc.y + (dy / d) * step;

      // 簡易避障：用 NPC 外接矩形檢查是否撞到 solid，撞到就換目標並稍微停一下
      const rect = { x: nx - npc.r, y: ny - npc.r, w: npc.r * 2, h: npc.r * 2 };
      if (collides(rect, solids)) {
        pickNpcTarget(npc, st);
        st.wait = rand(w.pause[0], w.pause[1]) * 0.6;
        continue;
      }

      npc.x = nx;
      npc.y = ny;

      // 走太遠時拉回（避免長時間累積誤差）
      const homeD = dist(npc.x, npc.y, st.homeX, st.homeY);
      if (homeD > w.radius * 1.15) {
        // 直接把目標設回家附近
        st.tx = st.homeX;
        st.ty = st.homeY;
        st.wait = rand(0.05, 0.2) * clamp01((homeD - w.radius) / w.radius);
      }
    }
  }

  /** 盜賊/凶狠貓：會亂跑並造成效果 */
  /** @typedef {{ id:string; type:"thief"|"bruteCat"; name:string; x:number; y:number; r:number; color:string; wander:{ radius:number; speed:number; pause:[number,number] }; homeX:number; homeY:number; wait:number; tx:number; ty:number; cooldown:number }} Mob */
  /** @type {Mob[]} */
  const mobs = [
    {
      id: "mob-thief",
      type: "thief",
      name: "盜賊",
      x: 360,
      y: 980,
      r: 16,
      color: "rgba(255,107,136,.9)",
      wander: { radius: 220, speed: 120, pause: [0.1, 0.5] },
      homeX: 360,
      homeY: 980,
      wait: 0.2,
      tx: 360,
      ty: 980,
      cooldown: 0,
    },
    {
      id: "mob-brute",
      type: "bruteCat",
      name: "凶狠貓",
      x: 1180,
      y: 980,
      r: 20,
      color: "rgba(255,176,87,.95)",
      wander: { radius: 260, speed: 110, pause: [0.15, 0.6] },
      homeX: 1180,
      homeY: 980,
      wait: 0.25,
      tx: 1180,
      ty: 980,
      cooldown: 0,
    },
  ];

  function initMobs() {
    for (const m of mobs) {
      m.homeX = m.x;
      m.homeY = m.y;
      m.tx = m.x;
      m.ty = m.y;
      m.wait = rand(m.wander.pause[0], m.wander.pause[1]);
      m.cooldown = 0;
    }
  }

  function pickMobTarget(m) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * m.wander.radius;
    const x = m.homeX + Math.cos(a) * r;
    const y = m.homeY + Math.sin(a) * r;
    m.tx = clamp(x, 0 + m.r, WORLD.w - m.r);
    m.ty = clamp(y, 0 + m.r, WORLD.h - m.r);
  }

  function updateMobWander(dt, m) {
    if (m.wait > 0) {
      m.wait -= dt;
      return;
    }
    const dx = m.tx - m.x;
    const dy = m.ty - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) {
      pickMobTarget(m);
      m.wait = rand(m.wander.pause[0], m.wander.pause[1]);
      return;
    }
    const step = Math.min(m.wander.speed * dt, d);
    const nx = m.x + (dx / d) * step;
    const ny = m.y + (dy / d) * step;
    const rect = { x: nx - m.r, y: ny - m.r, w: m.r * 2, h: m.r * 2 };
    if (collides(rect, solids)) {
      pickMobTarget(m);
      m.wait = rand(m.wander.pause[0], m.wander.pause[1]) * 0.5;
      return;
    }
    m.x = nx;
    m.y = ny;
  }

  function updateMobs(dt) {
    for (const m of mobs) {
      updateMobWander(dt, m);
      m.cooldown = Math.max(0, m.cooldown - dt);
    }

    // 效果：對話/介面中先不觸發，避免被偷被打
    if (dialogue.active || isOverlayOpen()) return;
    const { cx, cy } = playerCenter();

    for (const m of mobs) {
      const d = dist(cx, cy, m.x, m.y);
      if (m.type === "thief") {
        if (d <= 44 && m.cooldown <= 0 && save.stats.coins > 0) {
          const steal = Math.max(1, Math.min(save.stats.coins, Math.floor(rand(2, 7))));
          takeCoins(steal);
          setHintTemp(`盜賊偷走了 ${steal} 金幣！`, 1.2);
          m.cooldown = rand(1.0, 1.6);
        }
      } else {
        if (d <= 48 && m.cooldown <= 0 && save.stats.hp > 0) {
          const dmg = Math.floor(rand(4, 9));
          takeDamage(dmg);
          setHintTemp(`凶狠貓抓了你一下（-${dmg} HP）`, 1.2);
          m.cooldown = rand(0.8, 1.3);
          if (save.stats.hp <= 0) setHintTemp("你倒下了…按 Shift+R 重新開始", 2.0);
        }
      }
    }
  }

  function drawMob(m) {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    // 影子
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath();
    ctx.ellipse(m.x, m.y + 14, m.r * 0.9, m.r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // 本體
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
    // 小符號
    ctx.fillStyle = "rgba(10,14,28,.65)";
    ctx.font = "14px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(m.type === "thief" ? "$" : "!", m.x, m.y + 1);
    ctx.restore();
  }

  function drawShop() {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    // 地墊
    ctx.fillStyle = "rgba(124,226,255,.12)";
    roundRectFill(ctx, SHOP.x - 42, SHOP.y - 26, 84, 52, 16);
    ctx.strokeStyle = "rgba(124,226,255,.28)";
    ctx.lineWidth = 2;
    roundRectStroke(ctx, SHOP.x - 42, SHOP.y - 26, 84, 52, 16);
    // 招牌
    drawNameTag(SHOP.x, SHOP.y - 44, "商店");
    ctx.restore();
  }

  /** NPC 圖示（sprite） */
  /** @type {Map<string, HTMLImageElement>} */
  const spriteCache = new Map();
  /** @param {string} src */
  function getSprite(src) {
    const cached = spriteCache.get(src);
    if (cached) return cached;
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = src;
    spriteCache.set(src, img);
    return img;
  }

  /** 玩家圖示（sprite） */
  const PLAYER_SPRITE_RIGHT_SRC = "./assets/user/user_right.png";
  const PLAYER_SPRITE_LEFT_SRC = "./assets/user/user_left.png";
  const PLAYER_SPRITE_SCALE = 2.2;

  function getPlayerSpriteSrc() {
    // 需求：按左用 user_left、按右用 user_right；預設/其他方向都用 user_right
    return player.facing === "left" ? PLAYER_SPRITE_LEFT_SRC : PLAYER_SPRITE_RIGHT_SRC;
  }

  // 預先載入所有 NPC 圖示
  for (const npc of npcs) {
    if (npc.spriteSrc) getSprite(npc.spriteSrc);
  }
  // 預先載入玩家圖示
  getSprite(PLAYER_SPRITE_RIGHT_SRC);
  getSprite(PLAYER_SPRITE_LEFT_SRC);

  /** 對話系統 */
  const dialogue = {
    active: false,
    npcId: /** @type {string|null} */ (null),
    lineIndex: 0,
    lines: /** @type {string[]} */ ([]),
    npcName: "",
    onFinish: /** @type {null | (() => void)} */ (null),
  };

  function openDialogue(npc, lines, onFinish) {
    dialogue.active = true;
    dialogue.npcId = npc.id;
    dialogue.lineIndex = 0;
    dialogue.lines = lines;
    dialogue.npcName = npc.name;
    dialogue.onFinish = onFinish;

    ui.dialogueName.textContent = npc.name;
    ui.dialogueText.textContent = lines[0] ?? "";
    setAriaHidden(ui.dialogue, false);
    ui.badgeHint.textContent = "提示：對話中（空白鍵 / Enter 下一句，Esc 關閉）";
  }

  function closeDialogue() {
    dialogue.active = false;
    dialogue.npcId = null;
    dialogue.lineIndex = 0;
    dialogue.lines = [];
    dialogue.npcName = "";
    const finish = dialogue.onFinish;
    dialogue.onFinish = null;

    setAriaHidden(ui.dialogue, true);
    ui.badgeHint.textContent = DEFAULT_HINT;
    if (finish) finish();
  }

  function advanceDialogue() {
    if (!dialogue.active) return;
    const next = dialogue.lineIndex + 1;
    if (next >= dialogue.lines.length) {
      closeDialogue();
      return;
    }
    dialogue.lineIndex = next;
    ui.dialogueText.textContent = dialogue.lines[next];
  }

  /** 互動判定：玩家與 NPC 距離 */
  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.hypot(dx, dy);
  }

  function playerCenter() {
    return { cx: player.x + player.w / 2, cy: player.y + player.h / 2 };
  }

  function getNearestNpcWithin(range) {
    const { cx, cy } = playerCenter();
    let best = /** @type {Npc|null} */ (null);
    let bestD = Infinity;
    for (const npc of npcs) {
      const d = dist(cx, cy, npc.x, npc.y);
      if (d <= range && d < bestD) {
        best = npc;
        bestD = d;
      }
    }
    return best;
  }

  const SHOP = {
    x: 680,
    y: 1000,
    r: 34,
  };

  function getShopWithin(range) {
    const { cx, cy } = playerCenter();
    const d = dist(cx, cy, SHOP.x, SHOP.y);
    return d <= range ? d : null;
  }

  function getNearestInteractable(range) {
    const npc = getNearestNpcWithin(range);
    const { cx, cy } = playerCenter();
    const shopD = getShopWithin(range);
    let npcD = null;
    if (npc) npcD = dist(cx, cy, npc.x, npc.y);

    if (shopD != null && (npcD == null || shopD < npcD)) return { kind: "shop", shopD };
    if (npc && npcD != null) return { kind: "npc", npc, npcD };
    return null;
  }

  function giveGiftFromNpc(npc) {
    if (save.givenNpcIds[npc.id]) return;
    save.givenNpcIds[npc.id] = true;
    save.gifts.push({
      id: `${npc.id}-${Date.now()}`,
      name: npc.gift.name,
      desc: npc.gift.desc,
      from: npc.name,
      time: Date.now(),
    });
    writeSave(save);
    updateGiftBadge();
    // 收禮順便給點錢 + 小回血（讓數值系統有感）
    addCoins(10);
    heal(5);
  }

  /** 輸入 */
  const keys = new Set();
  const keyAliases = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

  function isInventoryOpen() {
    return ui.inventory.getAttribute("aria-hidden") === "false";
  }

  function isHelpOpen() {
    return ui.help.getAttribute("aria-hidden") === "false";
  }

  function isOverlayOpen() {
    return isInventoryOpen() || isShopOpen() || isHelpOpen();
  }

  // 只讓「背包」阻擋移動；說明視窗不阻擋（避免第一次進來就覺得不能走）
  function isMovementBlocked() {
    return isInventoryOpen() || isShopOpen();
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key;

    // 避免方向鍵捲動頁面
    if (k.startsWith("Arrow") || k === " " || k === "Enter") e.preventDefault();

    if (k === "Escape") {
      if (dialogue.active) closeDialogue();
      else closeOverlays();
      return;
    }

    if (k === "i" || k === "I") {
      if (dialogue.active) return;
      toggleInventory();
      return;
    }

    if (k === "h" || k === "H") {
      if (dialogue.active) return;
      toggleHelp();
      return;
    }

    // 重置：Shift+R（清空存檔並重新開始）
    if (k === "R") {
      if (dialogue.active) return;
      hardReset();
      return;
    }

    if (k === " " || k === "Enter") {
      if (dialogue.active) {
        advanceDialogue();
        return;
      }
      if (isOverlayOpen()) return;

      const it = getNearestInteractable(72);
      if (it?.kind === "shop") {
        openShop();
        return;
      }
      if (it?.kind === "npc") {
        const npc = it.npc;
        const already = !!save.givenNpcIds[npc.id];
        const extra = already
          ? ["（你已經拿過禮物了，記得去背包看看。）"]
          : ["（你感覺牠把小禮物交到你手上。）"];
        openDialogue(
          npc,
          npc.dialogue.concat(extra),
          () => {
            if (!already) giveGiftFromNpc(npc);
          }
        );
      }
      return;
    }

    // 移動鍵：在對話或「阻擋移動的覆蓋層」時不處理
    if (dialogue.active || isMovementBlocked()) return;

    keys.add(k);
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
  });

  ui.inventoryClose.addEventListener("click", () => closeInventory());
  ui.shopClose.addEventListener("click", () => closeShop());
  ui.helpClose.addEventListener("click", () => closeHelp());

  ui.shopSellAll.addEventListener("click", () => sellAllGifts());
  ui.shopList.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const btn = t?.closest?.("button[data-gift-id]");
    const id = btn?.getAttribute?.("data-gift-id");
    if (id) sellGiftById(id);
  });

  ui.inventoryClear.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    save = loadSave();
    updateGiftBadge();
    updateStatsBadges();
    renderInventory();
  });

  /** 畫面/攝影機 */
  const camera = {
    x: 0,
    y: 0,
    zoom: 1,
    vw: canvas.width,
    vh: canvas.height,
  };

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function getNpcById(id) {
    if (!id) return null;
    for (const npc of npcs) if (npc.id === id) return npc;
    return null;
  }

  function updateCameraZoom(dt) {
    // 對話時放大（room in / zoom in）
    const target = dialogue.active ? 1.35 : 1;
    // 平滑：dt 不同也穩定
    const t = 1 - Math.exp(-10 * dt);
    camera.zoom = lerp(camera.zoom, target, t);
    // 依 zoom 計算視窗大小（世界座標）
    camera.vw = canvas.width / camera.zoom;
    camera.vh = canvas.height / camera.zoom;
  }

  function updateCamera() {
    // 對話中：鏡頭稍微拉向 NPC（但仍保留玩家）
    const pc = playerCenter();
    const npc = dialogue.active ? getNpcById(dialogue.npcId) : null;
    const fx = npc ? (pc.cx + npc.x) / 2 : pc.cx;
    // 因對話框在下方，焦點略往上
    const fy = (npc ? (pc.cy + npc.y) / 2 : pc.cy) - camera.vh * 0.08;

    const targetX = fx - camera.vw / 2;
    const targetY = fy - camera.vh / 2;
    camera.x = clamp(targetX, 0, Math.max(0, WORLD.w - camera.vw));
    camera.y = clamp(targetY, 0, Math.max(0, WORLD.h - camera.vh));
  }

  /** 地圖繪製：簡單瓦片感 + 裝飾 */
  function drawBackground() {
    const vw = camera.vw;
    const vh = camera.vh;
    // 草地底色
    ctx.fillStyle = "#0b1a33";
    ctx.fillRect(0, 0, vw, vh);

    // 瓦片紋理（視差小格）
    const tile = WORLD.tile;
    const startX = Math.floor(camera.x / tile) * tile - camera.x;
    const startY = Math.floor(camera.y / tile) * tile - camera.y;
    for (let y = startY; y < vh; y += tile) {
      for (let x = startX; x < vw; x += tile) {
        const gx = x + camera.x;
        const gy = y + camera.y;
        const noise = (Math.sin(gx * 0.02) + Math.cos(gy * 0.018)) * 0.5;
        const a = 0.06 + (noise + 1) * 0.02;
        ctx.fillStyle = `rgba(124,226,255,${a.toFixed(3)})`;
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // 小路（村莊小徑）
    drawPath([
      { x: 200, y: 940 },
      { x: 520, y: 900 },
      { x: 820, y: 860 },
      { x: 1100, y: 820 },
      { x: 1500, y: 780 },
    ]);
    drawPath([
      { x: 520, y: 900 },
      { x: 520, y: 700 },
      { x: 520, y: 520 },
      { x: 520, y: 420 },
      { x: 520, y: 300 },
    ]);
  }

  function drawPath(points) {
    if (points.length < 2) return;
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(255, 242, 222, 0.25)";
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 176, 87, 0.18)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();

    ctx.restore();
  }

  function drawSolids() {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    for (const s of solids) {
      // 跳過外框巨牆（不畫）
      if (s.w > 5000 || s.h > 5000) continue;

      // 以位置判斷種類（房子 vs 水池 vs 柵欄）
      const isPond = s.x > 1200 && s.y > 600;
      const isFence = s.h <= 45 || s.w <= 45;
      if (isPond) {
        // 水池
        const grad = ctx.createLinearGradient(s.x, s.y, s.x + s.w, s.y + s.h);
        grad.addColorStop(0, "rgba(124,226,255,.25)");
        grad.addColorStop(1, "rgba(166,255,203,.12)");
        ctx.fillStyle = grad;
        roundRectFill(ctx, s.x, s.y, s.w, s.h, 18);
        ctx.strokeStyle = "rgba(255,255,255,.16)";
        ctx.lineWidth = 2;
        roundRectStroke(ctx, s.x, s.y, s.w, s.h, 18);
      } else if (isFence) {
        ctx.fillStyle = "rgba(255,255,255,.10)";
        roundRectFill(ctx, s.x, s.y, s.w, s.h, 10);
        ctx.strokeStyle = "rgba(255,255,255,.16)";
        ctx.lineWidth = 2;
        roundRectStroke(ctx, s.x, s.y, s.w, s.h, 10);
      } else {
        // 房子
        const roofH = Math.min(46, Math.floor(s.h * 0.25));
        ctx.fillStyle = "rgba(255,255,255,.08)";
        roundRectFill(ctx, s.x, s.y + roofH, s.w, s.h - roofH, 18);
        ctx.fillStyle = "rgba(255,107,136,.12)";
        roundRectFill(ctx, s.x, s.y, s.w, roofH + 6, 18);
        ctx.strokeStyle = "rgba(255,255,255,.16)";
        ctx.lineWidth = 2;
        roundRectStroke(ctx, s.x, s.y, s.w, s.h, 18);

        // 門
        ctx.fillStyle = "rgba(0,0,0,.18)";
        const doorW = 42;
        const doorH = 58;
        roundRectFill(ctx, s.x + s.w / 2 - doorW / 2, s.y + s.h - doorH - 10, doorW, doorH, 12);
      }
    }

    ctx.restore();
  }

  function drawNpc(npc) {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // 影子
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath();
    ctx.ellipse(npc.x, npc.y + 18, npc.r * 0.9, npc.r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // 優先用圖片圖示（像素風：關閉平滑）
    if (npc.spriteSrc) {
      const img = getSprite(npc.spriteSrc);
      if (img.complete && img.naturalWidth > 0) {
        const prevSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        const scale = npc.spriteScale ?? 1.45;
        const size = npc.r * 2 * scale; // 以直徑為基準縮放
        const dx = npc.x - size / 2;
        const dy = npc.y + npc.r - size; // 讓圖片底部貼近「腳底」
        ctx.drawImage(img, dx, dy, size, size);
        ctx.imageSmoothingEnabled = prevSmoothing;
        // 名牌（靠近時顯示）
        const near = getNearestNpcWithin(72);
        if (near && near.id === npc.id && !dialogue.active) {
          const given = !!save.givenNpcIds[npc.id];
          const label = given ? `${npc.name}（已收禮）` : npc.name;
          drawNameTag(npc.x, npc.y - npc.r - 18, label);
        }
        ctx.restore();
        return;
      }
    }

    // 身體
    ctx.fillStyle = npc.palette.base;
    ctx.beginPath();
    ctx.arc(npc.x, npc.y, npc.r, 0, Math.PI * 2);
    ctx.fill();

    // 花色點點
    ctx.fillStyle = npc.palette.spot;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(npc.x - npc.r * 0.25, npc.y - npc.r * 0.15, npc.r * 0.42, 0, Math.PI * 2);
    ctx.arc(npc.x + npc.r * 0.18, npc.y + npc.r * 0.12, npc.r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 眼睛
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.beginPath();
    ctx.arc(npc.x - 7, npc.y - 4, 2.6, 0, Math.PI * 2);
    ctx.arc(npc.x + 7, npc.y - 4, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // 名牌（靠近時顯示）
    const near = getNearestNpcWithin(72);
    if (near && near.id === npc.id && !dialogue.active) {
      const given = !!save.givenNpcIds[npc.id];
      const label = given ? `${npc.name}（已收禮）` : npc.name;
      drawNameTag(npc.x, npc.y - npc.r - 18, label);
    }

    ctx.restore();
  }

  function drawNameTag(x, y, text) {
    ctx.save();
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial";
    const padX = 10;
    const w = ctx.measureText(text).width + padX * 2;
    const h = 24;
    const rx = x - w / 2;
    const ry = y - h / 2;
    ctx.fillStyle = "rgba(10, 14, 28, .75)";
    roundRectFill(ctx, rx, ry, w, h, 999);
    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.lineWidth = 1;
    roundRectStroke(ctx, rx, ry, w, h, 999);
    ctx.fillStyle = "rgba(124,226,255,.95)";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rx + padX, ry + h / 2);
    ctx.restore();
  }

  function drawPlayer() {
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // 影子
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(player.x + player.w / 2, player.y + player.h + 6, 16, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 玩家圖片圖示（像素風：關閉平滑）
    {
      const img = getSprite(getPlayerSpriteSrc());
      if (img.complete && img.naturalWidth > 0) {
        const prevSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        const size = Math.max(player.w, player.h) * PLAYER_SPRITE_SCALE;
        const dx = player.x + player.w / 2 - size / 2;
        const dy = player.y + player.h - size; // 讓圖片底部貼近「腳底」
        ctx.drawImage(img, dx, dy, size, size);
        ctx.imageSmoothingEnabled = prevSmoothing;
        ctx.restore();
        return;
      }
    }

    // 身體
    const bodyGrad = ctx.createLinearGradient(player.x, player.y, player.x, player.y + player.h);
    bodyGrad.addColorStop(0, "rgba(124,226,255,.95)");
    bodyGrad.addColorStop(1, "rgba(166,255,203,.65)");
    ctx.fillStyle = bodyGrad;
    roundRectFill(ctx, player.x, player.y, player.w, player.h, 10);

    // 面向小三角
    ctx.fillStyle = "rgba(255,255,255,.85)";
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    ctx.beginPath();
    if (player.facing === "up") {
      ctx.moveTo(cx, player.y + 6);
      ctx.lineTo(cx - 5, player.y + 14);
      ctx.lineTo(cx + 5, player.y + 14);
    } else if (player.facing === "down") {
      ctx.moveTo(cx, player.y + player.h - 6);
      ctx.lineTo(cx - 5, player.y + player.h - 14);
      ctx.lineTo(cx + 5, player.y + player.h - 14);
    } else if (player.facing === "left") {
      ctx.moveTo(player.x + 6, cy);
      ctx.lineTo(player.x + 14, cy - 5);
      ctx.lineTo(player.x + 14, cy + 5);
    } else {
      ctx.moveTo(player.x + player.w - 6, cy);
      ctx.lineTo(player.x + player.w - 14, cy - 5);
      ctx.lineTo(player.x + player.w - 14, cy + 5);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function roundRectFill(c, x, y, w, h, r) {
    roundRectPath(c, x, y, w, h, r);
    c.fill();
  }

  function roundRectStroke(c, x, y, w, h, r) {
    roundRectPath(c, x, y, w, h, r);
    c.stroke();
  }

  /** 更新：移動與碰撞 */
  let lastTs = performance.now();

  function step(ts) {
    const dt = Math.min(0.033, Math.max(0.001, (ts - lastTs) / 1000));
    lastTs = ts;

    update(dt);
    render();
    requestAnimationFrame(step);
  }

  function update(dt) {
    if (!dialogue.active && !isMovementBlocked()) {
      let vx = 0;
      let vy = 0;
      if (keys.has("ArrowUp")) vy -= 1;
      if (keys.has("ArrowDown")) vy += 1;
      if (keys.has("ArrowLeft")) vx -= 1;
      if (keys.has("ArrowRight")) vx += 1;

      if (vx !== 0 || vy !== 0) {
        // 朝向
        if (Math.abs(vx) > Math.abs(vy)) player.facing = vx < 0 ? "left" : "right";
        else player.facing = vy < 0 ? "up" : "down";
      }

      // 正規化
      const mag = Math.hypot(vx, vy) || 1;
      vx /= mag;
      vy /= mag;

      const dx = vx * player.speed * dt;
      const dy = vy * player.speed * dt;

      // X 軸碰撞
      if (dx !== 0) {
        const next = { x: player.x + dx, y: player.y, w: player.w, h: player.h };
        if (!collides(next, solids)) player.x += dx;
      }
      // Y 軸碰撞
      if (dy !== 0) {
        const next = { x: player.x, y: player.y + dy, w: player.w, h: player.h };
        if (!collides(next, solids)) player.y += dy;
      }
    }

    // NPC 閒晃：對話中先暫停（避免互動時飄走）
    if (!dialogue.active) updateNpcWander(dt);
    updateMobs(dt);
    updateHintOverride(performance.now());

    updateCameraZoom(dt);
    updateCamera();

    // 靠近提示
    if (!dialogue.active && !isOverlayOpen()) {
      const it = getNearestInteractable(72);
      if (it?.kind === "shop") showPrompt("開商店（售出禮物換錢幣）");
      else if (it?.kind === "npc") {
        const given = !!save.givenNpcIds[it.npc.id];
        showPrompt(given ? "與貓咪聊天（已拿過禮物）" : "跟貓咪聊天並拿小禮物");
      } else hidePrompt();
    } else {
      hidePrompt();
    }
  }

  function render() {
    // 先用 1x 變換清除畫布
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 縮放（zoom）：在縮放座標系中繪製世界
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);

    drawBackground();
    drawSolids();
    drawShop();

    // 盜賊/凶狠貓
    for (const m of mobs) drawMob(m);

    // NPC
    for (const npc of npcs) drawNpc(npc);

    // 玩家
    drawPlayer();

    // 迷你裝飾：一些發光點（firefly）
    drawFireflies();

    ctx.restore();
  }

  function drawFireflies() {
    const count = 24;
    const vw = camera.vw;
    const vh = camera.vh;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const px = (Math.sin(i * 77.7 + lastTs * 0.0006) * 0.5 + 0.5) * WORLD.w;
      const py = (Math.cos(i * 31.3 + lastTs * 0.0007) * 0.5 + 0.5) * WORLD.h;
      const sx = px - camera.x;
      const sy = py - camera.y;
      if (sx < -30 || sy < -30 || sx > vw + 30 || sy > vh + 30) continue;
      const a = 0.12 + (Math.sin(lastTs * 0.003 + i) + 1) * 0.08;
      ctx.fillStyle = `rgba(166,255,203,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 初始 UI
  updateGiftBadge();
  updateStatsBadges();
  hidePrompt();
  closeDialogue();
  closeOverlays();

  initNpcWander();
  initMobs();

  // 小提示：首次進來自動開說明
  const seen = localStorage.getItem(FIRST_VISIT_KEY) === "1";
  if (!seen) {
    localStorage.setItem(FIRST_VISIT_KEY, "1");
    openHelp();
  }

  requestAnimationFrame(step);
})();
