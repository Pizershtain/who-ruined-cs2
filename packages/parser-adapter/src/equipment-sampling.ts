import { asInteger, asText } from './decoding.js';
import { loadNativeParser, toRows, type DemoParserPort, type UnknownRow } from './native-adapter.js';

const TICK_PROPERTIES = [
  'team_num', 'is_alive', 'current_equip_value', 'round_start_equip_value',
  'inventory', 'active_weapon_name', 'active_weapon', 'armor_value',
  'has_helmet', 'has_defuser', 'balance', 'cash_spent_this_round', 'total_cash_spent',
] as const;

function readBoolean(row: UnknownRow, key: string): boolean | null {
  return typeof row[key] === 'boolean' ? row[key] : null;
}

function readSide(value: number | null): 'T' | 'CT' | null {
  return value === 2 ? 'T' : value === 3 ? 'CT' : null;
}

export function parseDemoEquipmentTicks(path: string, ticks: readonly number[], parser?: DemoParserPort) {
  if (ticks.length === 0) return [];
  let raw: unknown;
  try {
    raw = (parser ?? loadNativeParser()).parseTicks(path, [...TICK_PROPERTIES], [...ticks]);
  } catch (error) {
    if (error instanceof Error && /^(?:UnknownPropName\(|EntityNotFound$|IllegalPathOp$)/u.test(error.message)) {
      throw new Error('EQUIPMENT_SOURCE_UNAVAILABLE', { cause: error });
    }
    throw error;
  }
  const rows = toRows(raw);
  return rows.map((row, rowIndex) => ({
    rowIndex,
    tick: asInteger(row, ['tick']),
    steamId: asText(row, ['steamid']),
    side: readSide(asInteger(row, ['team_num'])),
    equipmentValue: asInteger(row, ['current_equip_value']),
    roundStartEquipmentValue: asInteger(row, ['round_start_equip_value']),
    inventory: Array.isArray(row.inventory) ? row.inventory.filter((item): item is string => typeof item === 'string') : null,
    activeWeapon: asText(row, ['active_weapon_name']),
    activeWeaponEntityId: asInteger(row, ['active_weapon']),
    armor: asInteger(row, ['armor_value']),
    hasHelmet: readBoolean(row, 'has_helmet'),
    hasDefuser: readBoolean(row, 'has_defuser'),
    balance: asInteger(row, ['balance']),
    cashSpentThisRound: asInteger(row, ['cash_spent_this_round']),
    totalCashSpent: asInteger(row, ['total_cash_spent']),
    alive: readBoolean(row, 'is_alive'),
  }));
}
