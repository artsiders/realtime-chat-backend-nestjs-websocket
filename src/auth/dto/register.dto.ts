import { IsEmail, IsHexColor, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9_\-]{3,20}$/)
  username!: string;

  @IsOptional()
  @IsHexColor()
  displayColor?: string;
}

