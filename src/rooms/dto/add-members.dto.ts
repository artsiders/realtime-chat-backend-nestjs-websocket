import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class AddMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  userIds!: string[];

  @IsOptional()
  @IsBoolean()
  shareHistoryWithNewMembers?: boolean;
}

