// jsdom does not implement layout-related APIs; stub them so components
// that call them during tests don't throw unhandled rejections.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// The i18n layer picks the initial locale from `navigator.language`. Pin it to
// Spanish so the existing tests keep asserting the source (Spanish) strings;
// English is covered by src/i18n/i18n.test.ts.
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'language', { value: 'es-MX', configurable: true })
}
