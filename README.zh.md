<div align="center">

<img src="https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/icon.svg" width="96" alt="dsh-session-menu">

# dsh-session-menu

给 DSH（DeepSeek Harness）侧边栏的会话右键菜单补上标记未读、复制会话信息、在访达中显示或换 IDE 打开、
永久删除会话；每行会话还加了状态点、悬浮卡信息和归档后的一键删除。

[![npm](https://img.shields.io/npm/v/dsh-session-menu?label=npm&color=%234D6BFE)](https://www.npmjs.com/package/dsh-session-menu)
[![license](https://img.shields.io/badge/license-MIT-%234D6BFE)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-%234D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md)

[界面](#界面) · [安装](#安装) · [卸载](#卸载) · [设置](#设置) · [配置](#配置)

</div>

## 界面

| 会话右键菜单 | 行首状态点 |
|---|---|
| ![菜单](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/02-menu.zh.png) | ![状态点](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/01-states.zh.png) |

| 悬浮卡 | 归档行一键删除 + 批量入口 |
|---|---|
| ![悬浮卡](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/05-hover.zh.png) | ![批量](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/06-bulk.zh.png) |

| 永久删除的二次确认 | 归档行的右键菜单 |
|---|---|
| ![删除](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/03-delete.zh.png) | ![归档行](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/04-row.zh.png) |

装好之后，在 **设置 → 插件 → 已安装** 里长这样：

![插件列表里的会话菜单](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/07-plugin.zh.png)

![会话菜单设置](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/08-settings.zh.png)

## 安装

三种方式都是从这个插件在 npm 上的包（`dsh-session-menu`）安装。

### 方式一：在 DSH 界面里装（推荐）

1. 打开 DSH，点左侧栏的 **插件**
2. 点右上角的 **添加插件**
3. 输入框里填 `dsh-session-menu`，点 **安装**
4. **重启 DSH 应用**

### 方式二：让 Agent 装

把下面这句发给 DSH 里的 Agent：

```
用插件管理器安装 dsh-session-menu，装完提醒我重启 DSH 应用。
```

### 方式三：用终端装

会用命令行的话：打开 macOS 的「**终端**」应用（`⌘ + 空格` 搜「终端」），粘贴这行回车。

```sh
dsh plugin --profile desktop add dsh-session-menu
```

把 `desktop` 换成你自己的 profile 名（`ls ~/.dsh/profiles` 能看到，常见的是 `desktop` 或 `web`）。
装完同样要**重启 DSH 应用**。

## 卸载

**设置 → 插件 → 已安装**，点 `dsh-session-menu` 那一行右侧的垃圾桶图标，确认即可。

## 设置

装好之后，插件在设置里多一块 **会话菜单**（`Settings → 会话菜单`），里面是 8 个开关：

标记未读 · 复制 · 在文件管理器中显示 · 打开方式 · 永久删除会话 · 删除所有已归档会话 · 状态点 · 悬浮卡

关掉哪一项，它就**立刻**从右键菜单和会话行上消失（不用重启）。开关存在浏览器本地。

其中「**复制**」和「**打开方式**」左边的三角可以展开，单独开关二级菜单里的每一项；一级关掉时二级跟着变灰。

「**复制会话 ID**」是内核后来才有的：内核已经有了这条时，我们那条同名子项默认是关的，「复制」也跟着
只剩一条；想两条都要，在设置里把它打开即可。

> 如果你的 DSH 是自带同名功能的社区版，在这里把重复的几项关掉就行。

## 配置

「打开方式」二级菜单里的应用可以自己配。在 profile 的 `cordis.patch.yml` 里加一段：

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

每项按顺序取**第一个存在的路径**，命中的那个才会出现在菜单里。`config` 是**整段替换**，不是追加。改完重启 DSH。

## 许可

[MIT](LICENSE)
