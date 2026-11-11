import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsString, Length, ValidateNested } from 'class-validator';
import { ASSISTANT_MAX_MESSAGE_LENGTH, ASSISTANT_MAX_MESSAGES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { CurrentAuth, RequirePermissions, RequireTenant } from '../../common/auth/decorators';
import { AssistantService } from './assistant.service';

class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] }) @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @ApiProperty() @IsString() @Length(1, ASSISTANT_MAX_MESSAGE_LENGTH) content!: string;
}

class ChatDto {
  @ApiProperty({ type: [ChatMessageDto], description: 'The conversation so far, ending with the question' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ASSISTANT_MAX_MESSAGES * 2)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

class AssistantSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

@ApiTags('Assistant')
@ApiBearerAuth()
@Controller({ path: 'assistant', version: '1' })
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  @RequireTenant()
  @ApiOperation({ summary: 'Whether answers come from the AI model for you, and whether you may switch it' })
  status(@CurrentAuth() auth: AuthContext) {
    return this.assistant.status(auth);
  }

  @Put('settings')
  @RequirePermissions('organization.update')
  @ApiOperation({ summary: 'Turn AI answers on or off for the organization (questions and looked-up data go to the provider)' })
  settings(@CurrentAuth() auth: AuthContext, @Body() dto: AssistantSettingsDto) {
    return this.assistant.setEnabled(auth, dto.enabled);
  }

  @Post('chat')
  @RequireTenant()
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Ask the assistant; it answers from your own data with your permissions ('fallback' = use the built-in assistant)" })
  chat(@CurrentAuth() auth: AuthContext, @Body() dto: ChatDto) {
    return this.assistant.chat(auth, dto.messages);
  }
}
