import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { notFound } from '../common/http.js';
import { pageArgs } from '../common/dto/pagination.dto.js';
import type { ProductQuery } from './catalog.dto.js';

const publicProduct = {
  images: { orderBy: { sortOrder: 'asc' as const } },
  variants: { where: { isActive: true }, orderBy: { pricePaise: 'asc' as const } },
  category: true,
  occasion: true,
};

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ProductQuery) {
    const { skip, take, page, pageSize } = pageArgs(query);
    const where = {
      status: 'ACTIVE' as const,
      category: query.category ? { slug: query.category } : undefined,
      occasion: query.occasion ? { slug: query.occasion } : undefined,
      variants: {
        some: {
          isActive: true,
          ...(query.minPaise || query.maxPaise
            ? {
                pricePaise: {
                  gte: query.minPaise,
                  lte: query.maxPaise,
                },
              }
            : {}),
        },
      },
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, include: publicProduct, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: items.map(toPublicProduct),
      page,
      pageSize,
      total,
    };
  }

  async bySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      include: publicProduct,
    });
    if (!product) throw notFound('This gift is not available.');
    return toPublicProduct(product);
  }

  async categories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true, description: true },
    });
  }

  async occasions() {
    return this.prisma.occasion.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }
}

export function toPublicProduct(product: {
  id: string;
  name: string;
  slug: string;
  description: string;
  story: string | null;
    giftedCount: number;
    type: string;
    shippingPaise: number;
    deliveryInfo: string | null;
    refundTerms: string | null;
  category: { name: string; slug: string } | null;
  occasion: { name: string; slug: string } | null;
  images: Array<{ url: string; alt: string | null }>;
  variants: Array<{
    id: string;
    name: string;
    sku: string;
    pricePaise: number;
    compareAtPaise: number | null;
    onHand: number;
    reserved: number;
  }>;
}) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    story: product.story,
    giftedCount: product.giftedCount,
    type: product.type,
    shippingPaise: product.type === 'DIGITAL' ? 0 : product.shippingPaise,
    deliveryInfo: product.deliveryInfo,
    refundTerms: product.refundTerms,
    category: product.category,
    occasion: product.occasion,
    images: product.images,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      pricePaise: variant.pricePaise,
      compareAtPaise: variant.compareAtPaise,
      available: product.type === 'DIGITAL' ? null : Math.max(0, variant.onHand - variant.reserved),
      lowStock: product.type !== 'DIGITAL' && variant.onHand - variant.reserved > 0 && variant.onHand - variant.reserved <= 3,
    })),
  };
}
