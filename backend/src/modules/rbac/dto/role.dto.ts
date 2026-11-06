import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PERMISSION_KEYS, PERMISSION_SCOPES, PermissionScope } from '../../../contracts';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PermissionGrantDto {
  @ApiProperty({ example: 'employee.view' })
  @IsIn(PERMISSION_KEYS, { message: 'key must be a known permission' })
  key!: string;

  @ApiProperty({ enum: PERMISSION_SCOPES })
  @IsIn(PERMISSION_SCOPES)
  scope!: PermissionScope;
}

export class CreateRoleDto {
  @ApiProperty()
  @Transform(trim) @IsString() @Length(2, 100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  description?: string;

  @ApiProperty({ type: [PermissionGrantDto] })
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PermissionGrantDto)
  permissions!: PermissionGrantDto[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @Length(2, 100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  description?: string;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [PermissionGrantDto] })
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PermissionGrantDto)
  permissions!: PermissionGrantDto[];
}
