import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { AppConfig } from '../config/app-config.service';
import { createSequelize } from './sequelize';

/**
 * Owns the Sequelize connection. Models are used statically (`User.findOne(...)`); tenant-owned models
 * are automatically scoped to the request's organization (see tenant-scope.ts).
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly sequelize: Sequelize;

  constructor(config: AppConfig) {
    this.sequelize = createSequelize(
      {
        host: config.get('DB_HOST'),
        port: config.get('DB_PORT'),
        name: config.get('DB_NAME'),
        user: config.get('DB_USER'),
        password: config.get('DB_PASSWORD'),
        ssl: config.get('DB_SSL'),
      },
      { withModels: true },
    );
  }

  async onModuleInit(): Promise<void> {
    await this.sequelize.authenticate();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.sequelize.close();
  }

  /** Managed transaction: commits when `fn` resolves, rolls back when it throws. */
  transaction<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(fn);
  }

  /** Parameterised raw SELECT (named replacements, safely escaped). */
  select<T extends object>(sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> {
    return this.sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
  }
}
