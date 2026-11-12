import type { Pool, PoolClient } from 'pg';
import type { Draft, ChatMessage, ProfileTag, Proposal, Conversation, Profile } from '../shared/schema.ts';
type Db = Pool | PoolClient;
// Explicit projections keep authentication fields out of profile responses.
export function mapDraft(row: Record<string, any>): Draft {
  return { displayName: row.display_name, avatarId: row.avatar_preset_id, introMarkdown: row.intro_markdown, tags: row.tags, mode: row.mode, currentStep: row.current_step, revision: row.revision };
}
export async function getDraft(db: Db, userId: string): Promise<Draft | null> {
  const { rows } = await db.query('SELECT * FROM profile_drafts WHERE user_id=$1', [userId]);
  return rows[0] ? mapDraft(rows[0]) : null;
}
export async function getProfile(db: Db, userId: string): Promise<Profile | null> {
  const { rows } = await db.query('SELECT display_name,avatar_preset_id,intro_markdown,revision,completed_at FROM profiles WHERE user_id=$1', [userId]);
  if (!rows[0]) return null;
  const { rows: tagRows } = await db.query('SELECT tag_id,custom_label,custom_emoji,locale FROM profile_tags WHERE user_id=$1 ORDER BY position', [userId]);
  const tags: ProfileTag[] = tagRows.map(r => r.tag_id ? { kind: 'catalog', code: r.tag_id } : { kind: 'custom', label: r.custom_label, emoji: r.custom_emoji, locale: r.locale });
  const r = rows[0];
  return { displayName: r.display_name, avatarId: r.avatar_preset_id, introMarkdown: r.intro_markdown, revision: r.revision, completedAt: r.completed_at.toISOString(), tags };
}
export async function getMessages(db: Db, conversationId: string): Promise<ChatMessage[]> {
  const { rows } = await db.query('SELECT id,role,content,created_at,content_review,kind FROM ai_messages WHERE conversation_id=$1 ORDER BY sequence', [conversationId]);
  return rows.map(r => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at.toISOString(), contentReview: r.content_review, kind: r.kind }));
}
export async function getConversation(db: Db, userId: string): Promise<Conversation | null> {
  const { rows } = await db.query("SELECT id,mode FROM ai_conversations WHERE user_id=$1 AND status='active'", [userId]);
  return rows[0] ? { id: rows[0].id, mode: rows[0].mode, messages: await getMessages(db, rows[0].id) } : null;
}
export function mapProposal(row: Record<string, any>): Proposal {
  return { id: row.id, introMarkdown: row.intro_markdown, baseMarkdown: row.base_markdown, changeSummary: row.change_summary, basedOnRevision: row.based_on_draft_revision, suggestedTags: row.suggested_tags, sourceIds: row.source_ids, status: row.status };
}
export async function getProposal(db: Db, userId: string): Promise<Proposal | null> {
  const { rows } = await db.query("SELECT * FROM ai_proposals WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [userId]);
  return rows[0] ? mapProposal(rows[0]) : null;
}
