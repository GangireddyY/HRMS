import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { CatalogSyncService } from './catalog-sync.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController],
  providers: [AccessService, CatalogSyncService, RolesService],
  exports: [AccessService, CatalogSyncService],
})
export class RbacModule {}
