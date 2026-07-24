import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import type { JourneyDraftDefinition } from '@journeylens/shared';
import { ApiError, apiClient } from './api';
import {
  createJourney,
  deleteJourney,
  getJourney,
  getJourneys,
  saveJourneyDraft,
  updateJourney,
} from './journeys';

const mock = new MockAdapter(apiClient);
const campaignId = '2d4f4d57-9d59-4ed5-a2fa-d71733cebb60';
const journeyId = '88a0f727-a226-4cb4-9495-74364f8d0e33';
const account = {
  id: 'd15a0f12-9f6c-4d63-98e4-d5dbe50c9120',
  displayName: 'JourneyLens 管理员',
};
const journey = {
  id: journeyId,
  name: '欢迎旅程',
  description: null,
  revision: 1,
  campaign: { id: campaignId, name: '春季活动', status: 'draft' },
  segment: null,
  draftDefinition: null,
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
  createdBy: account,
  updatedBy: account,
};

beforeEach(() => mock.reset());
afterEach(() => mock.reset());

describe('旅程请求', () => {
  it('按共享分页规则验证参数并省略默认值', async () => {
    mock.onGet(`/campaigns/${campaignId}/journeys`).reply(200, {
      data: [],
      page: { page: 1, pageSize: 10, total: 0 },
    });

    await getJourneys(campaignId, { q: ' 欢迎 ', page: '2', pageSize: '20' });
    await getJourneys(campaignId);

    expect(mock.history.get[0]?.params).toEqual({ q: '欢迎', page: 2, pageSize: 20 });
    expect(mock.history.get[1]?.params).toEqual({});
    const error = await getJourneys(campaignId, { pageSize: '17' }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: '每页条数只能选择 10、20 或 50 条',
    });
    expect(mock.history.get).toHaveLength(2);
  });

  it('创建、读取、修改和删除使用现有旅程接口', async () => {
    mock.onPost(`/campaigns/${campaignId}/journeys`).reply(201, { data: journey });
    mock.onGet(`/journeys/${journeyId}`).reply(200, { data: journey });
    mock.onPatch(`/journeys/${journeyId}`).reply(200, { data: journey });
    mock.onDelete(`/journeys/${journeyId}`).reply(204);

    await createJourney(campaignId, { name: ' 欢迎旅程 ', segmentId: null });
    await getJourney(journeyId);
    await updateJourney(journeyId, {
      revision: 1,
      name: '欢迎旅程',
      description: null,
      segmentId: null,
    });
    await deleteJourney(journeyId);

    expect(JSON.parse(String(mock.history.post[0]?.data))).toEqual({
      name: '欢迎旅程',
      description: null,
      segmentId: null,
    });
    expect(mock.history.get[0]?.url).toBe(`/journeys/${journeyId}`);
    expect(JSON.parse(String(mock.history.patch[0]?.data))).toEqual({
      revision: 1,
      name: '欢迎旅程',
      description: null,
      segmentId: null,
    });
    expect(mock.history.delete[0]?.url).toBe(`/journeys/${journeyId}`);
  });

  it('保存画布草稿时发送修订号和完整定义，并解析服务端返回', async () => {
    const draftDefinition: JourneyDraftDefinition = {
      layoutDirection: 'vertical',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: '开始',
          position: { x: 0, y: 0 },
          entryBehavior: 'product_viewed',
        },
        { id: 'end', type: 'end', name: '结束', position: { x: 0, y: 160 }, note: null },
      ],
      edges: [{ id: 'edge-1', source: 'start', target: 'end' }],
    };
    const savedJourney = { ...journey, revision: 2, draftDefinition };
    mock.onPut(`/journeys/${journeyId}/draft`).reply(200, { data: savedJourney });

    const saved = await saveJourneyDraft(journeyId, {
      revision: 1,
      draftDefinition,
    });

    expect(JSON.parse(String(mock.history.put[0]?.data))).toEqual({
      revision: 1,
      draftDefinition: savedJourney.draftDefinition,
    });
    expect(saved).toEqual(savedJourney);
  });
});
