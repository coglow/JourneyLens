export const executionQueryKeys = {
  lists: ['executions', 'list'] as const,
  list: (input: unknown) => ['executions', 'list', input] as const,
  trace: (id: string) => ['executions', 'trace', id] as const,
};
