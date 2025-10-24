// import * as path from 'path';
// import Mocha from 'mocha';
// import { glob } from 'glob';

// export async function run(): Promise<void> {
//   // DO NOT create a new Mocha instance - vscode-test already did that!
//   // Just return the test files to run
  
//   const mocha = new Mocha({
//     ui: 'tdd',
//     color: true,
//     parallel: false,  // CRITICAL
//     jobs: 1,          // CRITICAL  
//   });

//   const testsRoot = path.resolve(__dirname, '.');
//   const files = await glob('**/**.test.js', { cwd: testsRoot });

//   // Add files to the test suite
//   files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

//   return new Promise((resolve, reject) => {
//     try {
//       mocha.run(failures => {
//         if (failures > 0) {
//           reject(new Error(`${failures} tests failed.`));
//         } else {
//           resolve();
//         }
//       });
//     } catch (err) {
//       reject(err);
//     }
//   });
// }