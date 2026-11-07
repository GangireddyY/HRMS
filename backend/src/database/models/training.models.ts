import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { CourseCategory, CourseDelivery, CourseStatus, EnrollmentSource, EnrollmentStatus, SessionStatus, SkillCategory, SkillVerifiedSource } from '../../contracts';
import { Designation, Employee } from './people.models';

/** Decimal columns come back from PostgreSQL as strings. */
@Table({ tableName: 'training_courses', underscored: true })
export class TrainingCourse extends Model<InferAttributes<TrainingCourse>, InferCreationAttributes<TrainingCourse>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) code: string;
  @Column(DataType.STRING(150)) title: string;
  @Column(DataType.TEXT) description: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) category: CourseCategory;
  @Column(DataType.STRING(12)) delivery: CourseDelivery;
  @Column(DataType.DECIMAL(5, 1)) durationHours: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) provider: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) contentUrl: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<CourseStatus>;
  @Column(DataType.BOOLEAN) selfEnrollment: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) mandatory: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) hasAssessment: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) passMark: CreationOptional<number>;
  @Column(DataType.SMALLINT) maxAttempts: CreationOptional<number>;
  @Column(DataType.SMALLINT) validityMonths: CreationOptional<number | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @HasMany(() => TrainingQuestion, 'courseId') questions?: NonAttribute<TrainingQuestion[]>;
  @HasMany(() => TrainingSession, 'courseId') sessions?: NonAttribute<TrainingSession[]>;
}

@Table({ tableName: 'training_questions', underscored: true, timestamps: false })
export class TrainingQuestion extends Model<InferAttributes<TrainingQuestion>, InferCreationAttributes<TrainingQuestion>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => TrainingCourse) @Column(DataType.UUID) courseId: string;
  @Column(DataType.STRING(1000)) prompt: string;
  @Column(DataType.JSONB) options: string[];
  @Column(DataType.SMALLINT) correctIndex: number;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;
}

@Table({ tableName: 'training_sessions', underscored: true })
export class TrainingSession extends Model<InferAttributes<TrainingSession>, InferCreationAttributes<TrainingSession>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => TrainingCourse) @Column(DataType.UUID) courseId: string;
  @Column(DataType.DATE) startsAt: Date;
  @Column(DataType.DATE) endsAt: Date;
  @Column(DataType.STRING(300)) location: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) trainer: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) capacity: CreationOptional<number | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<SessionStatus>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => TrainingCourse, 'courseId') course?: NonAttribute<TrainingCourse>;
}

@Table({ tableName: 'training_enrollments', underscored: true })
export class TrainingEnrollment extends Model<InferAttributes<TrainingEnrollment>, InferCreationAttributes<TrainingEnrollment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => TrainingCourse) @Column(DataType.UUID) courseId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => TrainingSession) @Column(DataType.UUID) sessionId: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) source: EnrollmentSource;
  @Column(DataType.UUID) assignedById: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) dueDate: CreationOptional<string | null>;
  @Column(DataType.STRING(12)) status: CreationOptional<EnrollmentStatus>;
  @Column(DataType.DATE) startedAt: CreationOptional<Date | null>;
  @Column(DataType.BOOLEAN) attended: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) markedDone: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) attempts: CreationOptional<number>;
  @Column(DataType.SMALLINT) bestScore: CreationOptional<number | null>;
  @Column(DataType.BOOLEAN) passed: CreationOptional<boolean>;
  @Column(DataType.DATE) completedAt: CreationOptional<Date | null>;
  @Column(DataType.DATEONLY) completedOn: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) certificateNumber: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) expiresOn: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) feedbackRating: CreationOptional<number | null>;
  @Column(DataType.STRING(2000)) feedbackComment: CreationOptional<string | null>;
  @Column(DataType.DATE) cancelledAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(300)) cancelReason: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => TrainingCourse, 'courseId') course?: NonAttribute<TrainingCourse>;
  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => TrainingSession, 'sessionId') session?: NonAttribute<TrainingSession | null>;
}

@Table({ tableName: 'training_attempts', underscored: true, updatedAt: false })
export class TrainingAttempt extends Model<InferAttributes<TrainingAttempt>, InferCreationAttributes<TrainingAttempt>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => TrainingEnrollment) @Column(DataType.UUID) enrollmentId: string;
  @Column(DataType.JSONB) answers: Record<string, number>;
  @Column(DataType.SMALLINT) correct: number;
  @Column(DataType.SMALLINT) total: number;
  @Column(DataType.SMALLINT) score: number;
  @Column(DataType.BOOLEAN) passed: boolean;
  @CreatedAt createdAt: CreationOptional<Date>;
}

@Table({ tableName: 'skills', underscored: true })
export class Skill extends Model<InferAttributes<Skill>, InferCreationAttributes<Skill>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(80)) name: string;
  @Column(DataType.STRING(10)) category: SkillCategory;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

/** An employee's proficiency in a skill (1–5): their own rating and the verified one (manager / HR or a course). */
@Table({ tableName: 'employee_skills', underscored: true })
export class EmployeeSkill extends Model<InferAttributes<EmployeeSkill>, InferCreationAttributes<EmployeeSkill>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => Skill) @Column(DataType.UUID) skillId: string;
  @Column(DataType.SMALLINT) level: CreationOptional<number | null>;
  @Column(DataType.SMALLINT) verifiedLevel: CreationOptional<number | null>;
  @Column(DataType.UUID) verifiedById: CreationOptional<string | null>;
  @Column(DataType.DATE) verifiedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(8)) verifiedSource: CreationOptional<SkillVerifiedSource | null>;
  @Column(DataType.STRING(500)) notes: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Skill, 'skillId') skill?: NonAttribute<Skill>;
}

/** A skill a designation needs, at a minimum level. */
@Table({ tableName: 'designation_skills', underscored: true, timestamps: false })
export class DesignationSkill extends Model<InferAttributes<DesignationSkill>, InferCreationAttributes<DesignationSkill>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Designation) @Column(DataType.UUID) designationId: string;
  @ForeignKey(() => Skill) @Column(DataType.UUID) skillId: string;
  @Column(DataType.SMALLINT) requiredLevel: number;

  @BelongsTo(() => Skill, 'skillId') skill?: NonAttribute<Skill>;
}

/** A skill a course teaches, up to a level. */
@Table({ tableName: 'training_course_skills', underscored: true, timestamps: false })
export class TrainingCourseSkill extends Model<InferAttributes<TrainingCourseSkill>, InferCreationAttributes<TrainingCourseSkill>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => TrainingCourse) @Column(DataType.UUID) courseId: string;
  @ForeignKey(() => Skill) @Column(DataType.UUID) skillId: string;
  @Column(DataType.SMALLINT) level: number;

  @BelongsTo(() => Skill, 'skillId') skill?: NonAttribute<Skill>;
  @BelongsTo(() => TrainingCourse, 'courseId') course?: NonAttribute<TrainingCourse>;
}
