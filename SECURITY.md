# Security

Academic Peer Review holds unpublished papers, reviewers' identities and their
CVs. Reviewer anonymity is the core promise of the platform, so we treat any
way of learning who reviewed a paper as a security issue.

## Reporting a vulnerability

Please report it privately through GitHub: open the **Security** tab of this
repository and choose **Report a vulnerability**. Do not open a public issue.

Include what you found, how to reproduce it, and what an attacker could do
with it. We will acknowledge the report within three working days.

## What we consider in scope

- Learning a reviewer's identity as a submitter, from the interface, emails,
  downloaded files or anything else.
- Learning an author's identity as a reviewer when the conference is
  double-blind.
- Reading or changing another person's papers, reviews or account.
- Acting on a conference you do not organise.
- Bypassing sign-in, rate limits or the Content Security Policy.

## How the platform protects itself

The safeguards are described in the [README](README.md#anonymity) and, in
more depth, in the code comments of `lib/dto/`, `lib/files/scrub.ts`,
`lib/auth/` and `proxy.ts`.
