import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RbacModule } from '../rbac/rbac.module';
import { UsersModule } from '../users/users.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [OrganizationsModule, UsersModule, RbacModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
