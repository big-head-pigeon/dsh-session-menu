<div align="center">

<img src="https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/icon.svg" width="96" alt="dsh-session-menu">

# dsh-session-menu

**English** | [简体中文](README.zh.md) | [繁體中文](README.zh-TW.md)

Adds mark-unread, copy session info, reveal in Finder or open with your IDE, and permanent delete
to the DSH (DeepSeek Harness) sidebar session menu — plus status dots, hover-card details and
one-click delete for archived rows.

[![npm](https://img.shields.io/npm/v/dsh-session-menu?label=npm&color=%234D6BFE)](https://www.npmjs.com/package/dsh-session-menu)
[![license](https://img.shields.io/badge/license-MIT-%234D6BFE)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%2B-%234D6BFE)](https://github.com/deepseek-ai/deepseek-harness)

[UI](#ui) · [Install](#install) · [Uninstall](#uninstall) · [Settings](#settings) · [Configuration](#configuration)

</div>

## UI

| Session menu | Status dots |
|---|---|
| ![session menu](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/02-menu.en.png) | ![status dots](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/01-states.en.png) |

| Hover card | Archived rows: one-click delete + bulk entry |
|---|---|
| ![hover card](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/05-hover.en.png) | ![bulk delete](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/06-bulk.en.png) |

| Delete confirmation | Archived row menu |
|---|---|
| ![delete](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/03-delete.en.png) | ![archived row](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/04-row.en.png) |

Once installed, it looks like this under **Settings → Plugins → Installed**:

![In the plugin list](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/07-plugin.en.png)

![Session menu settings](https://raw.githubusercontent.com/big-head-pigeon/dsh-session-menu/main/assets/08-settings.en.png)

## Install

All three ways install the `dsh-session-menu` package from npm.

### Option 1 — install it inside DSH (recommended)

1. Open DSH and click **Plugins** in the left sidebar
2. Click **Add plugin** in the top right
3. Type `dsh-session-menu` and click **Install**
4. **Restart the DSH app**

### Option 2 — let the Agent install it

Send this to the Agent inside DSH:

```
Install the plugin dsh-session-menu with the plugin manager, then remind me to restart DSH.
```

### Option 3 — install it from the terminal

If you are comfortable with a command line: open macOS's **Terminal** app (`⌘ + Space`, search
"Terminal"), paste this line and press Enter.

```sh
dsh plugin --profile desktop add dsh-session-menu
```

Replace `desktop` with your own profile name (`ls ~/.dsh/profiles` lists them; `desktop` and `web`
are the common ones). Either way, **restart the DSH app** afterwards.

## Uninstall

**Settings → Plugins → Installed**, click the trash icon on the `dsh-session-menu` row and confirm.

## Settings

Once installed, the plugin adds a **Session menu** section under Settings with 8 switches:

Mark as unread · Copy · Show in file manager · Open with · Delete session · Delete all archived sessions · Status dots · Hover card

Turning one off hides it from the context menu and the session rows **immediately** — no restart. The
switches live in this browser.

The triangle next to **Copy** and **Open with** expands them, so every sub-item can be switched on its
own; turning a parent off greys its children out.

**Copy Session ID** is newer than this plugin in the kernel itself: when the kernel already ships that row, our
identical sub-item starts switched off and **Copy** collapses into a single row. Switch it back on to keep both.

> Running a community build that already ships some of these? Turn the duplicates off here.

## Configuration

The apps inside the **Open with ›** submenu are configurable. Add a block to your profile's
`cordis.patch.yml`:

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

Each entry takes the **first path that exists**, and only the matching one shows up in the menu.
`config` **replaces the whole list**, it does not append. Restart DSH after editing.

## License

[MIT](LICENSE)
