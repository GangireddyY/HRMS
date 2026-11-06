import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MEMBERSHIP_STATUSES, MembershipStatus } from '../../../contracts';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UserListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MEMBERSHIP_STATUSES })
  @IsOptional() @IsIn(MEMBERSHIP_STATUSES)
  status?: MembershipStatus;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  roleId?: string;
}

export class InviteUserDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail() @MaxLength(254)
  email!: string;

  @ApiProperty()
  @Transform(trim) @IsString() @Length(1, 100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim) @IsString() @Length(1, 100)
  lastName!: string;

  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true })
  roleIds!: string[];
}

export class SetUserRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true })
  roleIds!: string[];
}
