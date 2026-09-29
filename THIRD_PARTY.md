# Third-party source notices

## OpenFrontIO

Copyright OpenFront and Contributors. Licensed under GNU AGPL version 3.

Source: https://github.com/openfrontio/OpenFrontIO/tree/5dc09dbd2dde5105d8b403d7b5ddf8d503e04ec2

- `src/vendor/Line.ts`: `src/core/utilities/Line.ts`, with a source notice prepended.
- `src/vendor/SAMTargeting.ts`: types and `SAMTargetingSystem` extracted from `src/core/execution/SAMLauncherExecution.ts`. The class is exported and module imports are replaced with adapter constants/type checks; the targeting algorithm is preserved.
- `src/vendor/engine.mjs`: generated JavaScript for those two files.

The combined v4 userscript is distributed under AGPL-3.0-only. The complete license is in LICENSE. Its preferred editable source and build scripts are included in this repository and source archive.

## Original x50 userscript

`src/legacy.js` comes from melodysdreamj/openfront-x50-salvo commit `95781a692b4f3023e888947226d929b4bfed19c2`. Its metadata declares `@author local build` and `@license MIT`; those declarations remain in the source. The combined generated script changes its metadata to AGPL-3.0-only to reflect the included OpenFront code.

MIT permission notice (for the original portion):

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
