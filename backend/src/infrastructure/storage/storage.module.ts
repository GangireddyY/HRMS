import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { ClamAvScanner, TestSignatureScanner } from './malware-scanner';
import { LocalStorageDriver, S3StorageDriver, StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [AppConfig, AuditService],
      useFactory: (config: AppConfig, audit: AuditService) =>
        new StorageService(
          config.get('STORAGE_DRIVER') === 's3'
            ? new S3StorageDriver(config.get('S3_BUCKET')!, {
                region: config.get('S3_REGION')!,
                endpoint: config.get('S3_ENDPOINT'),
                forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
              })
            : new LocalStorageDriver(config.get('STORAGE_LOCAL_DIR')),
          config.get('UPLOAD_SCAN') === 'clamav'
            ? new ClamAvScanner(config.get('CLAMAV_HOST'), config.get('CLAMAV_PORT'), config.get('CLAMAV_TIMEOUT_MS'))
            : new TestSignatureScanner(),
          audit,
        ),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
