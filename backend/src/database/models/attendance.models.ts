import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { AttendanceRecordStatus, AttendanceSource, RegularizationStatus } from '../../contracts';
import { Employee } from './people.models';

@Table({ tableName: 'shifts', underscored: true })
export class Shift extends Model<InferAttributes<Shift>, InferCreationAttributes<Shift>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(80)) name: string;
  /** Local wall-clock time, `HH:MM:SS`; a shift whose end is before its start ends the next day. */
  @Column(DataType.TIME) startTime: string;
  @Column(DataType.TIME) endTime: string;
  @Column(DataType.SMALLINT) breakMinutes: CreationOptional<number>;
  /** Minutes after the start before a punch-in counts as late. */
  @Column(DataType.SMALLINT) graceMinutes: CreationOptional<number>;
  /** Minimum worked minutes for a half day / a full (present) day. */
  @Column(DataType.SMALLINT) halfDayMinutes: CreationOptional<number>;
  @Column(DataType.SMALLINT) fullDayMinutes: CreationOptional<number>;
  /** Weekly days off, 0 = Sunday … 6 = Saturday. */
  @Column(DataType.ARRAY(DataType.SMALLINT)) weeklyOffs: CreationOptional<number[]>;
  @Column(DataType.BOOLEAN) isDefault: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'holidays', underscored: true })
export class Holiday extends Model<InferAttributes<Holiday>, InferCreationAttributes<Holiday>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.DATEONLY) date: string;
  @Column(DataType.STRING(120)) name: string;
  /** Optional (restricted) holidays are shown but remain working days. */
  @Column(DataType.BOOLEAN) isOptional: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** One record per employee per work date (first punch-in, last punch-out). */
@Table({ tableName: 'attendance_records', underscored: true })
export class AttendanceRecord extends Model<InferAttributes<AttendanceRecord>, InferCreationAttributes<AttendanceRecord>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATEONLY) workDate: string;
  @ForeignKey(() => Shift) @Column(DataType.UUID) shiftId: CreationOptional<string | null>;
  @Column(DataType.DATE) checkInAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) checkOutAt: CreationOptional<Date | null>;
  @Column(DataType.INTEGER) workedMinutes: CreationOptional<number | null>;
  @Column(DataType.INTEGER) lateMinutes: CreationOptional<number>;
  @Column(DataType.STRING(20)) status: CreationOptional<AttendanceRecordStatus | null>;
  @Column(DataType.STRING(20)) source: CreationOptional<AttendanceSource>;
  @Column(DataType.STRING(45)) checkInIp: CreationOptional<string | null>;
  @Column(DataType.STRING(45)) checkOutIp: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(9, 6)) checkInLatitude: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(9, 6)) checkInLongitude: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

@Table({ tableName: 'attendance_regularizations', underscored: true })
export class AttendanceRegularization extends Model<InferAttributes<AttendanceRegularization>, InferCreationAttributes<AttendanceRegularization>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATEONLY) workDate: string;
  @Column(DataType.DATE) checkInAt: Date;
  @Column(DataType.DATE) checkOutAt: Date;
  @Column(DataType.STRING(500)) reason: string;
  @Column(DataType.STRING(20)) status: CreationOptional<RegularizationStatus>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

/** Presence of a row means the month's attendance is closed. */
@Table({ tableName: 'attendance_periods', underscored: true })
export class AttendancePeriod extends Model<InferAttributes<AttendancePeriod>, InferCreationAttributes<AttendancePeriod>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.SMALLINT) year: number;
  @Column(DataType.SMALLINT) month: number;
  @Column(DataType.DATE) closedAt: CreationOptional<Date>;
  @Column(DataType.UUID) closedById: CreationOptional<string | null>;
  /** Counts at closing time (present, half days, absent, missed punches, late). */
  @Column(DataType.JSONB) summary: CreationOptional<Record<string, number>>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}
