import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () =>
    JSON.stringify({
      audienceExternalId: 'upstream:demo:eligible',
      events: [{ type: 'product_viewed', payload: { productId: 'product-1' } }],
    }),
  ),
}));
vi.mock('./prompt.js', () => ({
  readText: vi.fn(async () => 'operator@example.com'),
  readSecret: vi.fn(async () => 'test-password'),
}));

const executionId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';
const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: { 'set-cookie': 'journeylens_session=test-cookie; HttpOnly' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              event: {
                id: '44444444-4444-4444-8444-444444444444',
                receivedAt: '2026-07-30T08:00:00.000Z',
              },
              executions: [{ id: executionId }],
              duplicate: false,
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 404 })),
  );
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('行为注入工具的执行详情链接', () => {
  it('默认向后端发送行为，输出本地前端的详情链接', async () => {
    process.argv = ['node', 'upstream-event.js', '--file', 'sample.json'];
    await import('./upstream-event.js');

    await vi.waitFor(() => {
      expect(console.log).toHaveBeenCalledWith(
        `  执行详情：http://localhost:5173/executions/${executionId}`,
      );
    });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe('http://localhost:3001/api/auth/login');
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe(
      'http://localhost:3001/api/events/ingest',
    );
  });

  it('自定义前后端地址时，链接与请求分别使用各自的地址', async () => {
    process.argv = [
      'node',
      'upstream-event.js',
      '--file',
      'sample.json',
      '--base-url',
      'http://localhost:4001',
      '--web-url',
      'http://localhost:4173/',
    ];
    await import('./upstream-event.js');

    await vi.waitFor(() => {
      expect(console.log).toHaveBeenCalledWith(
        `  执行详情：http://localhost:4173/executions/${executionId}`,
      );
    });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe('http://localhost:4001/api/auth/login');
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe(
      'http://localhost:4001/api/events/ingest',
    );
  });
});
