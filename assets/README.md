# 截图（README 直接引用这些文件名）

这里现在是**从设计稿渲染的图**（`prototype/prototype.html?panel=<id>&bare=1&lang=<zh|en>`，无头 Chrome 3 倍像素，
自动裁边）。要换成实机截图，只要用同名文件覆盖即可。

| 文件名 | 截什么 | 来源面板 |
|---|---|---|
| `01-states.{zh,en}.png` | 会话行行首的状态点（跑动 / 待回复 / 完成未读 / 标记未读 / 报错 / 默认） | `?panel=states` |
| `02-menu.{zh,en}.png` | 右键菜单改造前 / 改造后（含展开的「打开方式」二级菜单） | `?panel=menu` |
| `03-delete.{zh,en}.png` | 永久删除的二次确认弹窗 | `?panel=delete` |
| `04-row.{zh,en}.png` | 归档行的一键删除 + 归档行的右键菜单 | `?panel=row` |
| `05-hover.{zh,en}.png` | 悬浮卡里的会话信息 | `?panel=hover` |
| `06-bulk.{zh,en}.png` | 「工作区」标题行的批量删除入口 | `?panel=bulk` |
| `07-plugin.{zh,en}.png` | 设置 → 插件 → 已安装 列表里的一行 | `?panel=plugin` |
| `08-settings.{zh,en}.png` | 设置页里的「会话菜单」八项开关（含二级折叠） | `?panel=settings` |

中文与繁体共用 `.zh.png`（截图里的中文对两边都成立）；英文用 `.en.png`。

重新出图：

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=3 \
  --window-size=1500,1500 --screenshot=/tmp/x.png \
  "file://$PWD/prototype/prototype.html?panel=menu&bare=1&lang=en"
```

`?bare=1` 去掉标题与右侧注解，`?lang=en` 把演示区文案换成英文。
