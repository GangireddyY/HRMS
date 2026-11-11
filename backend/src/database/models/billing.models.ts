import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { BillingCycle, BillTo, InvoiceLine, InvoiceStatus, PaymentMethod, SubscriptionStatus } from '../../contracts';
import { Organization } from './organization.models';

/** An organization's subscription terms on top of its plan. DECIMAL columns come back from pg as strings. */
@Table({ tableName: 'organization_subscriptions', underscored: true })
export class OrganizationSubscription extends Model<InferAttributes<OrganizationSubscription>, InferCreationAttributes<OrganizationSubscription>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(12)) status: CreationOptional<SubscriptionStatus>;
  @Column(DataType.STRING(10)) billingCycle: CreationOptional<BillingCycle>;
  /** Null = the plan's user limit. */
  @Column(DataType.INTEGER) seats: CreationOptional<number | null>;
  /** Null = the plan's monthly price. */
  @Column(DataType.DECIMAL(12, 2)) pricePerMonth: CreationOptional<string | number | null>;
  @Column(DataType.DECIMAL(5, 2)) discountPct: CreationOptional<string | number>;
  @Column(DataType.DECIMAL(5, 2)) taxRatePct: CreationOptional<string | number>;
  @Column(DataType.SMALLINT) paymentTermsDays: CreationOptional<number>;
  @Column(DataType.DATEONLY) trialEndsOn: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) nextPeriodStart: CreationOptional<string | null>;
  @Column(DataType.STRING(200)) billingName: CreationOptional<string | null>;
  @Column(DataType.STRING(254)) billingEmail: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) billingAddress: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) billingTaxId: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) notes: CreationOptional<string | null>;
  @Column(DataType.DATE) cancelledAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Organization, 'organizationId')
  organization?: NonAttribute<Organization>;
}

@Table({ tableName: 'invoices', underscored: true })
export class Invoice extends Model<InferAttributes<Invoice>, InferCreationAttributes<Invoice>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(30)) number: CreationOptional<string | null>;
  @Column(DataType.STRING(8)) status: CreationOptional<InvoiceStatus>;
  @Column(DataType.DATEONLY) periodStart: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) periodEnd: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) issueDate: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) dueDate: CreationOptional<string | null>;
  @Column(DataType.CHAR(3)) currency: string;
  @Column(DataType.JSONB) lines: CreationOptional<InvoiceLine[]>;
  @Column(DataType.DECIMAL(14, 2)) subtotal: CreationOptional<string | number>;
  @Column(DataType.DECIMAL(14, 2)) discount: CreationOptional<string | number>;
  @Column(DataType.DECIMAL(5, 2)) taxRatePct: CreationOptional<string | number>;
  @Column(DataType.DECIMAL(14, 2)) tax: CreationOptional<string | number>;
  @Column(DataType.DECIMAL(14, 2)) total: CreationOptional<string | number>;
  @Column(DataType.DECIMAL(14, 2)) amountPaid: CreationOptional<string | number>;
  @Column(DataType.JSONB) billTo: CreationOptional<BillTo | null>;
  @Column(DataType.STRING(1000)) notes: CreationOptional<string | null>;
  @Column(DataType.DATE) issuedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) paidAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) voidedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) voidReason: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Organization, 'organizationId')
  organization?: NonAttribute<Organization>;

  @HasMany(() => InvoicePayment, 'invoiceId')
  payments?: NonAttribute<InvoicePayment[]>;
}

@Table({ tableName: 'invoice_payments', underscored: true, updatedAt: false })
export class InvoicePayment extends Model<InferAttributes<InvoicePayment>, InferCreationAttributes<InvoicePayment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Invoice) @Column(DataType.UUID) invoiceId: string;
  @Column(DataType.DECIMAL(14, 2)) amount: string | number;
  @Column(DataType.DATEONLY) paidOn: string;
  @Column(DataType.STRING(16)) method: PaymentMethod;
  @Column(DataType.STRING(100)) reference: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @Column(DataType.UUID) recordedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;

  @BelongsTo(() => Invoice, 'invoiceId')
  invoice?: NonAttribute<Invoice>;
}
