# Kibitz

Kibitz is a word processor for writing *Grunt Force*, forked from
[NEO](https://github.com/hughhowey/neo), Hugh Howey's open-source,
distraction-free word processor for authors. It keeps NEO's way of writing
(plain files on your own disk, one Enter for a paragraph, two for a scene
break, three for a chapter) and adds a writing companion that kibitzes politely:
a sentence shape suggester that waits for a pause,
revision passes you run on purpose, and outline cards that ask questions.

## Running it

    make install   # npm install
    make start     # run Kibitz from source
    make test      # unit tests
    make e2e       # Electron end-to-end tests
    make lint

Books live in `~/Documents/Kibitz Library` (File → Library Folder… to move
it). The library format is NEO's, so a NEO library folder opens here too.

## Staying close to NEO

NEO is renamed to Kibitz by a script, `tools/rebrand.py`, not by hand. The
`upstream-kibitz` branch holds each NEO release run through it, and
`make sync` builds the next one and merges it into `main`. So when NEO
changes, the merge only stops where NEO and Kibitz edited the same lines.
To rename something new, change the script rather than the code it renames.
Kibitz's own README lives on `main` (the script drops NEO's).

Desktop Kibitz still pairs with Hugh's **NEO Pocket** for iPad and iPhone
(App Store) through its iCloud Drive folder. The `pocket/` sources are
renamed to Kibitz Pocket, for a build of our own one day.

## Licence

MIT, as NEO is. Copyright (c) 2026 Hugh Howey for NEO; see `LICENSE`.
