import { Module } from '@nestjs/common';
import { PromptTemplateService } from './prompt-template.service';

@Module({
  providers: [PromptTemplateService],
  exports: [PromptTemplateService],
})
export class PromptTemplateModule {}
