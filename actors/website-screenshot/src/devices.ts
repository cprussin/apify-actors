export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type DeviceName = (typeof DEVICES)[number];

export interface DeviceProfile {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  /** Browser user agent; `null` keeps the browser's own (desktop Chrome). */
  userAgent: string | null;
}

const IOS_SAFARI =
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * Device presets. Scale factors stay at 1-2 so full-page captures remain fast
 * and small; set width/height to override the viewport.
 */
export const DEVICE_PRESETS: Record<DeviceName, DeviceProfile> = {
  desktop: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: null,
  },
  tablet: {
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: `Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) ${IOS_SAFARI}`,
  },
  mobile: {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ${IOS_SAFARI}`,
  },
};

/** A preset with optional viewport overrides. */
export function deviceProfile(
  device: DeviceName,
  width?: number | null,
  height?: number | null,
): DeviceProfile {
  const p = DEVICE_PRESETS[device];
  return { ...p, width: width ?? p.width, height: height ?? p.height };
}

/** A consistent desktop Chrome UA (no "HeadlessChrome"). */
export const chromeUserAgent = (version: string): string =>
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.split(".")[0]}.0.0.0 Safari/537.36`;
