const ADJECTIVES = [
  'brave',
  'clever',
  'bold',
  'fiery',
  'spirited',
  'vivid',
  'radiant',
  'lively',
  'vibrant',
  'stellar',
  'vital',
  'crimson',
  'dynamic',
  'graceful',
  'mighty',
  'nimble',
];

const CREATURES = [
  'sparrow',
  'falcon',
  'lynx',
  'parrot',
  'phoenix',
  'tiger',
  'panther',
  'otter',
  'cougar',
  'dragon',
  'wolf',
  'orca',
  'swift',
  'ibis',
  'fox',
  'dolphin',
];

const DEFAULT_STYLE = 'bottts';

const RED_BACKGROUND = 'ff3b30';

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type GeneratedProfile = {
  displayName: string;
  avatarSeed: string;
  avatarStyle: string;
};

export function generateProfileTemplate(userId: string, email?: string | null): GeneratedProfile {
  const source = `${userId}:${email ?? ''}`;
  const hash = hashString(source);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const creature = CREATURES[(hash >>> 6) % CREATURES.length];
  const numeric = ((hash >>> 12) % 90) + 10;
  const avatarSeed = `${adjective}-${creature}-${numeric}`;
  const displayName = `${capitalize(adjective)} ${capitalize(creature)} ${numeric}`;

  return {
    displayName,
    avatarSeed,
    avatarStyle: DEFAULT_STYLE,
  };
}

export function dicebearUrl(seed: string, style = DEFAULT_STYLE): string {
  const searchParams = new URLSearchParams({
    seed,
    backgroundColor: RED_BACKGROUND,
    backgroundType: 'gradientLinear',
  });
  return `https://api.dicebear.com/7.x/${style}/svg?${searchParams.toString()}`;
}
