import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { CallbackStore } from "../callbacks";
import { CallbackRecord } from "./callback.interface";
import { CallbackACL, CallbackUser } from "../callbacks/callback-acl.service";

export interface CallbackRequest extends Request {
  callbackRecord: CallbackRecord;
  user?: CallbackUser;
}

@Injectable()
export class CallbackTokenGuard implements CanActivate {
  private readonly logger = new Logger(CallbackTokenGuard.name);

  constructor(
    private readonly store: CallbackStore,
    private readonly acl: CallbackACL
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CallbackRequest>();
    const token = request.body?.token;
    if (!token) {
      throw new UnauthorizedException("Callback token missing");
    }
    const record = await this.store.getAndLock(token);
    if (!record) {
      throw new UnauthorizedException("Invalid callback token");
    }

    // Extract user from request (assumes JWT auth middleware has run)
    const user = this.extractUser(request);

    // Validate ACL permissions
    await this.acl.validate(user, record);

    request.callbackRecord = record;
    request.user = user;
    return true;
  }

  private extractUser(request: CallbackRequest): CallbackUser | undefined {
    this.logger.log(`Extracting user from request`, {
      hasRequestUser: !!request.user,
      hasPlatformContext: !!request.body?.platformContext,
      platformContextKeys: request.body?.platformContext
        ? Object.keys(request.body.platformContext)
        : [],
    });

    // Try to extract user from JWT middleware first (direct API calls)
    if (request.user) {
      this.logger.log(
        `Found user from JWT middleware: ${request.user["id"] || request.user["sub"]}`
      );
      return {
        userId: request.user["id"] || request.user["sub"],
        roles: request.user["roles"],
        permissions: request.user["permissions"],
        companyId: request.user["companyId"],
      };
    }

    // For inter-service calls, extract user from platformContext
    const platformContext = request.body?.platformContext;
    if (
      platformContext &&
      platformContext.userId &&
      platformContext.authenticated
    ) {
      this.logger.log(
        `Found user from platformContext: ${platformContext.userId}`
      );
      return {
        userId: platformContext.userId,
        roles: platformContext.roles || [],
        permissions: platformContext.permissions || [],
        companyId: platformContext.companyId,
      };
    }

    this.logger.warn(`No user found in request or platformContext`);
    return undefined;
  }
}
