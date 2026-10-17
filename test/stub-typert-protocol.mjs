/**
 * `@deepseek-ai/dsh-typert-protocol` 的离线替身。
 *
 * 只补 index.js 真正用到的构造语义：把 `{service, serviceKey, namespace}` 绑定挂到服务实例上。
 * 真实的 TypertRemoteService 还负责 `ctx instanceof Context` 时的 invocation accessor，这里不需要。
 */
export class TypertRemoteService {
	constructor(ctx, serviceKey, options = {}) {
		this.ctx = ctx;
		this.name = serviceKey;
		this.typertRemote = Object.freeze({ service: this, serviceKey, namespace: options.namespace ?? serviceKey });
	}
}

export const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
