export interface ParsedEntry {
  raw: string;
  type: string;
  value: string;
}

export function parseEntries(text: string, mode: string): ParsedEntry[];
export function ruleHint(rule: { type: string; value: string }): string;
export function renderRoutingPage(page: unknown, deps: unknown): Promise<void>;
