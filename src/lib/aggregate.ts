import type { Proxy } from "./types";

export interface SourceProxies {
        id?: number;
        /** 源名称（未配置前缀时作为前缀） */
        name: string;
        /** 节点名前缀；空值时回退到 name */
        prefix?: string | null;
        proxies: Proxy[];
}

export interface AggregateResult {
        proxies: Proxy[];
        /** 因重名被去掉的节点数 */
        duplicates: number;
}

/**
 * 多源聚合：每个节点加源前缀改名（默认 `[源名] 原名`），
 * 按最终名称去重后按源顺序拼接（规格 subscription-serving「多源聚合」）。
 */
export function aggregate(sources: SourceProxies[]): AggregateResult {
        const { proxies, duplicates } = aggregateWithSources(sources);
        return { proxies, duplicates };
}

/** 在真实去重过程中记录节点来源；不依据可伪造/碰撞的名称前缀推断归属。 */
export function aggregateWithSources(
        sources: SourceProxies[],
): AggregateResult & { members: Map<number, string[]> } {
        const members = new Map<number, string[]>();
        const seen = new Set<string>();
        const proxies: Proxy[] = [];
        let duplicates = 0;

        for (const src of sources) {
                const tag =
                        src.prefix && src.prefix.length > 0
                                ? src.prefix
                                : src.name;
                for (const p of src.proxies) {
                        const renamed: Proxy = {
                                ...p,
                                name: `[${tag}] ${p.name}`,
                        };
                        if (seen.has(renamed.name)) {
                                duplicates++;
                                continue;
                        }
                        seen.add(renamed.name);
                        proxies.push(renamed);
                        if (src.id !== undefined) {
                                const own = members.get(src.id) ?? [];
                                own.push(renamed.name);
                                members.set(src.id, own);
                        }
                }
        }
        return { proxies, duplicates, members };
}
