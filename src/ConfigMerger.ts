import type { SDKConfig } from 'livebuy-react-native';
import type { LBUIOptions } from './LBUIOptions';

/**
 * Three-layer config merge for the LivebuyUI template system.
 *
 * Priority (low → high):
 *   Layer 1: Template defaults  (written in template source)
 *   Layer 2: Host install() options  (LBUIOptions)
 *   Layer 3: sdkConfig  (backend — always wins when non-null)
 *
 * `null`/`undefined` means "hands off" (this layer does not express a preference).
 */
export const ConfigMerger = {
  // Visibility (Task 7.6)

  effectiveVisibility(
    sdkValue: boolean | null | undefined,
    hostValue: boolean | null | undefined,
    templateDefault: boolean,
  ): boolean {
    if (sdkValue != null) return sdkValue;
    if (hostValue != null) return hostValue;
    return templateDefault;
  },

  // Layout map

  effectiveLayoutValue(
    key: string,
    sdkMap: Record<string, unknown> | null | undefined,
    hostMap: Record<string, unknown> | null | undefined,
    templateDefaults: Record<string, unknown>,
  ): unknown {
    if (sdkMap != null && Object.prototype.hasOwnProperty.call(sdkMap, key)) return sdkMap[key];
    if (hostMap != null && Object.prototype.hasOwnProperty.call(hostMap, key)) return hostMap[key];
    return templateDefaults[key];
  },

  // Theme

  effectivePrimaryColor(
    sdkConfig: SDKConfig,
    hostOptions: LBUIOptions | null | undefined,
    templateDefault: string | null,
  ): string | null {
    return sdkConfig.theme?.primaryColor ?? hostOptions?.theme?.primaryColor ?? templateDefault;
  },

  effectiveFontScale(
    sdkConfig: SDKConfig,
    hostOptions: LBUIOptions | null | undefined,
    templateDefault: number | null,
  ): number | null {
    return sdkConfig.theme?.fontScale ?? hostOptions?.theme?.fontScale ?? templateDefault;
  },
};
