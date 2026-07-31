import { describe, expect, it } from 'vitest';
import { eventIngestSchema } from './event.js';

const eventId = '3f1c9f1e-2b7a-4d5c-8e9f-0a1b2c3d4e5f';

function browseEvent(payload: Record<string, unknown> = { productId: 'product-1' }) {
  return {
    id: eventId,
    audienceExternalId: 'upstream:demo:eligible',
    type: 'product_viewed',
    payload,
  };
}

describe('上游行为接收契约', () => {
  it('接受带必填标识的行为，并规范化用户 ID 首尾空格', () => {
    const parsed = eventIngestSchema.parse({
      ...browseEvent({ productId: 'product-1', price: 299 }),
      audienceExternalId: '  upstream:demo:eligible  ',
    });
    expect(parsed.audienceExternalId).toBe('upstream:demo:eligible');
    expect(parsed.payload).toEqual({ productId: 'product-1', price: 299 });
  });

  it('各行为的必填标识缺失、空白或 null 时拒绝', () => {
    const cases = [
      { type: 'product_viewed', payload: {} },
      { type: 'product_viewed', payload: { productId: '   ' } },
      { type: 'product_viewed', payload: { productId: null } },
      { type: 'purchase_completed', payload: { productId: 'product-1' } },
      { type: 'reservation_created', payload: {} },
      { type: 'app_session_started', payload: {} },
      { type: 'app_exit', payload: {} },
    ];
    for (const value of cases) {
      expect(eventIngestSchema.safeParse({ ...browseEvent(), ...value }).success).toBe(false);
    }

    expect(
      eventIngestSchema.safeParse({
        ...browseEvent(),
        type: 'purchase_completed',
        payload: { orderId: 'order-1' },
      }).success,
    ).toBe(true);
    expect(
      eventIngestSchema.safeParse({
        ...browseEvent(),
        type: 'registration_completed',
        payload: {},
      }).success,
    ).toBe(true);
  });

  it('拒绝目录外的属性、错误类型和多余请求字段', () => {
    expect(
      eventIngestSchema.safeParse(browseEvent({ productId: 'product-1', userProfile: {} })).success,
    ).toBe(false);
    expect(
      eventIngestSchema.safeParse(browseEvent({ productId: 'product-1', price: -1 })).success,
    ).toBe(false);
    expect(eventIngestSchema.safeParse({ ...browseEvent(), type: 'unknown_event' }).success).toBe(
      false,
    );
    expect(eventIngestSchema.safeParse({ ...browseEvent(), status: 'completed' }).success).toBe(
      false,
    );
    expect(eventIngestSchema.safeParse({ ...browseEvent(), id: 'not-a-uuid' }).success).toBe(false);
  });
});
