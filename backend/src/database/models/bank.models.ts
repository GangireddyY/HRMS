import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { Employee } from './people.models';

export type BankChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** A requested change to an employee's salary bank account, applied only after a second person approves it. */
@Table({ tableName: 'bank_detail_changes', underscored: true })
export class BankDetailChange extends Model<InferAttributes<BankDetailChange>, InferCreationAttributes<BankDetailChange>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.TEXT) accountEncrypted: CreationOptional<string | null>;
  @Column({ type: DataType.STRING(4), field: 'account_last4' }) accountLast4: CreationOptional<string | null>;
  @Column(DataType.STRING(11)) ifsc: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) bankName: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<BankChangeStatus>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}
