/**
 * Message attachment types
 */

export enum AttachmentType {
  IMAGE = "image",
  VOICE = "voice",
  FILE = "file",
  BUTTON = "button",
  CITATION = "citation",
  SUGGESTION = "suggestion",
  WEBAPP = "webapp",
  SOURCE = "source",
  CARD = "card",
  CHART = "chart",
}

/** Attachment interface */
export interface IAttachment {
  /** Names the attachment so that it can be changed later (dispatchAttachmentUpdate): a progress list, a report card. */
  id?: string;
  type: AttachmentType;
  value: any;
  metadata?: Record<string, any>;
}

/** Citation attachment value */
export type CitationValue = {
  source: {
    url: string;
    title: string;
    type: "webpage" | "pdf" | "article";
    articleId?: string;
    knowledgeBaseId?: string;
  };
};
