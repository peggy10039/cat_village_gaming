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
  /** @typedef {{ gifts: Gift[]; givenNpcIds: Record<string, boolean> }} SaveData */

  /** @returns {SaveData} */
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { gifts: [], givenNpcIds: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { gifts: [], givenNpcIds: {} };
      return {
        gifts: Array.isArray(parsed.gifts) ? parsed.gifts : [],
        givenNpcIds: parsed.givenNpcIds && typeof parsed.givenNpcIds === "object" ? parsed.givenNpcIds : {},
      };
    } catch {
      return { gifts: [], givenNpcIds: {} };
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

  /** @typedef {{ id:string; name:string; x:number; y:number; r:number; palette: {base:string; spot:string}; spriteSrc?: string; spriteScale?: number; dialogue: string[]; gift: { name:string; desc:string } }} Npc */
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
      dialogue: [
        "看好腳步，方向鍵要穩，轉向要果斷。",
        "靠近我時，空白鍵能打開話匣子（也能打開你的勇氣）。",
        "拿去吧，這是「練功用的貓毛」，別告訴別人。",
      ],
      gift: { name: "虎斑師傅的練功毛", desc: "硬挺又有彈性，像是在說：再走一步。" },
    },
  ];

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
  const PLAYER_SPRITE_SRC = "./assets/user/user01.png";
  const PLAYER_SPRITE_SCALE = 2.2;

  // 預先載入所有 NPC 圖示
  for (const npc of npcs) {
    if (npc.spriteSrc) getSprite(npc.spriteSrc);
  }
  // 預先載入玩家圖示
  getSprite(PLAYER_SPRITE_SRC);

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
    ui.badgeHint.textContent = "提示：靠近 NPC 會出現「可互動」";
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
    return isInventoryOpen() || isHelpOpen();
  }

  // 只讓「背包」阻擋移動；說明視窗不阻擋（避免第一次進來就覺得不能走）
  function isMovementBlocked() {
    return isInventoryOpen();
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

      const npc = getNearestNpcWithin(72);
      if (npc) {
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
  ui.helpClose.addEventListener("click", () => closeHelp());

  ui.inventoryClear.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    save = loadSave();
    updateGiftBadge();
    renderInventory();
  });

  /** 畫面/攝影機 */
  const camera = {
    x: 0,
    y: 0,
  };

  function updateCamera() {
    const targetX = player.x + player.w / 2 - canvas.width / 2;
    const targetY = player.y + player.h / 2 - canvas.height / 2;
    camera.x = clamp(targetX, 0, WORLD.w - canvas.width);
    camera.y = clamp(targetY, 0, WORLD.h - canvas.height);
  }

  /** 地圖繪製：簡單瓦片感 + 裝飾 */
  function drawBackground() {
    // 草地底色
    ctx.fillStyle = "#0b1a33";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 瓦片紋理（視差小格）
    const tile = WORLD.tile;
    const startX = Math.floor(camera.x / tile) * tile - camera.x;
    const startY = Math.floor(camera.y / tile) * tile - camera.y;
    for (let y = startY; y < canvas.height; y += tile) {
      for (let x = startX; x < canvas.width; x += tile) {
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
      const img = getSprite(PLAYER_SPRITE_SRC);
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

    updateCamera();

    // 靠近提示
    if (!dialogue.active && !isOverlayOpen()) {
      const npc = getNearestNpcWithin(72);
      if (npc) {
        const given = !!save.givenNpcIds[npc.id];
        showPrompt(given ? "與貓咪聊天（已拿過禮物）" : "跟貓咪聊天並拿小禮物");
      } else {
        hidePrompt();
      }
    } else {
      hidePrompt();
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    //drawBackground();
    drawSolids();

    // NPC
    for (const npc of npcs) drawNpc(npc);

    // 玩家
    drawPlayer();

    // 迷你裝飾：一些發光點（firefly）
    drawFireflies();
  }

  function drawFireflies() {
    const count = 24;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const px = (Math.sin(i * 77.7 + lastTs * 0.0006) * 0.5 + 0.5) * WORLD.w;
      const py = (Math.cos(i * 31.3 + lastTs * 0.0007) * 0.5 + 0.5) * WORLD.h;
      const sx = px - camera.x;
      const sy = py - camera.y;
      if (sx < -30 || sy < -30 || sx > canvas.width + 30 || sy > canvas.height + 30) continue;
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
  hidePrompt();
  closeDialogue();
  closeOverlays();

  // 小提示：首次進來自動開說明
  const seen = localStorage.getItem(FIRST_VISIT_KEY) === "1";
  if (!seen) {
    localStorage.setItem(FIRST_VISIT_KEY, "1");
    openHelp();
  }

  requestAnimationFrame(step);
})();
