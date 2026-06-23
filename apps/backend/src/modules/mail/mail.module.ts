import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Global pra que o MailService possa ser injetado em qualquer módulo sem re-importar. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
