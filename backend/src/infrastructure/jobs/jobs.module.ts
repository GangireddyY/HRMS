import { Global, Module } from '@nestjs/common';
import { ErrorReporter } from '../observability/error-reporter';
import { JobQueueService } from './job-queue.service';

@Global()
@Module({
  providers: [JobQueueService, ErrorReporter],
  exports: [JobQueueService, ErrorReporter],
})
export class JobsModule {}
