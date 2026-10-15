import { Injectable } from '@nestjs/common';
import { AuraService } from '../aura/aura.service.js';
import { CreatorsService } from '../creators/creators.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { StreakService } from '../streaks/streak.service.js';

@Injectable()
export class TgMiniAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creators: CreatorsService,
    private readonly aura: AuraService,
    private readonly streak: StreakService,
  ) {}

  async boot(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { creator: { select: { slug: true } } },
    });
    const aura = await this.aura.profile(userId);
    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        telegramUsername: user.telegramUsername,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
      isCreator: Boolean(user.creator),
      creatorSlug: user.creator?.slug ?? null,
      aura,
    };
  }

  async wishlistBundle(userId: string, slugOrCode: string) {
    const wishlist = await this.creators.publicBySlugOrCode(slugOrCode);
    const [invite, streak, aura, viewer] = await Promise.all([
      this.aura.inviteStatus(userId, wishlist.slug),
      this.streak.status(userId, wishlist.slug),
      this.aura.profile(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { creator: { select: { slug: true } } },
      }),
    ]);
    return {
      wishlist,
      invite,
      streak,
      aura,
      boot: {
        user: {
          id: viewer.id,
          displayName: viewer.displayName,
          telegramUsername: viewer.telegramUsername,
          role: viewer.role,
          createdAt: viewer.createdAt.toISOString(),
        },
        isCreator: Boolean(viewer.creator),
        creatorSlug: viewer.creator?.slug ?? null,
      },
    };
  }
}
