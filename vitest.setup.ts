// jsdom does not implement layout-related APIs; stub them so components
// that call them during tests don't throw unhandled rejections.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
