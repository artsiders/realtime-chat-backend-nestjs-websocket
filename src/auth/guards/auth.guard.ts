import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(
      request.headers.authorization as string | undefined,
      request.headers['x-session-token'] as string | string[] | undefined,
    );

    const user = await this.authService.validateToken(token);
    request.user = user;
    return true;
  }

  private extractToken(authorization?: string, fallback?: string | string[]): string {
    if (authorization) {
      if (authorization.startsWith('Bearer ')) {
        return authorization.slice(7);
      }
      return authorization;
    }

    if (fallback) {
      return Array.isArray(fallback) ? fallback[0] : fallback;
    }

    throw new UnauthorizedException('Missing token');
  }
}

