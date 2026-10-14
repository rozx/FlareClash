export interface AdminSubscriptionMetadata {
  userInfo?: {
    upload?: number;
    download?: number;
    total?: number;
    expire?: number;
  };
  profileUpdateInterval?: number;
}

export function formatBytes(bytes: number): string;
export function formatUsage(metadata: AdminSubscriptionMetadata | null): string;
export function formatExpire(
  metadata: AdminSubscriptionMetadata | null,
): string;
export function formatInterval(
  metadata: AdminSubscriptionMetadata | null,
): string;

export const REGION_OPTIONS: { value: string; label: string }[];
export function formatRegion(region: string | null | undefined): string;
