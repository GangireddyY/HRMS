import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type {
  BloodGroup,
  DocumentCategory,
  DocumentContentType,
  DocumentStatus,
  EducationLevel,
  EmployeeStatus,
  EmploymentType,
  FamilyRelationship,
  Gender,
  LifecycleEventType,
  MaritalStatus,
} from '../../contracts';
// Circular with attendance.models; safe because decorators resolve `() => Shift` lazily at registration.
import { Shift } from './attendance.models';
import { OrganizationMembership } from './organization.models';

@Table({ tableName: 'departments', underscored: true })
export class Department extends Model<InferAttributes<Department>, InferCreationAttributes<Department>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(30)) code: CreationOptional<string | null>;
  @ForeignKey(() => Department) @Column(DataType.UUID) parentId: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Department, 'parentId')
  parent?: NonAttribute<Department | null>;
}

@Table({ tableName: 'designations', underscored: true })
export class Designation extends Model<InferAttributes<Designation>, InferCreationAttributes<Designation>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  /** Seniority band (1 = most junior); optional. */
  @Column(DataType.SMALLINT) level: CreationOptional<number | null>;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'locations', underscored: true })
export class Location extends Model<InferAttributes<Location>, InferCreationAttributes<Location>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(30)) code: CreationOptional<string | null>;
  @Column({ type: DataType.STRING(200), field: 'address_line1' }) addressLine1: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) city: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) state: CreationOptional<string | null>;
  @Column(DataType.CHAR(2)) country: CreationOptional<string | null>;
  @Column(DataType.STRING(64)) timezone: CreationOptional<string | null>;
  /** Office geofence for web punches (radius in metres). */
  @Column(DataType.DECIMAL(9, 6)) latitude: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(9, 6)) longitude: CreationOptional<string | null>;
  @Column(DataType.INTEGER) geofenceRadiusM: CreationOptional<number | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** Pay/seniority grade (e.g. L1–L8); independent of designation. */
@Table({ tableName: 'grades', underscored: true })
export class Grade extends Model<InferAttributes<Grade>, InferCreationAttributes<Grade>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(30)) code: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) level: CreationOptional<number | null>;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** Accounting unit employee costs are charged to (used by payroll and reports). */
@Table({ tableName: 'cost_centers', underscored: true })
export class CostCenter extends Model<InferAttributes<CostCenter>, InferCreationAttributes<CostCenter>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(30)) code: string;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/**
 * Employee master record. Optionally linked to a user account (membership) so the person can sign in;
 * `managerId` drives TEAM scope and `departmentId` drives DEPARTMENT scope.
 * Sensitive identifiers are stored encrypted (EncryptionService) and only returned with employee.sensitive.view.
 */
@Table({ tableName: 'employees', underscored: true })
export class Employee extends Model<InferAttributes<Employee>, InferCreationAttributes<Employee>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => OrganizationMembership) @Column(DataType.UUID) membershipId: CreationOptional<string | null>;
  @Column(DataType.STRING(30)) employeeCode: string;
  @Column(DataType.STRING(100)) firstName: string;
  @Column(DataType.STRING(100)) lastName: string;
  @Column(DataType.STRING(254)) workEmail: CreationOptional<string | null>;
  @Column(DataType.STRING(254)) personalEmail: CreationOptional<string | null>;
  @Column(DataType.STRING(30)) phone: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) dateOfBirth: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) gender: CreationOptional<Gender | null>;
  @Column(DataType.DATEONLY) dateOfJoining: string;
  @Column(DataType.STRING(20)) employmentType: CreationOptional<EmploymentType>;
  @Column(DataType.STRING(20)) status: CreationOptional<EmployeeStatus>;
  @ForeignKey(() => Department) @Column(DataType.UUID) departmentId: CreationOptional<string | null>;
  @ForeignKey(() => Designation) @Column(DataType.UUID) designationId: CreationOptional<string | null>;
  @ForeignKey(() => Location) @Column(DataType.UUID) locationId: CreationOptional<string | null>;
  @ForeignKey(() => Employee) @Column(DataType.UUID) managerId: CreationOptional<string | null>;
  /** Assigned shift; null = the organization's default shift. */
  @ForeignKey(() => Shift) @Column(DataType.UUID) shiftId: CreationOptional<string | null>;
  /** User number on biometric devices (punches fall back to matching the employee code). */
  @Column(DataType.STRING(30)) biometricCode: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) probationEndDate: CreationOptional<string | null>;
  /** When probation was confirmed; null = not confirmed yet. */
  @Column(DataType.DATEONLY) confirmedOn: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) exitDate: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) address: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) emergencyContactName: CreationOptional<string | null>;
  @Column(DataType.STRING(30)) emergencyContactPhone: CreationOptional<string | null>;
  @Column(DataType.TEXT) panEncrypted: CreationOptional<string | null>;
  @Column(DataType.TEXT) uanEncrypted: CreationOptional<string | null>;
  @Column(DataType.TEXT) bankAccountEncrypted: CreationOptional<string | null>;
  @Column({ type: DataType.STRING(4), field: 'bank_account_last4' }) bankAccountLast4: CreationOptional<string | null>;
  @Column(DataType.STRING(11)) bankIfsc: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) bankName: CreationOptional<string | null>;
  @ForeignKey(() => Grade) @Column(DataType.UUID) gradeId: CreationOptional<string | null>;
  @ForeignKey(() => CostCenter) @Column(DataType.UUID) costCenterId: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) maritalStatus: CreationOptional<MaritalStatus | null>;
  @Column(DataType.STRING(3)) bloodGroup: CreationOptional<BloodGroup | null>;
  /** ISO 3166-1 alpha-2. */
  @Column(DataType.CHAR(2)) nationality: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) permanentAddress: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) noticePeriodDays: CreationOptional<number | null>;
  @Column(DataType.TEXT) aadhaarEncrypted: CreationOptional<string | null>;
  @Column({ type: DataType.STRING(4), field: 'aadhaar_last4' }) aadhaarLast4: CreationOptional<string | null>;
  @Column(DataType.TEXT) passportEncrypted: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) passportExpiry: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => OrganizationMembership, 'membershipId') membership?: NonAttribute<OrganizationMembership | null>;
  @BelongsTo(() => Grade, 'gradeId') grade?: NonAttribute<Grade | null>;
  @BelongsTo(() => CostCenter, 'costCenterId') costCenter?: NonAttribute<CostCenter | null>;
  @BelongsTo(() => Department, 'departmentId') department?: NonAttribute<Department | null>;
  @BelongsTo(() => Designation, 'designationId') designation?: NonAttribute<Designation | null>;
  @BelongsTo(() => Location, 'locationId') location?: NonAttribute<Location | null>;
  @BelongsTo(() => Employee, 'managerId') manager?: NonAttribute<Employee | null>;
  @BelongsTo(() => Shift, 'shiftId') shift?: NonAttribute<Shift | null>;
  @HasMany(() => Employee, 'managerId') reports?: NonAttribute<Employee[]>;
}

