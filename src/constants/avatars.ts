/**
 * The built-in avatar set.
 *
 * Avatars are a fixed catalogue rather than an image upload, so an account's avatar is
 * stored as `catframe://avatar/<id>` — an identity, not a file. Nothing fetches these:
 * `resolveAvatar` turns the URL back into a swatch the client draws itself. Anything that
 * renders a user avatar must go through here before touching an `<Image>`, because the
 * native image loader has no handler for the `catframe:` scheme and throws on one.
 */

export const AVATAR_SCHEME_PREFIX = 'catframe://avatar/';

export type AvatarSwatch = {
  id: string;
  label: string;
  hue: string;
};

export const AVATARS: readonly AvatarSwatch[] = [
  { id: 'ember', label: 'Ember', hue: '#A63B2E' },
  { id: 'moss', label: 'Moss', hue: '#2F6B4F' },
  { id: 'slate', label: 'Slate', hue: '#4A6D86' },
  { id: 'brass', label: 'Brass', hue: '#A07A2C' },
  { id: 'mulberry', label: 'Mulberry', hue: '#7C4F6B' },
  { id: 'stone', label: 'Stone', hue: '#8A8078' },
];

export const DEFAULT_AVATAR_ID = 'moss';

/**
 * Ids found on existing accounts that are not in the catalogue — palette names, from
 * before the set had ids of its own. Mapping them to their nearest swatch is cheaper than
 * migrating rows. Anything still unrecognised falls back to initials, never to a fetch.
 */
const LEGACY_IDS: Record<string, string> = {
  marmalade: 'ember',
  sage: 'moss',
  paper: 'stone',
};

export function buildAvatarUrl(id: string): string {
  return `${AVATAR_SCHEME_PREFIX}${id}`;
}

/**
 * Returns the swatch a stored avatar URL names, or null when the URL is not ours — a real
 * remote image, an empty value, or an id no longer in the catalogue. Callers treat null as
 * "not a swatch" and fall back to their own handling (a network image, or initials).
 */
export function resolveAvatar(url?: string | null): AvatarSwatch | null {
  if (!url || !url.startsWith(AVATAR_SCHEME_PREFIX)) return null;

  const rawId = url.slice(AVATAR_SCHEME_PREFIX.length);
  const id = LEGACY_IDS[rawId] ?? rawId;

  return AVATARS.find((a) => a.id === id) ?? null;
}

/** True for any URL in our scheme, including ids we no longer recognise. */
export function isAvatarUrl(url?: string | null): boolean {
  return Boolean(url && url.startsWith(AVATAR_SCHEME_PREFIX));
}
