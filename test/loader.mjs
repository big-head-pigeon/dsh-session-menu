/**
 * 解析钩子：让宿主半测试在应用之外也能 import 它的 peer 依赖。
 *
 * 只拦截这一个包名（指向 test/stub-typert-protocol.mjs），其余走 Node 原生解析。
 */
export async function resolve(specifier, context, nextResolve) {
	if (specifier === "@deepseek-ai/dsh-typert-protocol") {
		return { url: new URL("./stub-typert-protocol.mjs", import.meta.url).href, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}
