import { Module } from '@nestjs/common';
import { InvitationService } from './invitation.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, InvitationService],
  exports: [InvitationService],
})
export class UsersModule {}
