import svelte from "rollup-plugin-svelte";
import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
// import livereload from "rollup-plugin-livereload";
import { terser } from "rollup-plugin-terser";
import sveltePreprocess from "svelte-preprocess";
import typescript from "@rollup/plugin-typescript";
import css from "rollup-plugin-css-only";
import alias from "@rollup/plugin-alias";

import fs from "fs";
import path from "path";

const production = !process.env.ROLLUP_WATCH;

// function serve() {
//   let server;

//   function toExit() {
//     if (server) server.kill(0);
//   }

//   return {
//     writeBundle() {
//       if (server) return;
//       server = require("child_process").spawn(
//         "npm",
//         ["run", "start", "--", "--dev"],
//         {
//           stdio: ["ignore", "inherit", "inherit"],
//           shell: true,
//         },
//       );

//       process.on("SIGTERM", toExit);
//       process.on("exit", toExit);
//     },
//   };
// }

export default fs.readdirSync(path.join(__dirname, "src", "pages")).map((input) => {
  const name = input.split(".")[0];
  return {
    input: `src/pages/${name}.ts`,
    output: {
      sourcemap: true,
      format: "iife",
      name: "app",
      file: `public/build/pages/${name}/${name}.js`
    },
    plugins: [
      svelte({
        preprocess: sveltePreprocess({ sourceMap: !production }),
        compilerOptions: {
          // enable run-time checks when not in production
          dev: !production
        }
      }),
      // we'll extract any component CSS out into
      // a separate file - better for performance
      css({ output: `${name}.css` }),

      // If you have external dependencies installed from
      // npm, you'll most likely need these plugins. In
      // some cases you'll need additional configuration -
      // consult the documentation for details:
      // https://github.com/rollup/plugins/tree/master/packages/commonjs
      resolve({
        browser: true,
        dedupe: ["svelte"]
      }),
      commonjs(),
      typescript({
        sourceMap: !production,
        inlineSources: !production,
        include: ["**/*.ts", "../shared/**/*.ts"]
      }),
      alias({
        entries: [
          {
            find: "@shared",
            replacement: path.resolve(__dirname, "../shared")
          },
          {
            find: "@resources",
            replacement: path.resolve(__dirname, "../resources")
          }
        ]
      }),
      // In dev mode, call `npm run start` once
      // the bundle has been generated
      // !production && serve(),

      // Watch the `public` directory and refresh the
      // browser on changes when not in production
      // !production && livereload("public"),

      // If we're building for production (npm run build
      // instead of npm run dev), minify
      production && terser()
    ],
    watch: {
      clearScreen: false
    }
  };
});

// export default {
//   input: "src/main.ts",
//   output: {
//     sourcemap: true,
//     format: "iife",
//     name: "app",
//     file: "public/build/bundle.js",
//   },
//   plugins: [
//     svelte({
//       preprocess: sveltePreprocess({ sourceMap: !production }),
//       compilerOptions: {
//         // enable run-time checks when not in production
//         dev: !production,
//       },
//     }),
//     // we'll extract any component CSS out into
//     // a separate file - better for performance
//     css({ output: "bundle.css" }),

//     // If you have external dependencies installed from
//     // npm, you'll most likely need these plugins. In
//     // some cases you'll need additional configuration -
//     // consult the documentation for details:
//     // https://github.com/rollup/plugins/tree/master/packages/commonjs
//     resolve({
//       browser: true,
//       dedupe: ["svelte"],
//     }),
//     commonjs(),
//     typescript({
//       sourceMap: !production,
//       inlineSources: !production,
//     }),

//     // In dev mode, call `npm run start` once
//     // the bundle has been generated
//     // !production && serve(),

//     // Watch the `public` directory and refresh the
//     // browser on changes when not in production
//     // !production && livereload("public"),

//     // If we're building for production (npm run build
//     // instead of npm run dev), minify
//     production && terser(),
//   ],
//   watch: {
//     clearScreen: false,
//   },
// };
