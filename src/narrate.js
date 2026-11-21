// Turns engine results into short, plain sentences for the officer.
import { labelOf } from './engine/routing.js';
import { model } from './geometry.js';

const ENTRANCE_SHORT = { 'ent-142': '142 Marlowe', 'ent-144': '144 Marlowe', 'ent-alley': 'the rear alley gate' };
const STAIR_SHORT = { 'stair-a': 'Stair A', 'stair-b': 'Stair B', 'stair-c': 'Stair C' };

export const entranceName = (id) => ENTRANCE_SHORT[id] ?? labelOf(model, id);
export const stairName = (id) => STAIR_SHORT[id] ?? labelOf(model, id);

export function placeName(id) {
  const names = {
    'f4-east-lobby': 'the floor-4 east lobby',
    'door-f4-stair-c': "Stair C's floor-4 door",
    'f4-ne-hall': 'the floor-4 north-east hall',
    'o4-lobby-ecorr': 'the lobby-to-corridor opening on floor 4',
    'o4-ecorr-nehall': 'the north-east hall door on floor 4',
    'stair-c': 'Stair C',
  };
  return names[id] ?? labelOf(model, id);
}

export function routeSummary(route) {
  const rides = route.verticals
    .map((v, i) => (i === 0 ? `${stairName(v.id)} to floor ${v.to_floor}` : `across to ${stairName(v.id)}, up to floor ${v.to_floor}`))
    .join(', ');
  return `${entranceName(route.entrance_id)} → ${rides} → 4C`;
}

export function flagText(f) {
  switch (f.type) {
    case 'unconfirmed_access':
      return 'Alley gate access unconfirmed';
    case 'unclear_drawing':
      return `${placeName(f.element_id)}: drawing unclear ("see note 7", note 7 missing)`;
    case 'unclear_drawing_verified_on_site':
      return `${placeName(f.element_id)}: drawing unclear, verified passable on site`;
    case 'reported': {
      const s = f.condition?.source ?? {};
      return `Reported (unverified): "${s.verbatim ?? ''}" at ${placeName(f.element_id)}`;
    }
    case 'verified_clear':
      return `${placeName(f.element_id)} verified clear by ${f.condition?.source?.unit ?? 'a unit'}`;
    default:
      return f.type;
  }
}

export function narrate(result) {
  if (result.status === 'no_route') {
    return {
      headline: 'No documented route.',
      body: 'With the active assumptions, no documented route reaches 4C. Undo an assumption to bring routes back.',
    };
  }
  const front = result.chokepoints.confirmed;
  const global = result.chokepoints.global;
  const n = result.routes.length;
  const cp = global.primary ?? front.primary;
  const unclear = cp?.flags?.some((f) => f.type === 'unclear_drawing');
  if (global.primary) {
    return {
      headline: `${n} route${n === 1 ? '' : 's'} remain. All of them go through ${placeName(global.primary.id)}.`,
      body: unclear
        ? `That door is the new shared chokepoint, and its drawing is unclear: it says "see note 7", and note 7 is missing. Verify it on arrival.`
        : `That is now a shared chokepoint for every documented route.`,
    };
  }
  if (front.primary) {
    const reported = front.primary.flags.some((f) => f.type === 'reported');
    return {
      headline: `${n} documented routes. Both front approaches, from 142 and 144 Marlowe, reach 4C through ${placeName(front.primary.id)}.`,
      body: reported
        ? 'A caller reported smoke there. It is unverified, so routes still pass it, flagged. Only the rear alley and Stair C avoid it.'
        : 'They look independent from the street but share that lobby (a layout fact, sheet A-4). Only the rear alley and Stair C avoid it; the alley gate is unconfirmed.',
    };
  }
  return { headline: `${n} documented routes reach 4C.`, body: '' };
}
