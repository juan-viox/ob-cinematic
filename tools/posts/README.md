# Journal posts

One file per post: `tools/posts/<slug>.html`. The file name is the URL, so
`what-to-send-after-a-closing.html` publishes at
`/journal/what-to-send-after-a-closing`. Run `node tools/build-pages.mjs` and
the post page, the index, the share card meta, the structured data, the
footer link and the sitemap all follow.

Each file opens with a metadata comment. Five keys are required; the build
fails loudly rather than publishing a post with a missing summary or a date it
guessed. `seoTitle` and `order` are optional.

```html
<!--
title: What to Send a Client After a Closing
date: 2026-09-20
summary: One or two sentences. This is the card text on the index and the
  description a search result shows, so it should read as a promise, not a label.
image: /assets/img/0B0_5183-750w.jpg
imageAlt: A plain description of the photograph for someone who cannot see it
seoTitle: What to Send After a Closing | Occasions Box
order: 1
-->
<p>The body, as plain HTML.</p>
```

Body markup that is already styled: `<p>`, `<h2>`, `<h3>`, `<ul>`, `<ol>`,
`<blockquote>`, `<a>`, `<img>`. Use `<h2>` for sections and `<h3>` for the
small gold label above a list. Don't put an `<h1>` in the body — the title
from the metadata is the page's only one.

`image` must be a path under `site/assets/img/`, and it is read at build time
for its real dimensions, so the page reserves the right space before the photo
loads. Use a JPEG.

`seoTitle` is what a search result shows, used verbatim. A headline written to
be read above the article is usually the wrong thing to put in a search result,
so where the two differ, give both. With no `seoTitle` the title is used, with
` | Occasions Box` appended.

`order` sets the position on the index and overrides the date. Without it,
posts run newest first, which is right for a journal that fills up over time
and wrong on a day when several go live together: the dates are then identical,
and "published first" and "shown first" mean opposite things. Give an order
where the sequence matters. Posts carrying one lead, lowest first; the rest
follow, newest first.

With no posts here, `/journal` is not built at all: no page, no footer link,
no sitemap entry. An empty index is a thin page, and a thin page is worse for
the site than no page.
