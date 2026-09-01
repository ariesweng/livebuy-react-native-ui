import type { LBSdkVisibility, LBSdkTheme } from 'livebuy-react-native';

/**
 * Host-supplied options passed to `LivebuyUI.install()`.
 * All fields are optional (null / undefined = "hands off" / use template default).
 *
 * Priority (low → high):
 *   Layer 1: template defaults
 *   Layer 2: these options
 *   Layer 3: sdkConfig (backend always wins when non-null)
 */
export interface LBUIOptions {
  visibility?: LBSdkVisibility | null;
  theme?: LBSdkTheme | null;
  layoutPlayer?: Record<string, unknown> | null;
  layoutWidget?: Record<string, unknown> | null;
}
