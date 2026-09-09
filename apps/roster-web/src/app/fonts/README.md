# Fonts

## `inter-latin-wght-normal.woff2`

The Latin, variable-weight (`wght` 100–900), upright cut of **Inter Variable**.

- **Source:** `@fontsource-variable/inter@5.3.0`, file
  `files/inter-latin-wght-normal.woff2`, byte-for-byte.
- **License:** SIL Open Font License 1.1 — see [`OFL.txt`](./OFL.txt).
- **Why committed rather than an npm dependency:** the build must be hermetic.
  `next/font/google` fetches Inter from `fonts.googleapis.com` at build time and
  a network-isolated `next build` fails hard (F192 / FDN-91). A committed file is
  a build input like any other and needs no resolver path into `node_modules`.

### Regenerating

```bash
npm pack @fontsource-variable/inter@<version>   # or a newer pinned version
tar -xf fontsource-variable-inter-*.tgz
cp package/files/inter-latin-wght-normal.woff2 apps/roster-web/src/app/fonts/
cp package/LICENSE apps/roster-web/src/app/fonts/OFL.txt
```

Then update the version above and the comment in `../layout.tsx`. Only the
Latin subset is carried; add sibling subsets here and to the `localFont` call
only when a product surface needs them.
