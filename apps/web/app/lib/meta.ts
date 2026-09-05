/**
 * The tags a page needs to look right when somebody pastes its link.
 *
 * Kept in one place because they have to agree: a title in the tab that says
 * one thing and a card in a chat window that says another is the kind of
 * detail people read as carelessness.
 */

const SITE = 'huddle';

/** Absolute, because a card is fetched by a server that has no page context. */
const ORIGIN = 'https://huddle.procd.cc';

export interface PageMeta {
  title: string;
  description: string;
  /** Where this page lives, for the canonical link and the card. */
  path?: string;
  /**
   * Keep it out of search results. It still gets a card: an invitation is
   * pasted into a chat window far more often than it is crawled, and a bare
   * link there says nothing about what is being offered.
   */
  private?: boolean;
  /** A card of its own, for a page that deserves one. */
  image?: string;
}

export function pageMeta({
  title,
  description,
  path = '/',
  private: hidden = false,
  image = `${ORIGIN}/og.png`,
}: PageMeta) {
  const url = `${ORIGIN}${path}`;
  const full = title;

  return [
    { title: full },
    { name: 'description', content: description },
    ...(hidden
      ? [{ name: 'robots', content: 'noindex, nofollow' }]
      : [{ tagName: 'link', rel: 'canonical', href: url }]),

    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE },
    { property: 'og:title', content: full },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: 'huddle, open source team chat you host yourself' },

    // Large card rather than the thumbnail, because the image carries the
    // point and a 120 pixel square carries nothing.
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: full },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ];
}
