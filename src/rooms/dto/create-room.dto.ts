import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9 _\-]+$/)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  memberIds!: string[];

  @IsOptional()
  @IsBoolean()
  shareHistoryWithNewMembers?: boolean;
}

