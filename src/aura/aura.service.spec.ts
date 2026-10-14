import { describe, expect, it, vi } from 'vitest';
import { AuraService } from './aura.service.js';
import { auraFromGiftGoodsPaise } from './rules.js';

describe('AuraService helpers', () => {
  it('skips zero-aura gifts at service level via rules', () => {
    expect(auraFromGiftGoodsPaise(100, 1000)).toBe(0);
  });
});

describe('AuraService acceptInvite', () => {
  it('rejects self-invite', async () => {
    const prisma = {
      creatorProfile: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1',
          userId: 'u1',
          status: 'APPROVED',
          displayName: 'Creator',
        }),
      },
    };
    const config = { get: vi.fn().mockReturnValue(5) };
    const service = new AuraService(prisma as never, config as never);
    await expect(service.acceptInvite('u1', 'slug')).rejects.toMatchObject({
      response: { code: 'SELF_INVITE', message: expect.any(String) },
    });
  });
});
