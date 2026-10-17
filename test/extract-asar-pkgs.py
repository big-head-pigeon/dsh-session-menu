#!/usr/bin/env python3
"""把真协议验证要用的包从 app.asar 里解出来（/tmp 被系统清理后用它重建）。

用法：
  python3 test/extract-asar-pkgs.py                       # 默认路径，解到 /tmp/dsm-real/node_modules
  python3 test/extract-asar-pkgs.py --out /tmp/xxx/node_modules

解出 @deepseek-ai/dsh-typert-protocol 与 @deepseek-ai/cordis（只取 lib/ 与 package.json），
再从本机 profile 里软链它们的依赖（cosmokit、@standard-schema/spec）。
"""
import argparse
import json
import os
import shutil
import struct
import sys
from pathlib import Path

PACKAGES = ["@deepseek-ai/dsh-typert-protocol", "@deepseek-ai/cordis"]
LINKS = ["@deepseek-ai/cosmokit", "@standard-schema/spec"]


class Asar:
    """极简 asar 读取器：只有目录表 + 按需取文件。"""

    def __init__(self, path):
        self.path = Path(path)
        with self.path.open("rb") as handle:
            header = handle.read(16)
            size = struct.unpack("<I", header[12:16])[0]
            self.directory = json.loads(handle.read(size).decode("utf-8"))
            self.base = 16 + size
            if self.base % 4:
                self.base += 4 - (self.base % 4)

    def walk(self, node=None, prefix="/"):
        node = self.directory if node is None else node
        for name, entry in node.get("files", {}).items():
            path = f"{prefix}{name}"
            if "files" in entry:
                yield from self.walk(entry, f"{path}/")
            else:
                yield path, entry

    def read(self, path):
        entry = self.directory
        for part in path.strip("/").split("/"):
            entry = entry["files"][part]
        with self.path.open("rb") as handle:
            handle.seek(self.base + int(entry["offset"]))
            return handle.read(int(entry["size"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asar", default="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar")
    parser.add_argument("--out", default="/tmp/dsm-real/node_modules")
    parser.add_argument("--profile", default=os.path.expanduser("~/.dsh/profiles/desktop/node_modules"))
    args = parser.parse_args()

    asar = Asar(args.asar)
    out = Path(args.out)
    # Start clean: a leftover file from a previous kernel would silently keep the
    # snapshot looking valid after an update.
    if out.exists():
        shutil.rmtree(out)
    wanted = tuple(f"/dsh/node_modules/{package}/lib/" for package in PACKAGES)
    wanted_files = tuple(f"/dsh/node_modules/{package}/package.json" for package in PACKAGES)
    written = 0
    for path, entry in asar.walk():
        if not (path.startswith(wanted) or path in wanted_files):
            continue
        if "offset" not in entry:
            continue
        target = out / path[len("/dsh/node_modules/"):]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(asar.read(path))
        written += 1
    print(f"解出 {written} 个文件 → {out}")

    # Stamp which kernel these packages came from, so real-protocol.test.mjs can
    # refuse to validate a stale snapshot after a DSH update.
    kernel = None
    for member in ("dsh/package.json", "node_modules/@deepseek-ai/dsh/package.json"):
        try:
            kernel = json.loads(asar.read(member).decode("utf-8"))
            break
        except (KeyError, ValueError):
            kernel = None
    stamp = out.parent / "kernel.json"
    if kernel and kernel.get("version"):
        stamp.write_text(
            json.dumps({"asar": str(args.asar), "package": kernel.get("name"), "version": kernel["version"]}, indent=2),
            encoding="utf-8",
        )
        print(f"内核版本戳 {kernel.get('name')}@{kernel['version']} → {stamp}")
    else:
        print(f"警告：读不到内核版本，未写版本戳 {stamp}（真协议测试将无法确认快照新旧）")

    for name in LINKS:
        source = Path(args.profile) / name
        link = out / name
        if not source.is_dir():
            print(f"警告：profile 里没有 {name}，跳过（真协议启动会失败）")
            continue
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(source)
        print(f"链接 {name} → {source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
