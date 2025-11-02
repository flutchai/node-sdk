/**
 * Core entity interfaces
 */

export interface IDeletionInfo {
  deletedAt: Date;
  deletedBy: string;
  reason?: string;
}

export interface IBaseEntity {
  id: string;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletion?: IDeletionInfo;
}
