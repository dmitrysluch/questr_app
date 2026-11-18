import type { PoolClient } from 'pg';
import { hash } from './auth.ts';
import { AppError } from './errors.ts';
import { grantMember } from './permissions.ts';

export async function redeemInvite(db: PoolClient, userId: string, code: string): Promise<{ inviteId: string; alreadyRedeemed: boolean }> {
  const tokenHash = hash(code);
  // Lock the invite before counting a seat. Concurrent registrations cannot exceed its limit.
  const invite = (await db.query(`SELECT i.id,i.created_by,i.grants_event_creation,i.invite_depth,i.max_redemptions,i.redemption_count,
    i.redeemed_by,i.revoked_at,i.expires_at,
    (i.created_by IS NULL OR EXISTS(SELECT 1 FROM users inviter WHERE inviter.id=i.created_by AND inviter.status='active')) AS issuer_active
    FROM invites i WHERE i.token_hash=$1 FOR UPDATE OF i`, [tokenHash])).rows[0];
  if (!invite) throw new AppError(400, 'INVALID_INVITE');
  const previous = (await db.query('SELECT 1 FROM invite_redemptions WHERE invite_id=$1 AND user_id=$2', [invite.id, userId])).rowCount;
  if (previous) return { inviteId: invite.id, alreadyRedeemed: true };
  if (invite.redeemed_by || invite.revoked_at || invite.expires_at <= new Date() ||
      !invite.issuer_active || invite.redemption_count >= invite.max_redemptions) throw new AppError(400, 'INVALID_INVITE');
  await db.query('INSERT INTO invite_redemptions(invite_id,user_id) VALUES($1,$2)', [invite.id, userId]);
  await db.query(`UPDATE invites SET redemption_count=redemption_count+1,
    redeemed_by=CASE WHEN max_redemptions=1 THEN $2::uuid ELSE NULL END,
    redeemed_at=CASE WHEN max_redemptions=1 THEN now() ELSE NULL END WHERE id=$1`, [invite.id, userId]);
  await grantMember(db, userId, { inviteId: invite.id, eventCreator: invite.grants_event_creation,
    inviteDepth: invite.invite_depth, invitedBy: invite.created_by });
  return { inviteId: invite.id, alreadyRedeemed: false };
}
