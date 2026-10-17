<div align="center">

<img src="https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/icon.svg" width="96" alt="dsh-session-menu">

# dsh-session-menu

為 DSH（DeepSeek Harness）側邊欄的工作階段右鍵選單補上標記為未讀、複製工作階段資訊、在 Finder 中顯示或換 IDE 開啟、
永久刪除工作階段；每一列工作階段還加上了狀態點、懸浮卡資訊，以及封存後的一鍵刪除。

[![npm](https://img.shields.io/npm/v/dsh-session-menu?label=npm&color=%234D6BFE)](https://www.npmjs.com/package/dsh-session-menu)
[![license](https://img.shields.io/badge/license-MIT-%234D6BFE)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-%234D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | [简体中文](README.zh.md) | **繁體中文**

[介面](#介面) · [安裝](#安裝) · [解除安裝](#解除安裝) · [設定](#設定) · [進階設定](#進階設定)

</div>

## 介面

| 工作階段右鍵選單 | 列首狀態點 |
|---|---|
| ![選單](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/02-menu.zh.png) | ![狀態點](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/01-states.zh.png) |

| 懸浮卡 | 封存列一鍵刪除 + 批次入口 |
|---|---|
| ![懸浮卡](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/05-hover.zh.png) | ![批次](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/06-bulk.zh.png) |

| 永久刪除的二次確認 | 封存列的右鍵選單 |
|---|---|
| ![刪除](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/03-delete.zh.png) | ![封存列](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/04-row.zh.png) |

安裝完成後，在 **Settings → Plugins → Installed** 裡看起來像這樣：

![外掛清單裡的工作階段選單](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/07-plugin.zh.png)

![工作階段選單設定](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/08-settings.zh.png)

## 安裝

三種方式都是從這個外掛在 npm 上的套件（`dsh-session-menu`）安裝。

### 方式一：在 DSH 介面裡安裝（推薦）

1. 開啟 DSH，點左側欄的 **外掛**
2. 點右上角的 **新增外掛**
3. 在輸入框裡填入 `dsh-session-menu`，點 **安裝**
4. **重新啟動 DSH 應用程式**

### 方式二：讓 Agent 安裝

把下面這句傳給 DSH 裡的 Agent：

```
用外掛管理器安裝 dsh-session-menu，裝完提醒我重新啟動 DSH 應用程式。
```

### 方式三：用 Terminal 安裝

熟悉命令列的話：開啟 macOS 的「**Terminal**」應用程式（`⌘ + 空白鍵` 搜尋「Terminal」），貼上這行按 Enter。

```sh
dsh plugin --profile desktop add dsh-session-menu
```

把 `desktop` 換成你自己的 profile 名稱（`ls ~/.dsh/profiles` 可以看到，常見的是 `desktop` 或 `web`）。
安裝完成後同樣要**重新啟動 DSH 應用程式**。

## 解除安裝

**Settings → Plugins → Installed**，點 `dsh-session-menu` 那一列右側的垃圾桶圖示，確認即可。

## 設定

安裝好之後，外掛會在設定裡多一塊 **工作階段選單**，裡面是 8 個開關：

標記未讀 · 複製 · 在檔案管理員中顯示 · 開啟方式 · 永久刪除工作階段 · 刪除所有已封存工作階段 · 狀態點 · 懸浮卡

關掉哪一項，它就**立刻**從右鍵選單和工作階段列上消失（不用重新啟動）。開關存在瀏覽器本機。

其中「**複製**」和「**開啟方式**」左邊的三角形可以展開，單獨開關二級選單裡的每一項；一級關掉時二級跟著變灰。

「**複製工作階段 ID**」是核心後來才有的：核心已經有這條時，我們那條同名子項預設是關的，「複製」也跟著
只剩一條；想兩條都要，在設定裡把它打開即可。

> 如果你的 DSH 是自帶同名功能的社群版，在這裡把重複的幾項關掉就好。

## 進階設定

「開啟方式」子選單裡的應用程式可以自行設定。在 profile 的 `cordis.patch.yml` 裡加上一段：

```yaml
config:
  applications:
    - kind: editor
      paths:
        - /Applications/Visual Studio Code.app
    - kind: terminal
      paths:
        - /System/Applications/Utilities/Terminal.app
```

每一項會依序取用**第一個存在的路徑**，命中的那個才會出現在選單裡。`config` 是**整段替換**，不是附加。改完後重新啟動 DSH。

## 許可

[MIT](LICENSE)
