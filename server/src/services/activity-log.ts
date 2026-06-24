import { activityLog } from '@aisc/db';
import type { Db } from '@aisc/db';

type ActorType = 'agent' | 'user' | 'system';

interface LogActivityParams {
  db: Db;
  companyId: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  await params.db.insert(activityLog).values({
    companyId: params.companyId,
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    details: params.details ?? {},
  });
}
