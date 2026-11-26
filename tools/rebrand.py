#!/usr/bin/env python3
"""Kibitz: rename NEO to Kibitz across a checkout of upstream NEO.

Run on a clean copy of hughhowey/neo (tools/sync-upstream.sh does this for
every upstream release), never on main: it is deterministic, so the same
upstream always rebrands to the same tree, and main merges that tree in.

    python3 tools/rebrand.py <path-to-neo-checkout>

What it changes: the product name, code identifiers (window.neo, NeoI18n,
neo-* CSS and storage keys, NEO_* env vars), file names, the app and bundle
ids (com.hughhowey.neo -> com.koldenaxelson.kibitz), the GitHub repo that
updates and bug reports point at, and the default library folder
("NEO Library" -> "Kibitz Library").

What it leaves alone:
  - Copyright and licence notices (LICENSE, licenses/, "Hugh Howey").
  - Dictionaries, fonts and vendored third-party code.
  - Desktop links to Hugh's NEO Pocket, the iPad/iPhone app on the App
    Store: its name, its iCloud folder and its store link. Desktop Kibitz
    can still share a library with it. The pocket/ sources themselves are
    renamed, ready for a Kibitz Pocket of our own one day.
  - README.md is removed: Kibitz keeps its own on main.
"""
import os
import re
import subprocess
import sys

SKIP_PREFIXES = ('dictionaries/', 'fonts/', 'licenses/', 'print/paged.polyfill.js')
SKIP_FILES = {'LICENSE'}
DROP_FILES = ['README.md']

# Outside pocket/: lines about Hugh's NEO Pocket app stay exactly as they are.
KEEP_LINE_MARKERS = (
    'NEO for iPad and iPhone',          # Help menu item describing NEO Pocket
    'NEO Pocket is NEO',                # "...free on the App Store."
    'iCloud~com~hughhowey~neo~pocket',  # NEO Pocket's iCloud Drive folder
    'POCKET_STORE_URL =',
    "path.join(dir, 'NEO Library')",    # the library folder inside NEO Pocket's
    "path.join(cloudDocs, 'NEO Library')",
)
KEEP_PHRASES = ('NEO Pocket',)

# Files and lines that belong to the pocket/ app itself, renamed in full.
POCKET_FILES = ('pocket/', '.github/workflows/pocket.yml')
POCKET_LINE_MARKERS = (
    'turn it on for NEO Pocket',        # an Android message the pocket app shows
    "the app's name stays as it is",    # scripts/pocket-page.test.js, the pocket page's title
)

LITERALS = [
    ('iCloud.com.hughhowey.neo.pocket', 'iCloud.com.koldenaxelson.kibitz.pocket'),
    ('com.hughhowey.neopocket', 'com.koldenaxelson.kibitzpocket'),
    ('com/hughhowey/neopocket', 'com/koldenaxelson/kibitzpocket'),
    ('com.hughhowey.neo', 'com.koldenaxelson.kibitz'),
    ('hughhowey/neo', 'KoldenAxelson/kibitz'),
    ('"owner": "hughhowey"', '"owner": "KoldenAxelson"'),
    ('"maintainer": "Hugh Howey <hughhowey@gmail.com>"',
     '"maintainer": "KoldenAxelson <KoldenAxelson896@Protonmail.com>"'),
    ('NEOs Gemälde', 'Kibitz’ Gemälde'),  # German genitive
]

# Order matters: the specific shapes before the general ones.
TOKENS = [
    (re.compile(r'(?<![A-Za-z0-9])NEO_'), 'KIBITZ_'),             # NEO_SHOT, __NEO_GUTTER__
    (re.compile(r'(?<![A-Za-z])NEO(?=[A-Z][a-z])'), 'Kibitz'),    # NEOEditMenuWatcher
    (re.compile(r'(?<![A-Za-z])NEO(?![A-Za-z])'), 'Kibitz'),      # NEO, NEO-Bibliothek, NEO’s
    (re.compile(r'(?<![A-Z])Neo(?![a-z])'), 'Kibitz'),            # NeoI18n, fakeNeo (not Neolithic)
    (re.compile(r'(?<![A-Za-z])neo(?![a-z])'), 'kibitz'),         # window.neo, neo-spell (not neon)
]


def rebrand_text(text, in_pocket):
    out = []
    for line in text.splitlines(keepends=True):
        pocket_line = in_pocket or any(m in line for m in POCKET_LINE_MARKERS)
        if not pocket_line and any(m in line for m in KEEP_LINE_MARKERS):
            out.append(line)
            continue
        held = {}
        if not pocket_line:
            for i, phrase in enumerate(KEEP_PHRASES):
                key = '\x00KEEP%d\x00' % i
                if phrase in line:
                    line = line.replace(phrase, key)
                    held[key] = phrase
        for old, new in LITERALS:
            line = line.replace(old, new)
        for pattern, new in TOKENS:
            line = pattern.sub(new, line)
        for key, phrase in held.items():
            line = line.replace(key, phrase)
        out.append(line)
    return ''.join(out)


def rebrand_path(rel):
    for old, new in LITERALS:
        rel = rel.replace(old, new)
    for pattern, new in TOKENS:
        rel = pattern.sub(new, rel)
    return rel


def main(root):
    files = subprocess.run(['git', 'ls-files', '-z'], cwd=root, check=True,
                           capture_output=True).stdout.decode().split('\0')
    files = [f for f in files if f]
    changed = renamed = 0
    for rel in files:
        if rel in SKIP_FILES or rel.startswith(SKIP_PREFIXES) or rel in DROP_FILES:
            continue
        path = os.path.join(root, rel)
        if os.path.islink(path) or not os.path.isfile(path):
            continue
        with open(path, 'rb') as f:
            raw = f.read()
        if b'\0' in raw:
            continue  # binary
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            continue
        new = rebrand_text(text, rel.startswith(POCKET_FILES))
        if new != text:
            with open(path, 'wb') as f:
                f.write(new.encode('utf-8'))
            changed += 1
    for rel in files:
        target = rebrand_path(rel)
        if target != rel and not rel.startswith(SKIP_PREFIXES) and os.path.exists(os.path.join(root, rel)):
            os.makedirs(os.path.dirname(os.path.join(root, target)), exist_ok=True)
            os.rename(os.path.join(root, rel), os.path.join(root, target))
            renamed += 1
    for rel in files:  # tidy directories the renames emptied
        d = os.path.dirname(os.path.join(root, rel))
        while d != root and os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
            d = os.path.dirname(d)
    for rel in DROP_FILES:
        p = os.path.join(root, rel)
        if os.path.exists(p):
            os.remove(p)
    print('rebrand: %d files edited, %d renamed, dropped %s' % (changed, renamed, ', '.join(DROP_FILES)))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: rebrand.py <path-to-neo-checkout>')
    main(os.path.abspath(sys.argv[1]))
