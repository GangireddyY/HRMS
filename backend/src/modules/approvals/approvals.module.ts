import { Global, Module } from '@nestjs/common';
import { ApprovalChainConfigService } from './approval-chain-config.service';
import { ApprovalChainsController } from './approval-chains.controller';
import { ApprovalChainsService } from './approval-chains.service';
import { ApprovalInboxController } from './approval-inbox.controller';
import { ApprovalInboxService } from './approval-inbox.service';
import { ApprovalSlaJob } from './approval-sla.job';
import { DelegationsController } from './delegations.controller';
import { DelegationsService } from './delegations.service';

/** Approval cover (delegation) and configurable approval chains, used by the modules that approve requests. */
@Global()
@Module({
  controllers: [DelegationsController, ApprovalChainsController, ApprovalInboxController],
  providers: [DelegationsService, ApprovalChainsService, ApprovalChainConfigService, ApprovalInboxService, ApprovalSlaJob],
  exports: [ApprovalChainsService, ApprovalSlaJob],
})
export class ApprovalsModule {}
