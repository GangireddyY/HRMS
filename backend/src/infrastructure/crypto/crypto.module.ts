import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { EncryptionService, parseKeyRing } from './encryption.service';
import { PasswordHasher } from './password-hasher.service';

@Global()
@Module({
  providers: [
    PasswordHasher,
    {
      provide: EncryptionService,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new EncryptionService(config.get('DATA_ENCRYPTION_KEY'), config.get('DATA_ENCRYPTION_KEY_VERSION'), parseKeyRing(config.get('DATA_ENCRYPTION_PREVIOUS_KEYS'))),
    },
  ],
  exports: [PasswordHasher, EncryptionService],
})
export class CryptoModule {}
