import type { PoolClient } from 'pg';
import { hash } from './auth.ts';
import { AppError } from './errors.ts';
import { grantMember } from './permissions.ts';

export async function redeemInvite(db: PoolClient, userId: string, code: string): Promise<{ inviteId: string; alreadyRedeemed: boolean }> {
  const tokenHash = hash(code);
  const { rows } = await db.query(`UPDATE invites i SET redeemed_by=$1,redeemed_at=now()
    WHERE token_hash=$2 AND redeemed_by IS NULL AND revoked_at IS NULL AND expires_at>now()
      AND (created_by IS NULL OR EXISTS(SELECT 1 FROM users inviter WHERE inviter.id=i.created_by AND inviter.status='active'))
    RETURNING id,created_by,grants_event_creation,invite_depth`, [userId, tokenHash]);
  if (!rows[0]) {
    const previous = (await db.query('SELECT id FROM invites WHERE token_hash=$1 AND redeemed_by=$2', [tokenHash, userId])).rows[0];
    if (previous) return { inviteId: previous.id, alreadyRedeemed: true };
    throw new AppError(400, 'INVALID_INVITE');
  }
  const invite = rows[0];
  await grantMember(db, userId, { inviteId: invite.id, eventCreator: invite.grants_event_creation,
    inviteDepth: invite.invite_depth, invitedBy: invite.created_by });
  return { inviteId: invite.id, alreadyRedeemed: false };
}