@Table({ tableName: 'employee_lifecycle_events', underscored: true, updatedAt: false })
export class EmployeeLifecycleEvent extends Model<InferAttributes<EmployeeLifecycleEvent>, InferCreationAttributes<EmployeeLifecycleEvent>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(30)) type: LifecycleEventType;
  @Column(DataType.DATEONLY) effectiveDate: string;
  /** Field → { from, to } (ids are resolved to names for display). */
  @Column(DataType.JSONB) changes: CreationOptional<Record<string, { from: unknown; to: unknown }>>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

@Table({ tableName: 'employee_family_members', underscored: true })
export class EmployeeFamilyMember extends Model<InferAttributes<EmployeeFamilyMember>, InferCreationAttributes<EmployeeFamilyMember>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(20)) relationship: FamilyRelationship;
  @Column(DataType.DATEONLY) dateOfBirth: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) gender: CreationOptional<Gender | null>;
  @Column(DataType.STRING(30)) phone: CreationOptional<string | null>;
  /** Covered by dependent benefits (insurance, etc.). */
  @Column(DataType.BOOLEAN) isDependent: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'employee_education', underscored: true })
export class EmployeeEducation extends Model<InferAttributes<EmployeeEducation>, InferCreationAttributes<EmployeeEducation>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(20)) level: EducationLevel;
  @Column(DataType.STRING(120)) qualification: string;
  @Column(DataType.STRING(120)) specialization: CreationOptional<string | null>;
  @Column(DataType.STRING(200)) institution: string;
  @Column(DataType.SMALLINT) startYear: CreationOptional<number | null>;
  @Column(DataType.SMALLINT) endYear: CreationOptional<number | null>;
  /** Grade, percentage or CGPA as written on the certificate. */
  @Column(DataType.STRING(30)) score: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** Employment before joining this organization. */
@Table({ tableName: 'employee_experience', underscored: true })
export class EmployeeExperience extends Model<InferAttributes<EmployeeExperience>, InferCreationAttributes<EmployeeExperience>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(200)) company: string;
  @Column(DataType.STRING(120)) designation: string;
  @Column(DataType.DATEONLY) startDate: string;
  @Column(DataType.DATEONLY) endDate: string;
  @Column(DataType.STRING(120)) location: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** Metadata for a file kept in object storage (StorageService); the bytes never live in the database. */
@Table({ tableName: 'employee_documents', underscored: true })
export class EmployeeDocument extends Model<InferAttributes<EmployeeDocument>, InferCreationAttributes<EmployeeDocument>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(30)) category: DocumentCategory;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(255)) fileName: string;
  @Column(DataType.STRING(100)) contentType: DocumentContentType;
  @Column(DataType.INTEGER) byteSize: number;
  @Column(DataType.CHAR(64)) checksum: string;
  @Column(DataType.STRING(500)) storageKey: string;
  @Column(DataType.DATEONLY) expiryDate: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) status: CreationOptional<DocumentStatus>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}
