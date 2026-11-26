# Kibitz: a fork of Hugh Howey's NEO (https://github.com/hughhowey/neo),
# for writing Grunt Force. Planning docs and reference material live in
# private/, which git ignores.
#
# Written for the make that ships with macOS (GNU make 3.81): no .ONESHELL,
# so every recipe line runs in its own shell.

UPSTREAM  := https://github.com/hughhowey/neo.git
FORK_NAME := kibitz
LOG_DIR   := private/logs

# bash, so the quest's pipe can use pipefail
SHELL := /bin/bash

.PHONY: help quest quest-steps install start try test e2e lint sync status

help:
	@echo "make quest    run the batch of commands Claude left for you (logged to private/logs, secrets redacted)"
	@echo "make install  npm install"
	@echo "make start    run Kibitz (electron .)"
	@echo "make test     unit tests (node --test)"
	@echo "make e2e      the Electron end-to-end tests"
	@echo "make lint     oxlint (NEO 2.0.0 already fails 30 checks)"
	@echo "make try      run from source with throwaway settings and library"
	@echo "make sync     merge the latest NEO, renamed to Kibitz, into main"
	@echo "make status   branch, remotes and working tree at a glance"

# ---------------------------------------------------------------------------
# QUEST: the current batch of commands for Konrad to run.
#
# `make quest` runs quest-steps and logs everything it prints to
# private/logs/quest-<timestamp>.log (git-ignored), with
# private/logs/quest-latest.log pointing at the newest. Output is passed
# through tools/redact.pl first, so API keys, tokens and passwords are
# masked in the log and on screen. Claude reads the log; no pasting needed.
#
# Claude rewrites quest-steps each time; everything else stays put. With
# nothing for Konrad to run, quest-steps just says "No quests pending".
# ---------------------------------------------------------------------------
quest:
	@mkdir -p $(LOG_DIR)
	@log=$(LOG_DIR)/quest-$$(date +%Y%m%d-%H%M%S).log; \
	{ echo "# make quest, $$(date)"; echo "# at commit $$(git rev-parse --short HEAD 2>/dev/null)"; echo; } > $$log; \
	set -o pipefail; \
	$(MAKE) --no-print-directory quest-steps 2>&1 | perl tools/redact.pl | tee -a $$log; \
	status=$$?; \
	echo "# exit status $$status" >> $$log; \
	ln -sf $$(basename $$log) $(LOG_DIR)/quest-latest.log; \
	echo; echo "Logged to $$log (exit status $$status)"; \
	exit $$status

# Current quest: the final test for the Zoom pass's model, chosen in
# advance: winnow:e4b asked per paragraph. Its stretch is fitted on the
# train split, then it runs once on the untouched test split with that
# stretch fixed. About 5 minutes.
quest-steps:
	set -o pipefail; npm test 2>&1 | tail -9
	npx oxlint craft decide.js app/passes.js scripts/zoom.e2e.js scripts/craft-zoom.test.js scripts/craft-passes.test.js
	npm run test:e2e -- zoom passes
	git add Makefile craft decide.js main.js preload.js index.html kibitz.css app/passes.js scripts/zoom.e2e.js scripts/passes.e2e.js scripts/craft-zoom.test.js scripts/craft-passes.test.js
	git commit -m "Kibitz: Zoom revision pass on the local model (winnow:e4b)" --trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01G49LS2rKxy4YDtoJqLyXhV"
	git push
	@echo "Real-model check: open a chapter, Edit > Revision Pass > Zoom. The first read wakes winnow:e4b (about 30 s)."

install:
	npm install

start:
	npm start

test:
	npm test

e2e:
	npm run test:e2e

lint:
	npm run lint

sync:
	./tools/sync-upstream.sh

try:
	npm run try

status:
	@git branch -vv
	@git remote -v
	@git status --short
