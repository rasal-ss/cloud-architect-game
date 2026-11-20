// Bundles each Lambda handler into dist/<name>/index.mjs for Terraform to zip and deploy.
import { build } from 'esbuild';

const handlers = ['progress', 'designs', 'leaderboard'];

await Promise.all(
  handlers.map((name) =>
    build({
      entryPoints: [`src/handlers/${name}.ts`],
      outfile: `dist/${name}/index.mjs`,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      minify: true,
      sourcemap: 'linked',
      // The AWS SDK v3 ships with the Node.js 22 Lambda runtime.
      external: ['@aws-sdk/*'],
      banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    }),
  ),
);
console.log(`Built ${handlers.length} handlers into dist/`);
