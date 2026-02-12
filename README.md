# 貓咪村莊 RPG（網頁 2D 原型）

這是一個可直接打開遊玩的 2D RPG 原型：在「貓咪村莊」裡用方向鍵移動，靠近不同花色的貓咪 NPC 觸發對話並獲得小禮物（貓毛、鬍鬚等），禮物會放進背包並自動存檔在瀏覽器（localStorage）。

## 怎麼玩

- **打開方式**：直接用瀏覽器開啟 `index.html` 即可
- **移動**：方向鍵（↑↓←→）
- **互動/下一句**：空白鍵（或 Enter）
- **背包**：I
- **操作說明**：H
- **關閉視窗/對話**：Esc

## 存檔

- 禮物與「是否已領取」狀態會存在瀏覽器 localStorage
- 在背包內點 **重新開始（清空背包）** 可清除存檔

## 檔案結構

- `index.html`：UI 版面與 HUD
- `styles.css`：介面與視覺樣式
- `game.js`：遊戲邏輯（地圖/碰撞/玩家/貓咪 NPC/對話/背包）

you can see it on website : https://peggy10039.github.io/cat_village_gaming/index.html

