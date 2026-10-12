import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { badRequest, forbidden, notFound } from '../common/http.js';
import type { ApplyCreatorDto, PatchCreatorDto } from './creators.dto.js';

const RESERVED = new Set([
  'admin', 'tg', 'orders', 'creator', 'legal', 'api', 'login', 'register', 'checkout', 'gifts', 'account', 'g',
]);

const publicItem = {
  variant: {
    include: {
      product: { include: { images: { orderBy: { sortOrder: 'asc' as const }, take: 1 } } },
    },
  },
};

@Injectable()
export class CreatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async apply(userId: string, dto: ApplyCreatorDto) {
    if (RESERVED.has(dto.slug)) throw badRequest('SLUG_RESERVED', 'Choose another public name.');
    const existing = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (existing) throw badRequest('PROFILE_EXISTS', 'You already have a creator profile.');
    const profile = await this.prisma.creatorProfile.create({
      data: {
        userId,
        slug: dto.slug,
        shortCode: `c_${randomBytes(4).toString('hex')}`,
        displayName: dto.displayName.trim(),
        bio: dto.bio?.trim() ?? '',
        giftNote: dto.giftNote?.trim() ?? '',
        personaDisclosure: dto.personaDisclosure?.trim(),
      },
    });
    await this.audit.log({ actorId: userId, action: 'creator.apply', entity: 'CreatorProfile', entityId: profile.id });
    return this.mine(userId);
  }

  async mine(userId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      include: { wishlist: { include: publicItem, orderBy: { sortOrder: 'asc' } } },
    });
    if (!profile) throw notFound('You have not applied yet.');
    return this.shape(profile, true);
  }

  async patch(userId: string, dto: PatchCreatorDto) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw notFound();
    await this.prisma.creatorProfile.update({
      where: { id: profile.id },
      data: {
        displayName: dto.displayName?.trim(),
        bio: dto.bio?.trim(),
        giftNote: dto.giftNote?.trim(),
        avatarUrl: dto.avatarUrl,
        personaDisclosure: dto.personaDisclosure?.trim(),
      },
    });
    return this.mine(userId);
  }

  async publicBySlug(slug: string) {
    return this.publicWhere({ slug });
  }

  async publicByCode(code: string) {
    return this.publicWhere({ shortCode: code });
  }

  async addWishlist(userId: string, variantId: string) {
    const profile = await this.owned(userId);
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, isActive: true, product: { status: 'ACTIVE' } },
    });
    if (!variant) throw badRequest('VARIANT_UNAVAILABLE', 'That product is not available.');
    const count = await this.prisma.wishlistItem.count({ where: { creatorId: profile.id } });
    await this.prisma.wishlistItem.upsert({
      where: { creatorId_variantId: { creatorId: profile.id, variantId } },
      update: { isVisible: true },
      create: { creatorId: profile.id, variantId, sortOrder: count },
    });
    return this.mine(userId);
  }

  async patchWishlist(userId: string, id: string, data: { sortOrder?: number; isVisible?: boolean }) {
    const profile = await this.owned(userId);
    const item = await this.prisma.wishlistItem.findUnique({ where: { id } });
    if (!item || item.creatorId !== profile.id) throw notFound();
    await this.prisma.wishlistItem.update({ where: { id }, data });
    return this.mine(userId);
  }

  async removeWishlist(userId: string, id: string) {
    const profile = await this.owned(userId);
    const item = await this.prisma.wishlistItem.findUnique({ where: { id } });
    if (!item || item.creatorId !== profile.id) throw notFound();
    await this.prisma.wishlistItem.delete({ where: { id } });
    return this.mine(userId);
  }

  async adminList() {
    return this.prisma.creatorProfile.findMany({ orderBy: { createdAt: 'desc' }, include: { user: true } });
  }

  async setStatus(id: string, status: 'PENDING' | 'APPROVED' | 'SUSPENDED', actorId: string) {
    const profile = await this.prisma.creatorProfile.update({
      where: { id },
      data: { status, approvedAt: status === 'APPROVED' ? new Date() : undefined },
    });
    await this.audit.log({ actorId, action: 'creator.status', entity: 'CreatorProfile', entityId: id, metadata: { status } });
    return profile;
  }

  private async publicWhere(where: { slug: string } | { shortCode: string }) {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { ...where, status: 'APPROVED' },
      include: {
        wishlist: { where: { isVisible: true }, include: publicItem, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!profile) throw notFound('This wishlist is not available.');
    return this.shape(profile, false);
  }

  private async owned(userId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw forbidden('Create a creator profile first.');
    return profile;
  }

  private shape(
    profile: {
      id: string;
      slug: string;
      shortCode: string;
      displayName: string;
      bio: string;
      avatarUrl: string | null;
      giftNote: string;
      personaDisclosure: string | null;
      status: string;
      wishlist: Array<{
        id: string;
        sortOrder: number;
        isVisible: boolean;
        variant: {
          id: string;
          name: string;
          pricePaise: number;
          onHand: number;
          reserved: number;
          product: {
            name: string;
            slug: string;
            description: string;
            type: string;
            shippingPaise: number;
            deliveryInfo: string | null;
            refundTerms: string | null;
            status: string;
            images: Array<{ url: string; alt: string | null }>;
          };
        };
      }>;
    },
    includePrivate: boolean,
  ) {
    return {
      id: profile.id,
      slug: profile.slug,
      shortCode: includePrivate ? profile.shortCode : profile.shortCode,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      giftNote: profile.giftNote,
      personaDisclosure: profile.personaDisclosure,
      status: includePrivate ? profile.status : undefined,
      items: profile.wishlist
        .filter((item) => item.variant.product.status === 'ACTIVE')
        .map((item) => {
          const product = item.variant.product;
          const available = product.type === 'DIGITAL' ? null : Math.max(0, item.variant.onHand - item.variant.reserved);
          return {
            wishlistItemId: item.id,
            sortOrder: item.sortOrder,
            isVisible: includePrivate ? item.isVisible : undefined,
            variantId: item.variant.id,
            variantName: item.variant.name,
            pricePaise: item.variant.pricePaise,
            productName: product.name,
            productSlug: product.slug,
            description: product.description,
            type: product.type,
            shippingPaise: product.type === 'DIGITAL' ? 0 : product.shippingPaise,
            deliveryInfo: product.deliveryInfo,
            refundTerms: product.refundTerms,
            imageUrl: product.images[0]?.url ?? null,
            available,
            lowStock: available !== null && available > 0 && available <= 3,
          };
        }),
    };
  }
}
