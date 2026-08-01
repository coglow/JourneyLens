export const eventQueryKeys = {
  list: (input: unknown) => ['events', 'list', input] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  /** 只作前缀使用：刷新行为详情时让该行为的全部分页结果一起重新读取。 */
  relatedJourneys: (id: string) => ['events', 'related-journeys', id] as const,
  relatedJourneysPage: (id: string, page: unknown, pageSize: unknown) =>
    ['events', 'related-journeys', id, page, pageSize] as const,
};
