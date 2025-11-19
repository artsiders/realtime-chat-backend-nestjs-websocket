import { IsHexColor, IsOptional, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_\-]{3,20}$/)
  username?: string;

  @IsOptional()
  @IsHexColor()
  displayColor?: string;
}

