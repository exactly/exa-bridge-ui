import { Color } from '../styles/Color';

export type UiThemeMode = 'light' | 'dark';

export const APP_NAME = 'EXA Token Bridge';
export const APP_DESCRIPTION = 'Bridge your EXA tokens between Optimism and Base. Powered by Hyperlane.';
export const APP_URL = 'https://bridge.exact.ly';
export const BRAND_COLOR = Color.primary['500'];

export const UI_THEME_STORAGE_KEY = 'warp-ui-theme';
export const DEFAULT_UI_THEME_MODE: UiThemeMode = 'light';
