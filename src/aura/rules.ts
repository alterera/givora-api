export type AuraTierId = 'spark' | 'ember' | 'radiant' | 'celestial' | 'icon';

export type AuraTier = {
  id: AuraTierId;
  name: string;
  min: number;
  max: number | null;
};

export const AURA_TIERS: AuraTier[] = [
  { id: 'spark', name: 'Spark', min: 0, max: 24 },
  { id: 'ember', name: 'Ember', min: 25, max: 99 },
  { id: 'radiant', name: 'Radiant', min: 100, max: 249 },
  { id: 'celestial', name: 'Celestial', min: 250, max: 599 },
  { id: 'icon', name: 'Icon', min: 600, max: null },
];

export const MILESTONE_DEFS: Record<
  string,
  { label: string; points: number; description: string }
> = {
  FIRST_GIFT: {
    label: 'First gift',
    points: 10,
    description: 'Sent your first qualifying gift to a creator.',
  },
  THREE_CREATORS: {
    label: 'Three creators',
    points: 15,
    description: 'Supported three different creators with gifts.',
  },
  GOODS_1000: {
    label: 'Generous spirit',
    points: 25,
    description: 'Gifted ₹1,000 or more in products to creators.',
  },
};

export const GOODS_MILESTONE_PAISE = 100_000;

export function tierForEarnedAura(earnedAura: number): AuraTier {
  const score = Math.max(0, earnedAura);
  for (let i = AURA_TIERS.length - 1; i >= 0; i--) {
    if (score >= AURA_TIERS[i].min) return AURA_TIERS[i];
  }
  return AURA_TIERS[0];
}

export function tierProgress(earnedAura: number) {
  const tier = tierForEarnedAura(earnedAura);
  const next = AURA_TIERS.find((t) => t.min > tier.min) ?? null;
  if (!next) {
    return { tier, nextTier: null, pointsToNext: 0, progressPercent: 100 };
  }
  const span = next.min - tier.min;
  const into = earnedAura - tier.min;
  const pointsToNext = Math.max(0, next.min - earnedAura);
  const progressPercent = span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 0;
  return { tier, nextTier: next, pointsToNext, progressPercent };
}

/** Earned Aura from gift goods only (excludes shipping). */
export function auraFromGiftGoodsPaise(goodsPaise: number, paisePerPoint: number): number {
  if (goodsPaise <= 0 || paisePerPoint <= 0) return 0;
  return Math.floor(goodsPaise / paisePerPoint);
}

export function giftGoodsPaise(unitPricePaise: number, quantity: number): number {
  return unitPricePaise * quantity;
}
