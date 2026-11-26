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

## A personal fork

Kibitz is a desktop writer for one Mac. NEO was the starting point; it no
longer tracks NEO, and NEO Pocket, auto-update, translations, the other
spellcheck languages, the OpenAI cover painter and the Windows and Linux
builds have been cut (November 2026). English (US) only.

## Licence

MIT, as NEO is. Copyright (c) 2026 Hugh Howey for NEO; see `LICENSE`.
