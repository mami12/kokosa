import {createHash} from 'node:crypto';

const anonymousIdentity = row => 'anonymous:' + createHash('sha256').update(JSON.stringify([
  row?.type ?? null,
  row?.team ?? null,
  row?.gt ?? row?.minute ?? row?.time ?? null,
  row?.clk ?? null,
  row?.pl ?? null,
  row?.playerId ?? row?.player_id ?? null,
  row?.cardColor ?? row?.card_color ?? row?.color ?? null
])).digest('hex').slice(0, 32);

/**
 * Give every row in one provider snapshot a stable identity.
 * Provider IDs are retained; repeated IDs receive deterministic occurrence
 * suffixes. Rows without IDs use a content fingerprint plus the same
 * occurrence rule. Repeated polling snapshots therefore produce the same IDs
 * without collapsing two incidents contained in a single snapshot.
 */
export function zizobetEventIdentities(rows) {
  if (!Array.isArray(rows)) return [];
  const occurrences = new Map();
  return rows.map((row, index) => {
    const rawId = row?.id;
    const base = rawId != null && String(rawId).trim() !== ''
      ? String(rawId).trim()
      : anonymousIdentity(row);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      id: occurrence === 1 ? base : base + '#' + String(occurrence).padStart(6, '0'),
      sequence: index + 1,
      occurrence
    };
  });
}
