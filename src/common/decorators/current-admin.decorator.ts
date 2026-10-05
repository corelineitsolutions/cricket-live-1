import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AdminPrincipal {
  id: string;
  email: string;
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const request = ctx.switchToHttp().getRequest<{ user: AdminPrincipal }>();
    return request.user;
  },
);
