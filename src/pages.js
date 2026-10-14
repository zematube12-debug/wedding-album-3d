// ---------------------------------------------------------------------------
// ALBUM CONTENT
//
// Every entry is ONE full page image (portrait, ratio ~ 1100 x 1300).
// Photos, frames and captions should already be baked into the image.
//
// The list length must be EVEN (minimum 4):
//   [0]  inside of the front cover (left page of the first spread)
//   [1]  right page of the first spread
//   [2]  left page of the second spread, [3] right page ... and so on
//   [last] inside of the back cover
// 24 images  ->  12 spreads.
//
// You can use:
//   - web URLs:           'https://example.com/page1.jpg'
//   - bundled files:      require('../assets/pages/p01.jpg')   (must be static)
//
// The demo below uses random placeholder photos so the app works immediately.
// ---------------------------------------------------------------------------
export const TITLE = 'Our Wedding Album';
export const SUBTITLE = 'Two Hearts  •  One Journey  •  Forever';

const demo = (n) => `https://picsum.photos/seed/wedding${n}/1100/1300.jpg`;

export const PAGES = Array.from({ length: 24 }, (_, i) => demo(i + 1));
