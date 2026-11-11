import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequirePlatformPermissions } from '../../common/auth/decorators';
import { BillingService } from './billing.service';
import { BillingContactDto, CreateInvoiceDto, InvoiceQueryDto, RecordPaymentDto, UpdateInvoiceDto, UpdateSubscriptionDto, VoidInvoiceDto } from './dto/billing.dto';

const pdf = (file: { buffer: Buffer; fileName: string }) => new StreamableFile(file.buffer, { type: 'application/pdf', disposition: `attachment; filename="${file.fileName}"` });

/** Super-admin billing: subscription terms, invoices and payments received. */
@ApiTags('Platform billing')
@ApiBearerAuth()
@Controller({ path: 'platform/billing', version: '1' })
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePlatformPermissions('platform.organizations.view')
  @ApiOperation({ summary: 'Recurring revenue, balances and each organization’s subscription' })
  overview() {
    return this.billing.overview();
  }

  @Get('invoices')
  @RequirePlatformPermissions('platform.organizations.view')
  invoices(@Query() q: InvoiceQueryDto) {
    return this.billing.invoices(q);
  }

  @Get('organizations/:id')
  @RequirePlatformPermissions('platform.organizations.view')
  organization(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.organization(id);
  }

  @Put('organizations/:id/subscription')
  @RequirePlatformPermissions('platform.billing.manage')
  updateSubscription(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.billing.updateSubscription(auth, id, dto);
  }

  @Post('organizations/:id/invoices')
  @RequirePlatformPermissions('platform.billing.manage')
  @ApiOperation({ summary: 'Draft an invoice for the next period (or the one given)' })
  createInvoice(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(auth, id, dto);
  }

  @Patch('invoices/:id')
  @RequirePlatformPermissions('platform.billing.manage')
  updateInvoice(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.billing.updateInvoice(auth, id, dto);
  }

  @Delete('invoices/:id')
  @RequirePlatformPermissions('platform.billing.manage')
  @HttpCode(204)
  async deleteDraft(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.billing.deleteDraft(auth, id);
  }

  @Post('invoices/:id/issue')
  @RequirePlatformPermissions('platform.billing.manage')
  @HttpCode(200)
  issue(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.issue(auth, id);
  }

  @Post('invoices/:id/payments')
  @RequirePlatformPermissions('platform.billing.manage')
  @ApiOperation({ summary: 'Record a payment received (bank transfer, UPI, cheque…)' })
  recordPayment(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto) {
    return this.billing.recordPayment(auth, id, dto);
  }

  @Post('invoices/:id/void')
  @RequirePlatformPermissions('platform.billing.manage')
  @HttpCode(200)
  void(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidInvoiceDto) {
    return this.billing.void(auth, id, dto.reason);
  }

  @Get('invoices/:id/pdf')
  @RequirePlatformPermissions('platform.organizations.view')
  async invoicePdf(@Param('id', ParseUUIDPipe) id: string) {
    return pdf(await this.billing.pdf(id));
  }
}

/** The organization's own subscription, seats and invoices. */
@ApiTags('Organization billing')
@ApiBearerAuth()
@Controller({ path: 'organizations/current/billing', version: '1' })
export class OrganizationBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermissions('billing.view')
  mine(@CurrentAuth() auth: AuthContext) {
    return this.billing.mine(auth);
  }

  @Put('contact')
  @RequirePermissions('billing.view', 'billing.manage')
  updateContact(@CurrentAuth() auth: AuthContext, @Body() dto: BillingContactDto) {
    return this.billing.updateContact(auth, dto);
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions('billing.view')
  async invoicePdf(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return pdf(await this.billing.pdf(id, auth.organizationId!));
  }
}
