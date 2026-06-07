import { Module } from '@nestjs/common';
import { ApprovalPolicyController } from './approval-policy.controller';
import { ApprovalPolicyRepository } from './approval-policy.repository';
import { ApprovalPolicyService } from './approval-policy.service';

@Module({
  controllers: [ApprovalPolicyController],
  providers: [ApprovalPolicyRepository, ApprovalPolicyService],
  exports: [ApprovalPolicyService],
})
export class ApprovalPolicyModule {}
