import { az } from './az';
import { en } from './en';
import type { Lang, Messages } from './types';

/**
 * The catalogs, with no React attached — the search worker needs these and has
 * no business pulling a UI framework into its bundle.
 */
export const CATALOGS: Record<Lang, Messages> = { en, az };
