import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { AttendanceRecordStatus, AttendanceSource, OvertimeStatus, PunchDirection, RegularizationStatus, ShiftSwapStatus, TimesheetEntry, TimesheetStatus, WorkMode } from '../../contracts';
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
  /** Overtime: worked minutes beyond `overtimeAfterMinutes` (all minutes on a day off), when at least `overtimeMinMinutes`. */
  @Column(DataType.BOOLEAN) overtimeEnabled: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) overtimeAfterMinutes: CreationOptional<number>;
  @Column(DataType.SMALLINT) overtimeMinMinutes: CreationOptional<number>;
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
  /** Locations that observe it; empty = every location. */
  @Column(DataType.ARRAY(DataType.UUID)) locationIds: CreationOptional<string[]>;
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
  @Column(DataType.INTEGER) overtimeMinutes: CreationOptional<number>;
  @Column(DataType.STRING(20)) status: CreationOptional<AttendanceRecordStatus | null>;
  @Column(DataType.STRING(20)) source: CreationOptional<AttendanceSource>;
  @Column(DataType.STRING(6)) workMode: CreationOptional<WorkMode>;
  @Column(DataType.UUID) deviceId: CreationOptional<string | null>;
  @Column(DataType.STRING(45)) checkInIp: CreationOptional<string | null>;
  @Column(DataType.STRING(45)) checkOutIp: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(9, 6)) checkInLatitude: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(9, 6)) checkInLongitude: CreationOptional<string | null>;
  @Column(DataType.STRING(300)) checkInPhotoKey: CreationOptional<string | null>;
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

/** Overtime worked on a day, approved before payroll pays it. */
@Table({ tableName: 'attendance_overtime', underscored: true })
export class AttendanceOvertime extends Model<InferAttributes<AttendanceOvertime>, InferCreationAttributes<AttendanceOvertime>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => AttendanceRecord) @Column(DataType.UUID) recordId: string;
  @Column(DataType.DATEONLY) workDate: string;
  @Column(DataType.INTEGER) minutes: number;
  @Column(DataType.INTEGER) approvedMinutes: CreationOptional<number | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<OvertimeStatus>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.UUID) payrollRunId: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => AttendanceRecord, 'recordId') record?: NonAttribute<AttendanceRecord>;
}

@Table({ tableName: 'work_from_home_requests', underscored: true })
export class WorkFromHomeRequest extends Model<InferAttributes<WorkFromHomeRequest>, InferCreationAttributes<WorkFromHomeRequest>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATEONLY) startDate: string;
  @Column(DataType.DATEONLY) endDate: string;
  @Column(DataType.STRING(500)) reason: string;
  @Column(DataType.STRING(10)) status: CreationOptional<RegularizationStatus>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

/** One employee's week (Monday to Sunday). Entries are kept as JSON: day, project, activity, From–To, minutes, note. */
@Table({ tableName: 'timesheets', underscored: true })
export class Timesheet extends Model<InferAttributes<Timesheet>, InferCreationAttributes<Timesheet>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATEONLY) weekStart: string;
  @Column(DataType.STRING(10)) status: CreationOptional<TimesheetStatus>;
  @Column(DataType.JSONB) entries: CreationOptional<TimesheetEntry[]>;
  @Column(DataType.INTEGER) totalMinutes: CreationOptional<number>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @Column(DataType.DATE) submittedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) submittedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

export interface RotationStep {
  shiftId: string | null;
  days: number;
}

@Table({ tableName: 'shift_rotations', underscored: true })
export class ShiftRotation extends Model<InferAttributes<ShiftRotation>, InferCreationAttributes<ShiftRotation>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(80)) name: string;
  @Column(DataType.JSONB) pattern: RotationStep[];
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

/** Roster entry: the shift (null = day off) an employee works from `startDate` to `endDate`. */
@Table({ tableName: 'shift_assignments', underscored: true })
export class ShiftAssignment extends Model<InferAttributes<ShiftAssignment>, InferCreationAttributes<ShiftAssignment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => Shift) @Column(DataType.UUID) shiftId: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) startDate: string;
  @Column(DataType.DATEONLY) endDate: string;
  @Column(DataType.UUID) rotationId: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Shift, 'shiftId') shift?: NonAttribute<Shift | null>;
}

@Table({ tableName: 'attendance_devices', underscored: true })
export class AttendanceDevice extends Model<InferAttributes<AttendanceDevice>, InferCreationAttributes<AttendanceDevice>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(80)) name: string;
  @Column(DataType.UUID) locationId: CreationOptional<string | null>;
  @Column(DataType.STRING(60)) serialNumber: CreationOptional<string | null>;
  @Column(DataType.STRING(16)) keyPrefix: string;
  @Column(DataType.CHAR(64)) keyHash: string;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @Column(DataType.DATE) lastSeenAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

@Table({ tableName: 'attendance_punches', underscored: true, updatedAt: false })
export class AttendancePunch extends Model<InferAttributes<AttendancePunch>, InferCreationAttributes<AttendancePunch>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => AttendanceDevice) @Column(DataType.UUID) deviceId: string;
  @Column(DataType.DATE) punchedAt: Date;
  @Column(DataType.STRING(4)) direction: CreationOptional<PunchDirection>;
  @Column(DataType.DATEONLY) workDate: string;
  @CreatedAt createdAt: CreationOptional<Date>;
}

/** Two colleagues trade their shifts (or a shift and a day off) on one day: the colleague agrees, then a manager approves. */
@Table({ tableName: 'shift_swaps', underscored: true })
export class ShiftSwap extends Model<InferAttributes<ShiftSwap>, InferCreationAttributes<ShiftSwap>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) requesterId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) colleagueId: string;
  @Column(DataType.DATEONLY) workDate: string;
  @Column(DataType.UUID) requesterShiftId: CreationOptional<string | null>;
  @Column(DataType.UUID) colleagueShiftId: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) reason: string;
  @Column(DataType.STRING(10)) status: CreationOptional<ShiftSwapStatus>;
  @Column(DataType.DATE) colleagueRespondedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) colleagueNote: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'requesterId') requester?: NonAttribute<Employee>;
  @BelongsTo(() => Employee, 'colleagueId') colleague?: NonAttribute<Employee>;
}
