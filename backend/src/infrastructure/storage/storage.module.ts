import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { LocalStorageDriver, S3StorageDriver, StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new StorageService(
          config.get('STORAGE_DRIVER') === 's3'
            ? new S3StorageDriver(config.get('S3_BUCKET')!, {
                region: config.get('S3_REGION')!,
                endpoint: config.get('S3_ENDPOINT'),
                forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
              })
            : new LocalStorageDriver(config.get('STORAGE_LOCAL_DIR')),
        ),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
