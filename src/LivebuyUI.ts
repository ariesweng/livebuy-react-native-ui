import { DefaultTemplate } from './DefaultTemplate';
import type { LBUIOptions } from './LBUIOptions';

/**
 * Entry-point for the Livebuy UI template layer.
 *
 * One-line install: `LivebuyUI.install()`
 *
 * Merge happens at Widget / Player instantiate time, not at install() time (D6).
 * Repeated install() replaces the previous template and options.
 */
export const LivebuyUI = {
  _installedTemplate: null as object | null,
  _hostOptions: null as LBUIOptions | null,

  install(template?: object, options?: LBUIOptions | null): void {
    this._installedTemplate = template ?? new DefaultTemplate();
    this._hostOptions = options ?? null;
  },

  uninstall(): void {
    this._installedTemplate = null;
    this._hostOptions = null;
  },

  get isInstalled(): boolean {
    return this._installedTemplate !== null;
  },

  get hostOptions(): LBUIOptions | null {
    return this._hostOptions;
  },
};
