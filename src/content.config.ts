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
      /** Shown when there is nothing to link to yet, e.g. "Demo coming" */
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
