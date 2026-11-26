# Kibitz: a fork of Hugh Howey's NEO (https://github.com/hughhowey/neo),
# for writing Grunt Force. Planning docs and reference material live in
# private/, which git ignores.
#
# Written for the make that ships with macOS (GNU make 3.81): no .ONESHELL,
# so every recipe line runs in its own shell.

UPSTREAM  := https://github.com/hughhowey/neo.git
FORK_NAME := kibitz

.PHONY: help quest install start test e2e lint sync status

help:
	@echo "make quest    run the batch of commands Claude left for you (described above the quest target)"
	@echo "make install  npm install"
	@echo "make start    run Kibitz (electron .)"
	@echo "make test     unit tests (node --test)"
	@echo "make e2e      the Electron end-to-end tests"
	@echo "make lint     oxlint"
	@echo "make sync     merge the latest NEO from upstream into main"
	@echo "make status   branch, remotes and working tree at a glance"

# ---------------------------------------------------------------------------
# QUEST: the current batch of commands for Konrad to run.
# Claude rewrites this target each time; everything else stays put.
#
# Current quest: fork NEO on GitHub as $(FORK_NAME), turn this folder into
# its clone (upstream = hughhowey/neo), keep private/ out of git, install.
# Needs the GitHub CLI, signed in: brew install gh && gh auth login
# ---------------------------------------------------------------------------
quest:
	@command -v gh >/dev/null || { echo "Needs the GitHub CLI: brew install gh && gh auth login"; exit 1; }
	@gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login"; exit 1; }
	@test ! -d .git || { echo "This folder is already a git repo; this quest has already run."; exit 1; }
	gh repo fork hughhowey/neo --clone=false --default-branch-only --fork-name $(FORK_NAME)
	gh auth setup-git
	git init -b main
	git remote add upstream $(UPSTREAM)
	git remote add origin https://github.com/$$(gh api user -q .login)/$(FORK_NAME).git
	git fetch upstream
	git checkout -B main upstream/main
	printf '\n# Kibitz: planning docs and reference material, never part of the repo\nprivate/\n' >> .gitignore
	git add .gitignore Makefile
	git commit -m "Kibitz: add Makefile, keep private/ out of git"
	git push -u origin main
	npm install
	@echo; echo "Quest done. Tracked files should not include private/:"; git status --short --ignored | grep private || true
	@git remote -v

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
	git fetch upstream
	git merge upstream/main

status:
	@git branch -vv
	@git remote -v
	@git status --short
