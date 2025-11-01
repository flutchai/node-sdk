import { Injectable, ForbiddenException, Logger } from "@nestjs/common";
import { CallbackRecord } from "./callback.interface";

export interface CallbackUser {
  userId: string;
  roles?: string[];
  permissions?: string[];
  companyId?: string;
}

export interface ACLValidationResult {
  allowed: boolean;
  reason?: string;
  requiredScopes?: string[];
  userScopes?: string[];
}

/**
 * Access Control Layer for callback execution.
 * Validates that the user has permission to execute the callback.
 */
@Injectable()
export class CallbackACL {
  private readonly logger = new Logger(CallbackACL.name);

  /**
   * Validates if the user can execute the callback.
   * @throws ForbiddenException if access is denied
   */
  async validate(
    user: CallbackUser | undefined,
    record: CallbackRecord
  ): Promise<ACLValidationResult> {
    const validationStart = Date.now();

    try {
      // 1. Check if user is authenticated
      if (!user) {
        this.logger.warn(
          `Unauthenticated access attempt for callback ${record.token}`
        );
        throw new ForbiddenException(
          "Authentication required for callback execution"
        );
      }

      // 2. Check user ID match
      if (record.userId && record.userId !== user.userId) {
        this.logger.warn(
          `User ${user.userId} attempted to execute callback for user ${record.userId}`
        );
        throw new ForbiddenException(
          "Cannot execute callback for another user"
        );
      }

      // TODO: Implement proper authorization on backend level
      // - Check access to specific agent (not graph type)
      // - Verify user has permission to use the agent
      // - Check company/organization access
      // - Backend should handle all business logic authorization

      this.logger.log(
        `ACL validation simplified: userId match only for callback ${record.token}`
      );

      // 6. Additional security checks
      await this.performAdditionalSecurityChecks(user, record);

      const validationTime = Date.now() - validationStart;
      this.logger.debug(
        `ACL validation passed for user ${user.userId} on callback ${record.token} ` +
          `(${validationTime}ms)`
      );

      return {
        allowed: true,
      };
    } catch (error) {
      const validationTime = Date.now() - validationStart;
      this.logger.error(
        `ACL validation failed for callback ${record.token} (${validationTime}ms): ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Validates if user has required scopes/permissions.
   */
  private validateScopes(
    user: CallbackUser,
    requiredScopes: string[]
  ): boolean {
    if (!user.permissions || user.permissions.length === 0) {
      return false;
    }

    // Check if user has all required scopes
    return requiredScopes.every(scope => {
      // Support wildcard permissions (e.g., "finance:*" matches "finance:write")
      const hasExactScope = user.permissions.includes(scope);
      const hasWildcardScope = user.permissions.some(p => {
        if (p.includes("*")) {
          const pattern = p.replace("*", ".*");
          return new RegExp(`^${pattern}$`).test(scope);
        }
        return false;
      });

      return hasExactScope || hasWildcardScope;
    });
  }

  /**
   * Validates access to specific graph type.
   * Can be extended to check graph-specific permissions.
   */
  private async validateGraphTypeAccess(
    user: CallbackUser,
    graphType: string
  ): Promise<boolean> {
    // Extract namespace from graphType (e.g., "finance::1.0.0" -> "finance")
    const [namespace] = graphType.split("::");

    // Check if user has access to this graph namespace
    const allowedNamespaces = this.getAllowedGraphNamespaces(user);

    this.logger.log(`Graph access check for user ${user.userId}`, {
      graphType,
      namespace,
      allowedNamespaces,
      userRoles: user.roles,
      userPermissions: user.permissions,
      userCompanyId: user.companyId,
    });

    // Special case: public graphs are accessible to all authenticated users
    if (namespace === "public") {
      return true;
    }

    // Check if user has explicit access to this namespace
    if (
      !allowedNamespaces.includes(namespace) &&
      !allowedNamespaces.includes("*")
    ) {
      this.logger.warn(
        `Access denied: namespace "${namespace}" not in allowed namespaces: ${allowedNamespaces.join(", ")}`
      );
      return false;
    }

    // Additional graph-specific checks can be added here
    // For example, checking if the graph belongs to user's company

    return true;
  }

  /**
   * Gets list of graph namespaces user has access to.
   */
  private getAllowedGraphNamespaces(user: CallbackUser): string[] {
    const namespaces: string[] = [];

    // Admin users have access to all graphs
    if (user.roles?.includes("admin")) {
      namespaces.push("*");
    }

    // Extract namespaces from user permissions
    // e.g., "graph:finance:read" -> "finance"
    user.permissions?.forEach(permission => {
      const match = permission.match(/^graph:([^:]+):/);
      if (match) {
        namespaces.push(match[1]);
      }
    });

    // Users always have access to their company's graphs
    if (user.companyId) {
      namespaces.push(user.companyId);
    }

    return [...new Set(namespaces)]; // Remove duplicates
  }

  /**
   * Validates company-level access restrictions.
   */
  private validateCompanyAccess(
    user: CallbackUser,
    requiredCompanyId: string
  ): boolean {
    // Users can only access callbacks for their own company
    return user.companyId === requiredCompanyId;
  }

  /**
   * Performs additional security checks.
   * Can be extended for custom security requirements.
   */
  private async performAdditionalSecurityChecks(
    user: CallbackUser,
    record: CallbackRecord
  ): Promise<void> {
    // Check if callback is expired (additional safety check)
    const now = Date.now();
    const age = now - record.createdAt;
    const maxAge = (record.metadata?.ttlSec || 600) * 1000;

    if (age > maxAge) {
      throw new ForbiddenException("Callback token has expired");
    }

    // Check if callback has been retried too many times
    if (record.retries > 3) {
      throw new ForbiddenException(
        "Callback has exceeded maximum retry attempts"
      );
    }

    // Check for suspicious activity patterns
    // This could be extended to check rate limits, IP restrictions, etc.
  }

  /**
   * Checks if a callback can be retried by the user.
   */
  async canRetry(user: CallbackUser, record: CallbackRecord): Promise<boolean> {
    // Only the original user can retry their callbacks
    if (record.userId !== user.userId) {
      return false;
    }

    // Check if within retry limit
    if (record.retries >= 3) {
      return false;
    }

    // Check if callback is in retryable state
    if (!["failed", "processing"].includes(record.status)) {
      return false;
    }

    return true;
  }

  /**
   * Gets detailed permissions for a callback.
   * Useful for debugging and audit logs.
   */
  getPermissionDetails(
    user: CallbackUser,
    record: CallbackRecord
  ): Record<string, any> {
    return {
      userId: user.userId,
      callbackUserId: record.userId,
      userIdMatch: user.userId === record.userId,
      requiredScopes: record.metadata?.scopes || [],
      userScopes: user.permissions || [],
      userRoles: user.roles || [],
      graphType: record.graphType,
      companyId: user.companyId,
      callbackCompanyId: record.metadata?.companyId,
      companyMatch:
        !record.metadata?.companyId ||
        user.companyId === record.metadata.companyId,
    };
  }
}
