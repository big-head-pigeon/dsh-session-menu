/** 注册 test/loader.mjs 的解析钩子（Node ≥ 20.6）。 */
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
