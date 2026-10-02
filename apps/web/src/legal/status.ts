/**
 * While true, every legal page shows a "draft, pending legal review" banner and highlights
 * each point the lawyer must complete. Turn it off ONLY after the lawyer approved the texts
 * and every `[[...]]` marker was resolved: a test fails if markers remain while it is false.
 */
export const LEGAL_REVIEW_PENDING = true;

/** The version date shown on the pages; update it when the lawyer approves a final text. */
export const LEGAL_DRAFT_DATE = '2 de octubre de 2026';
