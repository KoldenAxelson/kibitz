#!/usr/bin/perl
# Kibitz: masks secrets in command output before it reaches a log file.
# Used by `make quest`. Best effort: it catches the common key and token
# shapes, but don't print secrets on purpose and trust this to catch them.
#
# Usage: some-command 2>&1 | perl tools/redact.pl
use strict;
use warnings;
$| = 1;    # line by line, so output still streams live

my $R = '[REDACTED]';
my $in_pem = 0;

while (my $line = <STDIN>) {
    # Private key blocks: drop everything between BEGIN and END.
    if ($line =~ /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/) { $in_pem = 1; print "$R private key block\n"; next; }
    if ($in_pem) { $in_pem = 0 if $line =~ /-----END [A-Z0-9 ]*PRIVATE KEY-----/; next; }

    # Known token shapes.
    $line =~ s/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_\-]{16,}/$R/g;      # Anthropic, OpenAI, Stripe
    $line =~ s/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/$R/g;                # GitHub tokens
    $line =~ s/\bgithub_pat_[A-Za-z0-9_]{20,}/$R/g;                           # GitHub fine-grained
    $line =~ s/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/$R/g;                            # AWS access key id
    $line =~ s/\bxox[abposr]-[A-Za-z0-9\-]{10,}/$R/g;                         # Slack
    $line =~ s/\bAIza[0-9A-Za-z_\-]{35}/$R/g;                                 # Google API key
    $line =~ s/\bnpm_[A-Za-z0-9]{30,}/$R/g;                                   # npm token
    $line =~ s/\b(?:rk|pk|sk)_(?:live|test)_[A-Za-z0-9]{16,}/$R/g;            # Stripe
    $line =~ s/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/$R/g;  # JWT

    # Authorization headers and bearer tokens.
    $line =~ s/\b(Bearer|Basic|token)\s+[A-Za-z0-9_\-\.=\/+]{12,}/$1 $R/gi;

    # Credentials inside URLs: https://user:secret@host
    $line =~ s{(\w+://[^/\s:@]+):[^@\s/]+@}{$1:$R@}g;

    # NAME=value / NAME: value where the name sounds secret.
    $line =~ s/\b([A-Za-z0-9_\-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIAL|AUTH|PRIVATE)[A-Za-z0-9_\-]*)(\s*[=:]\s*)(["']?)[^\s"',;]{6,}\3/$1$2$3$R$3/gi;

    print $line;
}
