export interface ServiceTemplate {
  id: string;
  name: string;
  /** 管理页展示的建议去向 */
  suggested: string;
  rules: { type: string; value: string }[];
}

export const TEMPLATES: ServiceTemplate[];
