import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { TaxRuleSet } from '../../contracts';

/** PF / EPS / ESI rates and limits in force from a date (national, the same for every organization). */
@Table({ tableName: 'statutory_contribution_rates', underscored: true })
export class StatutoryContributionRate extends Model<InferAttributes<StatutoryContributionRate>, InferCreationAttributes<StatutoryContributionRate>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @Column(DataType.DATEONLY) effectiveFrom: string;
  @Column(DataType.DECIMAL(6, 4)) pfRate: string;
  @Column(DataType.DECIMAL(6, 4)) epsRate: string;
  @Column(DataType.INTEGER) pfWageCeiling: number;
  @Column(DataType.DECIMAL(6, 4)) esiEmployeeRate: string;
  @Column(DataType.DECIMAL(6, 4)) esiEmployerRate: string;
  @Column(DataType.INTEGER) esiWageLimit: number;
  /** The notification or circular that made the change. */
  @Column(DataType.STRING(300)) source: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** A financial year's income-tax rules entered after the release (later Finance Acts), replacing the built-in ones. */
@Table({ tableName: 'statutory_tax_rules', underscored: true })
export class StatutoryTaxRules extends Model<InferAttributes<StatutoryTaxRules>, InferCreationAttributes<StatutoryTaxRules>> {
  /** Starting year: 2027 = FY 2027-28. */
  @PrimaryKey @Column(DataType.SMALLINT) financialYear: number;
  @Column(DataType.JSONB) rules: TaxRuleSet;
  @Column(DataType.STRING(300)) source: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}
