/**
 * Game messages (log lines, errors) travel between players as language-neutral codes,
 * e.g. "@log.rolls|{"name":"Ana","n":8}". Each screen translates them into its own language.
 */
export type MsgParams = Record<string, string | number>;

export const M = (key: string, params?: MsgParams): string =>
  '@' + key + (params ? '|' + JSON.stringify(params) : '');

export function decodeMsg(s: string): { key: string; params: MsgParams } | null {
  if (!s.startsWith('@')) return null;
  const bar = s.indexOf('|');
  if (bar < 0) return { key: s.slice(1), params: {} };
  try {
    return { key: s.slice(1, bar), params: JSON.parse(s.slice(bar + 1)) };
  } catch {
    return { key: s.slice(1, bar), params: {} };
  }
}
