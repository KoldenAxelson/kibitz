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
	@echo "make lint     oxlint"
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
# Claude rewrites quest-steps each time; everything else stays put.
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

# Current quest: rename NEO to Kibitz. Commits the rename tooling, builds
# the upstream-kibitz branch (NEO 2.0.0 run through tools/rebrand.py),
# merges it into main, swaps in Kibitz's README, tests, lints and pushes.
quest-steps:
	git add Makefile tools/rebrand.py tools/sync-upstream.sh tools/README.kibitz.md
	git commit -m "Kibitz: rename tooling (tools/rebrand.py, tools/sync-upstream.sh)"
	./tools/sync-upstream.sh
	git mv -f tools/README.kibitz.md README.md
	git commit -m "Kibitz: README"
	npm install
	npm test
	npm run lint
	git push origin main upstream-kibitz
	git status --short
	git log --oneline --graph -6
	@echo; echo "Left as NEO on purpose:"; git grep -n -w NEO -- . ':!dictionaries' ':!licenses' ':!LICENSE' ':!README.md' ':!Makefile' ':!tools' | grep -v 'NEO Pocket' | cut -c1-140 || true

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
