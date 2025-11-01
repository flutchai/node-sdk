/**
 * Tool catalog types
 */

import { IBaseEntity } from "../core/base-entity";
import { ModelProvider, ModelType } from "../models";

/**
 * Tool definition in catalog
 */
export interface IToolCatalog extends IBaseEntity {
  /** Tool name used in code (e.g., "web_search", "datetime") */
  toolName: string;
  /** Display title for UI */
  title: string;
  /** Brief description */
  description?: string;
  /** Tool category (e.g., "github", "slack", "sheets", "utilities") */
  category?: string;
  /** Is tool active and available */
  isActive: boolean;
  /** Tool version string */
  toolVersion?: string;
  /** Configuration schema for tool parameters */
  configSchema?: IToolConfigOption[];
}

/**
 * Tool configuration option definition
 */
export interface IToolConfigOption {
  key: string;
  name: string;
  description?: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "select"
    | "kbselect"
    | "modelSelector"
    | "text"
    | "textarea";
  required?: boolean;
  defaultValue?: any;
  options?: Array<{ value: string; label: string }>;
  params?: {
    isMulti?: boolean;
    minimum?: number;
    maximum?: number;
    placeholder?: string;
    maxLength?: number;
    modelType?: ModelType;
    provider?: ModelProvider;
    isActive?: boolean;
  };
}
