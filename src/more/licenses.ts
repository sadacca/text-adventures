const MIT_BODY = (copyright: string) => `${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;

export interface LicenseEntry {
  name: string;
  role: string;
  license: string;
  text: string;
}

/**
 * Verified 2026-07-13 against each project's own LICENSE file (Bocfel's fetched from
 * garglk/garglk, the fork emglken actually vendors; the rest read from node_modules).
 * SPECS.md originally called for "Bocfel GPL-2.0" attribution — that was wrong: Bocfel
 * itself is MIT (Chris Spiegel). GPL-2.0 does appear in emglken's own bundle, but only
 * for interpreters this app doesn't use (Scare, TADS) — emglken's package.json license
 * field describes the whole npm bundle, not the one interpreter (bocfel.wasm) we ship.
 */
export const LICENSES: LicenseEntry[] = [
  {
    name: 'Bocfel',
    role: 'The Z-machine interpreter that runs every story file, compiled to WebAssembly',
    license: 'MIT',
    text: MIT_BODY('Copyright 2009-2025 Chris Spiegel'),
  },
  {
    name: 'emglken',
    role: "Wraps Bocfel's WebAssembly build and speaks the GlkOte/RemGlk protocol",
    license: 'MIT',
    text: MIT_BODY('Copyright (c) 2020, Dannii Willis'),
  },
  {
    name: 'AsyncGlk',
    role: 'The GlkOte UI-protocol implementation this app talks to (vendored, not from npm)',
    license: 'MIT',
    text: MIT_BODY('Copyright (c) 2008-2021, Andrew Plotkin\nCopyright (c) 2022 Dannii Willis'),
  },
  {
    name: 'React / react-dom',
    role: 'UI library',
    license: 'MIT',
    text: MIT_BODY('Copyright (c) Meta Platforms, Inc. and affiliates.'),
  },
  {
    name: 'zustand',
    role: 'App state stores',
    license: 'MIT',
    text: MIT_BODY('Copyright (c) 2019 Paul Henschel'),
  },
  {
    name: 'idb',
    role: 'IndexedDB wrapper used for the library, saves, maps, and transcripts',
    license: 'ISC',
    text: `Copyright (c) 2016, Jake Archibald <jaffathecake@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
  },
  {
    name: 'lodash-es',
    role: 'Utility functions',
    license: 'MIT',
    text: MIT_BODY('Copyright OpenJS Foundation and other contributors <https://openjsf.org/>'),
  },
  {
    name: 'Zork I (zork1.z3)',
    role: 'Bundled sample game',
    license: 'MIT',
    text: `${MIT_BODY('Copyright (c) 2025 Microsoft')}

Original game (1977-1979) by Marc Blank, Dave Lebling, Bruce Daniels, and Tim
Anderson. Microsoft released this MDL source and its compiled story file as a
historical-preservation project in 2025 (github.com/historicalsource/zork1)
under the MIT license above; this app bundles the prebuilt COMPILED/zork1.z3
binary unmodified. This is an unofficial fan use of a historical release, not
an endorsed or official Zork product; "Zork" may still be a trademark of its
current rights holder independent of this MIT grant.`,
  },
];
