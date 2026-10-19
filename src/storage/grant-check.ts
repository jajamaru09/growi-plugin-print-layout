import { type GrantSpec, PAGE_GRANT } from '../api/growi-page';

const GRANT_PUBLIC = PAGE_GRANT.public;
const GRANT_LINK_ONLY = PAGE_GRANT.linkOnly;
const GRANT_GROUP = PAGE_GRANT.group;

const groupIdsOf = (info: GrantSpec): Set<string> => new Set(info.grantedGroups.map((g) => g.id));

/** True when the child has exactly the source page's grant, and for a group grant the same groups. */
export function hasSameGrant(source: GrantSpec, child: GrantSpec): boolean {
  if (source.grant !== child.grant) return false;
  if (source.grant !== GRANT_GROUP) return true;
  const sourceGroups = groupIdsOf(source);
  const childGroups = groupIdsOf(child);
  return sourceGroups.size === childGroups.size && [...sourceGroups].every((id) => childGroups.has(id));
}

/**
 * True when the child page would be readable by more people than the source page.
 * A group child of a link-only source counts as wider: its members can find the child
 * without the link, and the child's JSON holds the source page id.
 */
export function isGrantWider(source: GrantSpec, child: GrantSpec): boolean {
  if (child.grant === source.grant) {
    if (child.grant !== GRANT_GROUP) return false;
    const sourceGroups = groupIdsOf(source);
    return !child.grantedGroups.every((g) => sourceGroups.has(g.id));
  }
  if (child.grant === GRANT_PUBLIC) return true;
  if (source.grant === GRANT_PUBLIC) return false;
  // The source is now restricted in a different way than the child; only an owner-only child is narrower.
  return child.grant === GRANT_LINK_ONLY || child.grant === GRANT_GROUP;
}
