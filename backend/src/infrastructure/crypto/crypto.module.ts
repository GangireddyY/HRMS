import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { BreachedPasswordService } from './breached-password.service';
import { EncryptionService } from './encryption.service';
import { resolveDataKeys } from './key-source';
import { PasswordHasher } from './password-hasher.service';

@Global()
@Module({
  providers: [
    PasswordHasher,
    BreachedPasswordService,
    {
      provide: EncryptionService,
      inject: [AppConfig],
      useFactory: async (config: AppConfig) => {
        const { key, previous } = await resolveDataKeys({
          source: config.get('DATA_ENCRYPTION_KEY_SOURCE'),
          key: config.get('DATA_ENCRYPTION_KEY'),
          previous: config.get('DATA_ENCRYPTION_PREVIOUS_KEYS'),
          kmsRegion: config.get('KMS_REGION'),
        });
        return new EncryptionService(key, config.get('DATA_ENCRYPTION_KEY_VERSION'), previous);
      },
    },
  ],
  exports: [PasswordHasher, EncryptionService, BreachedPasswordService],
})
export class CryptoModule {}
