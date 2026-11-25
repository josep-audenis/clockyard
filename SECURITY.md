# Security policy

Clockyard runs only in the browser. It has no server, no accounts, and makes no
network calls with your data: projects stay in the browser's storage, and a
shared link carries the circuit in its fragment, which is never sent to a
server.

## What counts

A security problem is anything that lets a file or link someone opens in
Clockyard do more than show a circuit:

- run script, or load content from elsewhere;
- read or change the browser's other projects or storage, or send data
  anywhere;
- hang or crash the tab beyond the engine's bounds, which are meant to report
  a circuit that is too large or never settles rather than freeze.

A circuit that simulates wrongly is a bug, not a security problem; report it as
an issue.

## Supported versions

Only `main`, and the site built from it, is supported. There are no releases
yet.

## Reporting

Report privately, through GitHub: open the repository's **Security** tab and
choose *Report a vulnerability*. Do not open a public issue. Include the file
or link that shows the problem, the browser and its version, and what happens.

The maintainer will reply in the report, agree a fix with you, and credit you
in the fix unless you would rather not be named.
