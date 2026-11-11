import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { LegalEntityRegistration } from '../../contracts';

/** A company the organization employs people through (its country, currency and registrations). */
@Table({ tableName: 'legal_entities', underscored: true })
export class LegalEntity extends Model<InferAttributes<LegalEntity>, InferCreationAttributes<LegalEntity>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(200)) legalName: string;
  @Column(DataType.CHAR(2)) country: string;
  @Column(DataType.CHAR(3)) currency: string;
  @Column(DataType.JSONB) registrations: CreationOptional<LegalEntityRegistration[]>;
  @Column({ type: DataType.STRING(200), field: 'address_line1' }) addressLine1: CreationOptional<string | null>;
  @Column({ type: DataType.STRING(200), field: 'address_line2' }) addressLine2: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) city: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) state: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) postalCode: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isDefault: CreationOptional<boolean>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** Base-currency units for one unit of a currency, from a date. */
@Table({ tableName: 'exchange_rates', underscored: true })
export class ExchangeRate extends Model<InferAttributes<ExchangeRate>, InferCreationAttributes<ExchangeRate>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.CHAR(3)) currency: string;
  @Column(DataType.DECIMAL(18, 8)) rate: string;
  @Column(DataType.DATEONLY) effectiveOn: string;
  @Column(DataType.STRING(120)) source: CreationOptional<string | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}
