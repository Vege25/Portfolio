# Veeti Sorakivi · portfolio

Live: https://sorakiviportfolio.netlify.app/

Built with Astro 6, Tailwind CSS 4 and TypeScript. React is used only for the interactive GPS navigation demo.

## Run

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # type check + static build to dist/
npm test         # tests for the GPS navigation core used by the demo
```

Needs Node 22.12 or newer. Netlify builds with `netlify.toml`.

## Where things are

| What | Where |
|---|---|
| Case studies (text, spec sheet, facts) | `src/content/projects/*.mdx` |
| Experience, earlier work, links, email | `src/data/site.ts` |
| Colours, fonts, base styles | `src/styles/global.css` |
| Home page | `src/pages/index.astro` |
| Case page template | `src/pages/work/[slug].astro` |
| GPS demo + navigation core (copied from the gps repo) | `src/components/gps-demo/` |

Add a CV by dropping `public/cv.pdf` in place. The contact section shows the link automatically.
