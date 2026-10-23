/**
 * Convert a number to Pixel unit string in CSS.
 */
export function px(value: number): string {
  return `${value}px`;
}

/**
 * Convert a number to Em unit string in CSS.
 */
export function em(value: number): string {
  return `${value}em`;
}

/**
 * Convert a number to Rem unit string in CSS.
 */
export function rem(value: number): string {
  return `${value}rem`;
}

/**
 * Convert a number to Viewport Height unit string in CSS.
 */
export function vh(value: number): string {
  return `${value}vh`;
}

/**
 * Convert a number to Viewport Width unit string in CSS.
 */
export function vw(value: number): string {
  return `${value}vw`;
}

/**
 * Convert a number to Percentage unit string in CSS.
 */
export function percent(value: number): string {
  return `${value}%`;
}

/**
 * Select size from theme.
 */
export function spacingStr(theme: Theme): (unit: MeasureUnit) => string {
  return compose(px, prop(__, theme.spacings));
}

/**
 * Select radius from theme.
 */
export function radiusStr(theme: Theme): (unit: MeasureUnit) => string {
  return compose(px, prop(__, theme.radius));
}

/**
 * Select font size from theme.
 */
export function fontSizeStr(theme: Theme): (unit: FontSizeUnit) => string {
  return compose(px, prop(__, theme.fontSizes));
}

/**
 * Select title font size from theme.
 */
export function titleFontSizeStr(theme: Theme): (unit: FontSizeUnit) => string {
  return compose(px, prop(__, theme.titleFontSize));
}
