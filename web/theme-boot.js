import {readTheme,applyTheme} from './appearance.js';
// Runs before the stylesheet and first paint, including on remembered dark mode.
applyTheme(readTheme(),matchMedia('(prefers-color-scheme: dark)').matches);
