import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { badRequest } from '../common/http.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { MediaService } from '../media/media.service.js';
import { CatalogService } from './catalog.service.js';
import {
  CategoryDto,
  CreateProductDto,
  CreateVariantDto,
  PresignDto,
  ProductQuery,
  RegisterImageDto,
  StockAdjustDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './catalog.dto.js';

@ApiTags('catalogue')
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('products')
  products(@Query() query: ProductQuery) {
    return this.catalog.list(query);
  }

  @Public()
  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalog.bySlug(slug);
  }

  @Public()
  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Public()
  @Get('occasions')
  occasions() {
    return this.catalog.occasions();
  }

  @Roles('ADMIN')
  @Post('admin/categories')
  createCategory(@Body() dto: CategoryDto, @CurrentUser() user: AuthUser) {
    return this.prisma.category.create({ data: dto }).then(async (row) => {
      await this.audit.log({ actorId: user.id, action: 'category.create', entity: 'Category', entityId: row.id });
      return row;
    });
  }

  @Roles('ADMIN')
  @Post('admin/products')
  async createProduct(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        story: dto.story,
        categoryId: dto.categoryId,
        occasionId: dto.occasionId,
        status: dto.status ?? 'DRAFT',
        type: dto.type ?? 'PHYSICAL',
        shippingPaise: dto.shippingPaise ?? 0,
        deliveryInfo: dto.deliveryInfo,
        refundTerms: dto.refundTerms,
      },
    });
    await this.audit.log({ actorId: user.id, action: 'product.create', entity: 'Product', entityId: product.id });
    return product;
  }

  @Roles('ADMIN')
  @Patch('admin/products/:id')
  async updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthUser) {
    const product = await this.prisma.product.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: user.id, action: 'product.update', entity: 'Product', entityId: id });
    return product;
  }

  @Roles('ADMIN')
  @Post('admin/products/:id/variants')
  async createVariant(@Param('id') id: string, @Body() dto: CreateVariantDto, @CurrentUser() user: AuthUser) {
    const variant = await this.prisma.productVariant.create({
      data: {
        productId: id,
        sku: dto.sku,
        name: dto.name,
        pricePaise: dto.pricePaise,
        compareAtPaise: dto.compareAtPaise,
        onHand: dto.onHand ?? 0,
      },
    });
    await this.audit.log({ actorId: user.id, action: 'variant.create', entity: 'ProductVariant', entityId: variant.id });
    return variant;
  }

  @Roles('ADMIN')
  @Post('admin/products/:id/images')
  async addImage(@Param('id') id: string, @Body() dto: RegisterImageDto, @CurrentUser() user: AuthUser) {
    const image = await this.prisma.productImage.create({
      data: { productId: id, url: dto.url, alt: dto.alt, sortOrder: dto.sortOrder ?? 0 },
    });
    await this.audit.log({ actorId: user.id, action: 'product.image', entity: 'Product', entityId: id });
    return image;
  }

  @Roles('ADMIN')
  @Patch('admin/variants/:id/stock')
  async stock(@Param('id') id: string, @Body() dto: StockAdjustDto, @CurrentUser() user: AuthUser) {
    const result = await this.inventory.adjust(id, dto.delta, dto.reason, user.id);
    await this.audit.log({
      actorId: user.id,
      action: 'stock.adjust',
      entity: 'ProductVariant',
      entityId: id,
      metadata: { delta: dto.delta, reason: dto.reason },
    });
    return result;
  }

  @Roles('ADMIN')
  @Post('admin/media/presign')
  presign(@Body() dto: PresignDto) {
    return this.media.presign(dto.fileName, dto.contentType);
  }

  @Roles('ADMIN')
  @Post('admin/media/upload-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadImage(@UploadedFile() file?: { buffer: Buffer; mimetype: string }) {
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED', 'Choose an image to upload.');
    return this.media.uploadProductImage(file.buffer, file.mimetype);
  }

  @Roles('ADMIN')
  @Post('admin/media/presign-private')
  presignPrivate(@Body() dto: PresignDto) {
    return this.media.presignPrivate(dto.fileName, dto.contentType);
  }

  @Roles('ADMIN')
  @Post('admin/products/:id/digital-asset')
  async digitalAsset(
    @Param('id') id: string,
    @Body() dto: { storageKey: string; fileName: string; contentType: string; sizeBytes?: number },
    @CurrentUser() user: AuthUser,
  ) {
    const asset = await this.prisma.digitalAsset.upsert({
      where: { productId: id },
      update: { storageKey: dto.storageKey, fileName: dto.fileName, contentType: dto.contentType, sizeBytes: dto.sizeBytes ?? 0 },
      create: { productId: id, storageKey: dto.storageKey, fileName: dto.fileName, contentType: dto.contentType, sizeBytes: dto.sizeBytes ?? 0 },
    });
    await this.audit.log({ actorId: user.id, action: 'product.digital', entity: 'Product', entityId: id });
    return asset;
  }

  @Roles('ADMIN')
  @Get('admin/products')
  adminProducts() {
    return this.prisma.product.findMany({
      include: { variants: true, images: { orderBy: { sortOrder: 'asc' } }, category: true, occasion: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Roles('ADMIN')
  @Get('admin/products/:id')
  adminProduct(@Param('id') id: string) {
    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: { variants: true, images: { orderBy: { sortOrder: 'asc' } }, category: true, occasion: true },
    });
  }

  @Roles('ADMIN')
  @Patch('admin/variants/:id')
  async updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto, @CurrentUser() user: AuthUser) {
    const variant = await this.prisma.productVariant.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: user.id, action: 'variant.update', entity: 'ProductVariant', entityId: id });
    return variant;
  }

  @Roles('ADMIN')
  @Delete('admin/products/:productId/images/:imageId')
  async deleteImage(
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.prisma.productImage.deleteMany({ where: { id: imageId, productId } });
    await this.audit.log({ actorId: user.id, action: 'product.image.delete', entity: 'Product', entityId: productId });
    return { ok: true };
  }

  @Roles('ADMIN')
  @Get('admin/audit-logs')
  auditLogs() {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
