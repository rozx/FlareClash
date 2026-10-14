export interface RemoteConfig {
  compatibilityDate?: string;
  compatibilityFlags: string[];
  vars: Record<string, string>;
  secrets: string[];
  d1: { binding: string; id: string; name?: string }[];
  kv: { binding: string; id: string }[];
  unsupported: string[];
}

export function parseRemoteConfig(
  version: unknown,
  d1Databases: { uuid: string; name: string }[],
): RemoteConfig;

export function renderWranglerConfig(
  template: string,
  remote: RemoteConfig,
): { content: string; errors: string[]; warnings: string[] };

export function lineDiff(before: string, after: string): string[];
