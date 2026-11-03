import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      order: z.number(),
      /** What it is, in a few words: "Personal finance app" */
      kicker: z.string(),
      /** Shorter name for tight spots like the home page intro list; defaults to the title */
      shortTitle: z.string().optional(),
      /** One line for the home page intro list */
      oneLiner: z.string(),
      /** The problem, in one or two sentences, in first person. Shown on the home page and as the case intro. */
      problem: z.string(),
      /** Meta description for the case page */
      description: z.string(),
      status: z.object({
        kind: z.enum(['live', 'beta', 'wip']),
        label: z.string(),
      }),
      role: z.string(),
      platform: z.string(),
      stack: z.array(z.string()),
      /** Two or three words for the home page row */
      tags: z.array(z.string()).max(3),
      links: z
        .array(z.object({ label: z.string(), href: z.string() }))
        .default([]),
      /** Second call to action on the home page row: a demo or the project's own site */
      demo: z
        .object({
          label: z.string(),
          href: z.string(),
          /** "try" = something people can use now (filled button); "info" = a page about it (outlined) */
          kind: z.enum(['try', 'info']).default('try'),
        })
        .optional(),
      /** Shown under the links, e.g. why there is no code */
      linkNote: z.string().optional(),
      cover: z.object({
        kind: z.enum(['phones', 'wide', 'aura', 'gps']),
        images: z.array(image()).default([]),
        alt: z.string(),
        caption: z.string().optional(),
      }),
      facts: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
    }),
});

export const collections = { projects };
