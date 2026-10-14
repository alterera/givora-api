import { describe, expect, it } from 'vitest';
import {
  auraFromGiftGoodsPaise,
  giftGoodsPaise,
  tierForEarnedAura,
  tierProgress,
} from './rules.js';

describe('aura rules', () => {
  it('awards one aura per 1000 paise of goods', () => {
    expect(auraFromGiftGoodsPaise(10_000, 1000)).toBe(10);
    expect(auraFromGiftGoodsPaise(100, 1000)).toBe(0);
  });

  it('excludes shipping from goods calculation', () => {
    const goods = giftGoodsPaise(100, 1);
    expect(goods).toBe(100);
    expect(auraFromGiftGoodsPaise(goods + 5000, 1000)).toBe(5);
    expect(auraFromGiftGoodsPaise(goods, 1000)).toBe(0);
  });

  it('maps tiers from earned totals', () => {
    expect(tierForEarnedAura(0).id).toBe('spark');
    expect(tierForEarnedAura(25).id).toBe('ember');
    expect(tierForEarnedAura(600).id).toBe('icon');
  });

  it('computes progress to next tier', () => {
    const p = tierProgress(20);
    expect(p.tier.id).toBe('spark');
    expect(p.nextTier?.id).toBe('ember');
    expect(p.pointsToNext).toBe(5);
  });
});
