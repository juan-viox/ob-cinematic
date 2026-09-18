# Journal posts

One file per post: `tools/posts/<slug>.html`. The file name is the URL, so
`what-to-send-after-a-closing.html` publishes at
`/journal/what-to-send-after-a-closing`. Run `node tools/build-pages.mjs` and
the post page, the index, the share card meta, the structured data, the
footer link and the sitemap all follow.

Each file opens with a metadata comment. All five keys are required; the build
fails loudly rather than publishing a post with a missing summary or a date it
guessed.

```html
<!--
title: What to Send a Client After a Closing
date: 2026-09-20
summary: One or two sentences. This is the card text on the index and the
  description a search result shows, so it should read as a promise, not a label.
image: /assets/img/0B0_5183-750w.jpg
imageAlt: A plain description of the photograph for someone who cannot see it
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

With no posts here, `/journal` is not built at all: no page, no footer link,
no sitemap entry. An empty index is a thin page, and a thin page is worse for
the site than no page.
