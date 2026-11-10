import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { AssetCategory, AssetCondition, AssetRequestStatus, AssetStatus, HelpdeskCategory, HelpdeskPriority, HelpdeskStatus, TravelMode, TravelStatus } from '../../contracts';
import { Employee, Location } from './people.models';

/** Decimal columns come back from PostgreSQL as strings. */

@Table({ tableName: 'assets', underscored: true })
export class Asset extends Model<InferAttributes<Asset>, InferCreationAttributes<Asset>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) tag: string;
  @Column(DataType.STRING(150)) name: string;
  @Column(DataType.STRING(20)) category: AssetCategory;
  @Column(DataType.STRING(100)) serialNumber: CreationOptional<string | null>;
  @Column(DataType.STRING(150)) model: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) purchaseDate: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(12, 2)) purchaseCost: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) warrantyUntil: CreationOptional<string | null>;
  @Column(DataType.STRING(12)) status: CreationOptional<AssetStatus>;
  @Column(DataType.STRING(10)) condition: CreationOptional<AssetCondition>;
  @ForeignKey(() => Location) @Column(DataType.UUID) locationId: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) notes: CreationOptional<string | null>;
  @ForeignKey(() => Employee) @Column(DataType.UUID) assignedEmployeeId: CreationOptional<string | null>;
  @Column(DataType.DATE) assignedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'assignedEmployeeId') assignedEmployee?: NonAttribute<Employee | null>;
  @BelongsTo(() => Location, 'locationId') location?: NonAttribute<Location | null>;
  @HasMany(() => AssetAssignment, 'assetId') assignments?: NonAttribute<AssetAssignment[]>;
}

@Table({ tableName: 'asset_assignments', underscored: true, updatedAt: false })
export class AssetAssignment extends Model<InferAttributes<AssetAssignment>, InferCreationAttributes<AssetAssignment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Asset) @Column(DataType.UUID) assetId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATE) assignedAt: Date;
  @Column(DataType.UUID) assignedById: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) conditionOut: AssetCondition;
  @Column(DataType.DATE) acknowledgedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) returnedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) returnedById: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) conditionIn: CreationOptional<AssetCondition | null>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;

  @BelongsTo(() => Asset, 'assetId') asset?: NonAttribute<Asset>;
  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

@Table({ tableName: 'asset_requests', underscored: true })
export class AssetRequest extends Model<InferAttributes<AssetRequest>, InferCreationAttributes<AssetRequest>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(20)) category: AssetCategory;
  @Column(DataType.STRING(500)) reason: string;
  @Column(DataType.STRING(10)) status: CreationOptional<AssetRequestStatus>;
  @ForeignKey(() => Asset) @Column(DataType.UUID) assetId: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => Asset, 'assetId') asset?: NonAttribute<Asset | null>;
}

@Table({ tableName: 'helpdesk_tickets', underscored: true })
export class HelpdeskTicket extends Model<InferAttributes<HelpdeskTicket>, InferCreationAttributes<HelpdeskTicket>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) reference: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) category: HelpdeskCategory;
  @Column(DataType.STRING(200)) subject: string;
  @Column(DataType.STRING(10)) priority: CreationOptional<HelpdeskPriority>;
  @Column(DataType.STRING(12)) status: CreationOptional<HelpdeskStatus>;
  @Column(DataType.UUID) assigneeId: CreationOptional<string | null>;
  @Column(DataType.DATE) dueAt: Date;
  @Column(DataType.DATE) firstResponseAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) resolvedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @Column(DataType.SMALLINT) rating: CreationOptional<number | null>;
  @Column(DataType.STRING(500)) ratingComment: CreationOptional<string | null>;
  @Column(DataType.DATE) lastActivityAt: CreationOptional<Date>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @HasMany(() => HelpdeskMessage, 'ticketId') messages?: NonAttribute<HelpdeskMessage[]>;
}

@Table({ tableName: 'helpdesk_messages', underscored: true, updatedAt: false })
export class HelpdeskMessage extends Model<InferAttributes<HelpdeskMessage>, InferCreationAttributes<HelpdeskMessage>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => HelpdeskTicket) @Column(DataType.UUID) ticketId: string;
  @Column(DataType.UUID) authorId: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) fromAgent: boolean;
  @Column(DataType.BOOLEAN) internal: CreationOptional<boolean>;
  @Column(DataType.STRING(5000)) body: string;
  @CreatedAt createdAt: CreationOptional<Date>;
}

@Table({ tableName: 'travel_requests', underscored: true })
export class TravelRequest extends Model<InferAttributes<TravelRequest>, InferCreationAttributes<TravelRequest>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) reference: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) purpose: string;
  @Column(DataType.STRING(100)) fromCity: string;
  @Column(DataType.STRING(100)) toCity: string;
  @Column(DataType.DATEONLY) departureDate: string;
  @Column(DataType.DATEONLY) returnDate: string;
  @Column(DataType.STRING(10)) mode: TravelMode;
  @Column(DataType.BOOLEAN) needsAccommodation: CreationOptional<boolean>;
  @Column(DataType.DECIMAL(12, 2)) estimatedCost: string;
  @Column(DataType.DECIMAL(12, 2)) advanceAmount: CreationOptional<string>;
  @Column(DataType.STRING(10)) status: CreationOptional<TravelStatus>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.STRING(2000)) bookingNotes: CreationOptional<string | null>;
  @Column(DataType.DATE) advancePaidAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(100)) advanceReference: CreationOptional<string | null>;
  @Column(DataType.DATE) completedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}
