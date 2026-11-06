import { Module } from '@nestjs/common';
import { OrganizationLogoService } from './organization-logo.service';
import { OrganizationProvisioningService } from './organization-provisioning.service';
import { OrganizationLogoController, OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController, OrganizationLogoController],
  providers: [OrganizationsService, OrganizationProvisioningService, OrganizationLogoService],
  exports: [OrganizationProvisioningService, OrganizationsService],
})
export class OrganizationsModule {}
