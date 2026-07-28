import { Prisma } from '@prisma/client';
import type { CampaignStatus } from '@prisma/client';

/**
 * 活动行锁。旅程写入与状态切换共用这一份读取，避免两个方向的锁语义各自漂移。
 *
 * 必须在调用方自己的事务里调用：锁持有到事务结束，两种锁互斥，所以“恢复已提交”和
 * “仍在按暂停状态写入旅程”不可能同时成立。仅用带状态条件的写入不够：普通读取不等待
 * 别人的行锁，读取时的快照仍可能是可编辑状态。
 *
 * 返回 `null` 表示活动已不存在，由调用方按自己的业务语义给出错误。
 */
export async function lockCampaignForJourneyWrite(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<CampaignStatus | null> {
  return lockCampaign(tx, campaignId, 'SHARE');
}

/** 启动、暂停、恢复、停止前锁定目标活动；排他锁会等待在途的旅程写入提交。 */
export async function lockCampaignForTransition(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<CampaignStatus | null> {
  return lockCampaign(tx, campaignId, 'UPDATE');
}

async function lockCampaign(
  tx: Prisma.TransactionClient,
  campaignId: string,
  mode: 'SHARE' | 'UPDATE',
): Promise<CampaignStatus | null> {
  // mode 只来自上面两个内部调用，不是外部输入。
  const rows = await tx.$queryRaw<Array<{ status: CampaignStatus }>>`
    SELECT "status" FROM "campaigns" WHERE "id" = ${campaignId}::uuid FOR ${Prisma.raw(mode)}
  `;
  return rows[0]?.status ?? null;
}
