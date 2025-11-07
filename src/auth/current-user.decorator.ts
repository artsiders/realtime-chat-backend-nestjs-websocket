import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  if (ctx.getType<'http' | 'ws'>() === 'http') {
    const request = ctx.switchToHttp().getRequest();
    return request.user as { id: string };
  }

  const client = ctx.switchToWs().getClient();
  return client.data.user as { id: string };
});

