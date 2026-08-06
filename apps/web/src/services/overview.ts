import { overviewResponseSchema } from '@journeylens/shared';
import { request } from './api';

export async function getOverview(signal?: AbortSignal) {
  const body = await request(
    { url: '/overview', method: 'GET', ...(signal ? { signal } : {}) },
    overviewResponseSchema,
  );
  return body.data;
}
